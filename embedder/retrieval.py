"""Chunking and retrieval shared by the embedder service and the eval suite.

Retrieval modes:
  vector  FAISS inner product over normalised MiniLM embeddings
  bm25    keyword scoring
  hybrid  vector + BM25 fused with reciprocal rank fusion (RRF)
Any mode can be followed by a cross-encoder rerank of the top candidates.
"""

import math
import re
from collections import Counter, defaultdict

import numpy as np

RERANK_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
MIN_SIMILARITY = 0.1


def chunk_text(text: str, source: str, base_idx: int = 0, size: int = 500,
               overlap: int = 100, hard_cap: bool = False) -> list[dict]:
    """Split at sentence boundaries into ~size-char chunks, carrying ~overlap chars forward.

    With hard_cap, sentences longer than size/2 (code listings, tables) are split at
    word boundaries so no chunk grows far past the embedding model's input window.
    Off by default: on the eval set it didn't improve retrieval (see eval/results).
    """
    text      = re.sub(r'\s+', ' ', text).strip()
    sentences = re.split(r'(?<=[.!?])\s+', text)
    if hard_cap:
        sentences = [p for s in sentences for p in _split_long(s, max(1, size // 2))]
    chunks, current = [], ""

    for i, sentence in enumerate(sentences):
        current += sentence + " "
        if len(current) >= size or i == len(sentences) - 1:
            stripped = current.strip()
            if stripped:
                chunks.append({"text": stripped, "source": source,
                               "idx": base_idx + len(chunks)})
            words   = current.split()
            current = " ".join(words[-max(1, overlap // 6):]) + " "

    return chunks


def _split_long(sentence: str, limit: int) -> list[str]:
    if len(sentence) <= limit:
        return [sentence]
    pieces, current = [], ""
    for word in sentence.split(" "):
        if current and len(current) + 1 + len(word) > limit:
            pieces.append(current)
            current = word
        else:
            current = f"{current} {word}" if current else word
    if current:
        pieces.append(current)
    return pieces


# ── BM25 ──────────────────────────────────────────────────────

_STOPWORDS = frozenset("""
a an and are as at be by for from has have how i if in is it its of on or
that the this to was what when where which who why will with you your do does
can should would""".split())


def tokenize(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9_]+", text.lower()) if t not in _STOPWORDS]


class BM25:
    def __init__(self, texts: list[str], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.n = len(texts)
        self.postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        lengths = np.zeros(self.n, dtype=np.float32)
        for doc_id, text in enumerate(texts):
            tf = Counter(tokenize(text))
            lengths[doc_id] = sum(tf.values())
            for term, count in tf.items():
                self.postings[term].append((doc_id, count))
        avg = float(lengths.mean()) if self.n else 0.0
        self.norm = k1 * (1 - b + b * lengths / (avg or 1.0))

    def scores(self, query: str) -> np.ndarray:
        out = np.zeros(self.n, dtype=np.float32)
        for term in set(tokenize(query)):
            plist = self.postings.get(term)
            if not plist:
                continue
            idf = math.log(1 + (self.n - len(plist) + 0.5) / (len(plist) + 0.5))
            ids = np.fromiter((d for d, _ in plist), dtype=np.int64, count=len(plist))
            tf  = np.fromiter((c for _, c in plist), dtype=np.float32, count=len(plist))
            out[ids] += idf * tf * (self.k1 + 1) / (tf + self.norm[ids])
        return out

    def search(self, query: str, n: int) -> list[tuple[int, float]]:
        s = self.scores(query)
        n = min(n, self.n)
        if n == 0:
            return []
        top = np.argpartition(-s, n - 1)[:n]
        top = top[np.argsort(-s[top])]
        return [(int(i), float(s[i])) for i in top if s[i] > 0]


# ── Fusion + rerank ───────────────────────────────────────────

def rrf(rankings: list[list[int]], k: int = 60) -> list[int]:
    """Reciprocal rank fusion: score(d) = sum over lists of 1 / (k + rank)."""
    scores: dict[int, float] = defaultdict(float)
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking):
            scores[doc_id] += 1.0 / (k + rank + 1)
    return sorted(scores, key=scores.get, reverse=True)


_reranker = None


def get_reranker():
    global _reranker
    if _reranker is None:
        from sentence_transformers import CrossEncoder
        _reranker = CrossEncoder(RERANK_MODEL)
    return _reranker


def vector_search(index, matrix, q_emb: np.ndarray, n: int) -> list[tuple[int, float]]:
    """Top-n (chunk_id, cosine) from a FAISS index, or a numpy matrix as fallback."""
    if index is not None:
        n = min(n, index.ntotal)
        scores, ids = index.search(q_emb, n)
        return [(int(i), float(s)) for s, i in zip(scores[0], ids[0]) if i >= 0]
    if matrix is not None:
        s   = (matrix @ q_emb.T).ravel()
        top = np.argsort(-s)[:n]
        return [(int(i), float(s[i])) for i in top]
    return []


def search(query: str, q_emb: np.ndarray, chunks: list[dict], index=None, matrix=None,
           bm25: BM25 | None = None, top_k: int = 4, mode: str = "hybrid",
           rerank: bool = False, candidates: int = 30) -> list[dict]:
    """Return the top_k chunks for query, each with its cosine `similarity`."""
    if not chunks:
        return []

    pool = max(candidates, top_k)
    vec  = vector_search(index, matrix, q_emb, pool) if mode in ("vector", "hybrid") else []
    kw   = bm25.search(query, pool) if bm25 is not None and mode in ("bm25", "hybrid") else []

    if mode == "vector":
        ranked = [i for i, s in vec if s > MIN_SIMILARITY]
    elif mode == "bm25":
        ranked = [i for i, _ in kw]
    else:
        ranked = rrf([[i for i, _ in vec], [i for i, _ in kw]])

    ranked = ranked[:pool] if rerank else ranked[:top_k]

    rerank_scores = {}
    if rerank and ranked:
        pairs  = [(query, chunks[i]["text"]) for i in ranked]
        scores = get_reranker().predict(pairs, show_progress_bar=False)
        rerank_scores = dict(zip(ranked, map(float, scores)))
        ranked = sorted(ranked, key=rerank_scores.get, reverse=True)[:top_k]

    cosine = dict(vec)
    out = []
    for i in ranked:
        sim = cosine.get(i)
        if sim is None:
            sim = _cosine(index, matrix, q_emb, i)
        hit = {**chunks[i], "similarity": round(sim, 4)}
        if i in rerank_scores:
            hit["rerank_score"] = round(rerank_scores[i], 4)
        out.append(hit)
    return out


def _cosine(index, matrix, q_emb: np.ndarray, i: int) -> float:
    vec = index.reconstruct(i) if index is not None else matrix[i]
    return float(np.dot(q_emb[0], vec))
