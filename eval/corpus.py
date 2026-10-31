"""Pinned Python 3.12 docs corpus and helpers for locating gold evidence in chunks."""

import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path

import requests

ROOT       = Path(__file__).resolve().parent
DATA_DIR   = ROOT / "data"
CORPUS_DIR = DATA_DIR / "corpus"
QUESTIONS  = ROOT / "questions.jsonl"

sys.path.insert(0, str(ROOT.parent / "embedder"))

URL    = "https://docs.python.org/3.12/archives/python-3.12-docs-text.zip"
SHA256 = "e99a9d0200f871d4f1d0ca8137149e11737c3c342ed1f8beacef2cfdf89cbecf"
PREFIX = "python-3.12-docs-text/"
SECTIONS = ("tutorial/", "faq/", "howto/", "reference/", "glossary.txt")


def fetch(verify: bool = True):
    """Download the docs archive and extract the evaluated sections into eval/data/corpus."""
    resp = requests.get(URL, timeout=60)
    resp.raise_for_status()
    raw = resp.content
    digest = hashlib.sha256(raw).hexdigest()
    if verify and digest != SHA256:
        sys.exit(f"Archive changed upstream (sha256 {digest}). Results won't be comparable "
                 f"with the pinned run; rerun with --no-verify to accept it.")
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in z.namelist():
            rel = name.removeprefix(PREFIX)
            if name.endswith(".txt") and rel.startswith(SECTIONS) and not rel.endswith("index.txt"):
                out = CORPUS_DIR / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(z.read(name))
    print(f"Corpus ready in {CORPUS_DIR} (sha256 {digest[:12]})")


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def load_docs() -> dict[str, str]:
    if not CORPUS_DIR.exists():
        sys.exit("Corpus missing; run: python eval/corpus.py")
    return {p.relative_to(CORPUS_DIR).as_posix(): p.read_text(encoding="utf-8")
            for p in sorted(CORPUS_DIR.rglob("*.txt"))}


def load_questions() -> list[dict]:
    return [json.loads(l) for l in QUESTIONS.read_text().splitlines() if l.strip()]


def chunk_spans(doc: str, chunks: list[dict]) -> list[tuple[int, int]]:
    """Character span of each chunk within the normalised document."""
    spans, cursor = [], 0
    for c in chunks:
        start = doc.find(c["text"], cursor)
        if start < 0:
            start = doc.find(c["text"])
        if start < 0:
            raise ValueError(f"chunk not found in {c['source']}: {c['text'][:60]!r}")
        spans.append((start, start + len(c["text"])))
        cursor = start + 1
    return spans


def evidence_spans(doc: str, evidence: str) -> list[tuple[int, int]]:
    ev = normalise(evidence)
    return [(m.start(), m.start() + len(ev)) for m in re.finditer(re.escape(ev), doc)]


def is_hit(chunk_span, gold_spans) -> bool:
    """A chunk is relevant if it contains at least half of an evidence passage."""
    a, b = chunk_span
    return any(min(b, e) - max(a, s) >= (e - s) / 2 for s, e in gold_spans)


if __name__ == "__main__":
    fetch(verify="--no-verify" not in sys.argv)
