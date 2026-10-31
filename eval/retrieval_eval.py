"""Retrieval eval: does the gold passage appear in the top results?

    embedder/venv/bin/python eval/corpus.py           # once
    embedder/venv/bin/python eval/retrieval_eval.py   # writes eval/results/retrieval.{md,json}

Each config is a chunker (size, hard cap) plus a retrieval mode, optionally reranked.
"""

import argparse
import json
import time
from pathlib import Path

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

import corpus
from retrieval import BM25, chunk_text, get_reranker, search

RESULTS_DIR = corpus.ROOT / "results"
CACHE_DIR   = corpus.DATA_DIR / "cache"
EMBED_MODEL = "all-MiniLM-L6-v2"
K = 10

CHUNKERS = [(size, cap) for size in (250, 500, 1000) for cap in (False, True)]
MODES    = [("vector", False), ("bm25", False), ("hybrid", False),
            ("vector", True), ("hybrid", True)]


def build(docs, model, size, cap):
    chunks, spans = [], []
    for source, text in docs.items():
        doc = corpus.normalise(text)
        cs  = chunk_text(text, source, base_idx=len(chunks), size=size,
                         overlap=size // 5, hard_cap=cap)
        chunks += cs
        spans  += corpus.chunk_spans(doc, cs)

    cache = CACHE_DIR / f"emb-{size}-{int(cap)}-{len(chunks)}.npy"
    if cache.exists():
        embs = np.load(cache)
    else:
        embs = model.encode([c["text"] for c in chunks], batch_size=64, convert_to_numpy=True,
                            normalize_embeddings=True, show_progress_bar=True).astype(np.float32)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        np.save(cache, embs)

    index = faiss.IndexFlatIP(embs.shape[1])
    index.add(embs)
    return chunks, spans, index, BM25([c["text"] for c in chunks])


def gold_passages(q, docs):
    """(source, spans) for the labelled passage plus any accepted alternates."""
    return [(g["source"], corpus.evidence_spans(corpus.normalise(docs[g["source"]]), g["evidence"]))
            for g in [q, *q.get("also", [])]]


def evaluate(questions, docs, model, chunks, spans, index, bm25, mode, rerank, pool=None):
    gold = {q["id"]: gold_passages(q, docs) for q in questions}
    ranks, latencies, context = [], [], []
    for q in questions:
        t0    = time.perf_counter()
        q_emb = model.encode([q["question"]], convert_to_numpy=True,
                             normalize_embeddings=True).astype(np.float32)
        hits  = search(q["question"], q_emb, chunks, index=index, bm25=bm25,
                       top_k=K, mode=mode, rerank=rerank)
        latencies.append((time.perf_counter() - t0) * 1000)

        rank = next((r for r, h in enumerate(hits, 1)
                     if any(h["source"] == src and corpus.is_hit(spans[h["idx"]], g)
                            for src, g in gold[q["id"]])),
                    None)
        ranks.append(rank)
        if pool is not None and (rank is None or rank > 5):
            for h in hits[:5]:
                pool.setdefault(q["id"], {})[h["text"]] = h["source"]
        context.append(sum(len(h["text"]) for h in hits[:5]))

    n = len(questions)
    return {
        "hit@1":  sum(r == 1 for r in ranks) / n,
        "hit@5":  sum(r is not None and r <= 5 for r in ranks) / n,
        "hit@10": sum(r is not None for r in ranks) / n,
        "mrr@10": sum(1 / r for r in ranks if r) / n,
        "p50_ms": float(np.percentile(latencies, 50)),
        "p95_ms": float(np.percentile(latencies, 95)),
        "top5_chars": float(np.mean(context)),
        "misses": [q["id"] for q, r in zip(questions, ranks) if r is None or r > 5],
    }


def to_markdown(rows, n_questions, n_docs):
    lines = [
        f"{n_questions} questions over {n_docs} Python 3.12 docs pages. "
        "hit@k = gold passage in the top k; MRR@10 = mean reciprocal rank. "
        "Latency is per query on CPU, including query embedding.",
        "",
        "| chunk size | hard cap | chunks | mode | rerank | hit@1 | hit@5 | MRR@10 | top-5 chars | p50 ms | p95 ms |",
        "|---:|:-:|---:|---|:-:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in rows:
        lines.append(
            f"| {r['size']} | {'yes' if r['hard_cap'] else 'no'} | {r['chunks']} | {r['mode']} | "
            f"{'yes' if r['rerank'] else 'no'} | {r['hit@1']:.0%} | {r['hit@5']:.0%} | "
            f"{r['mrr@10']:.3f} | {r['top5_chars']:.0f} | {r['p50_ms']:.0f} | {r['p95_ms']:.0f} |")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", type=int, nargs="*", help="only these chunk sizes")
    ap.add_argument("--no-rerank", action="store_true")
    ap.add_argument("--dump-pool", action="store_true",
                    help="write top-5 passages for missed questions to eval/data/pool.json for judging")
    args = ap.parse_args()

    docs, questions = corpus.load_docs(), corpus.load_questions()
    for q in questions:
        for src, spans in gold_passages(q, docs):
            if not spans:
                raise SystemExit(f"{q['id']}: evidence not found in {src}")

    model = SentenceTransformer(EMBED_MODEL)
    modes = [m for m in MODES if not (args.no_rerank and m[1])]
    if any(r for _, r in modes):
        get_reranker()

    rows, pool = [], {} if args.dump_pool else None
    for size, cap in CHUNKERS:
        if args.sizes and size not in args.sizes:
            continue
        chunks, spans, index, bm25 = build(docs, model, size, cap)
        for mode, rerank in modes:
            m = evaluate(questions, docs, model, chunks, spans, index, bm25, mode, rerank, pool)
            rows.append({"size": size, "hard_cap": cap, "chunks": len(chunks),
                         "mode": mode, "rerank": rerank, **m})
            print(f"size={size} cap={cap} {mode:6} rerank={rerank!s:5} "
                  f"hit@5={m['hit@5']:.0%} mrr={m['mrr@10']:.3f} p50={m['p50_ms']:.0f}ms")

    if pool is not None:
        (corpus.DATA_DIR / "pool.json").write_text(json.dumps(pool, indent=1))
        return

    RESULTS_DIR.mkdir(exist_ok=True)
    (RESULTS_DIR / "retrieval.json").write_text(json.dumps(rows, indent=2))
    (RESULTS_DIR / "retrieval.md").write_text(to_markdown(rows, len(questions), len(docs)))
    print(f"Wrote {RESULTS_DIR / 'retrieval.md'}")


if __name__ == "__main__":
    main()
