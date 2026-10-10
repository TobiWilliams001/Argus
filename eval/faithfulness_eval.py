"""Faithfulness eval: are generated answers grounded in the passages they were given?

    ollama pull llama3.2      # judge; use something stronger than the generator
    embedder/venv/bin/python eval/faithfulness_eval.py --judge llama3.2 [--limit 30]

For each question: retrieve with the app's search, generate with the app's prompt
(ARGUS_MODEL, default tinyllama), then ask the judge model to split the answer into
claims and mark each as supported or not by the sources. Answers where the generator
produced no cited answer are counted separately: the app shows the top passage
verbatim in that case, which is trivially grounded and would inflate the score.
"""

import argparse
import json
import time

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

import corpus
from llm import OLLAMA_MODEL, generate, ollama
from retrieval import BM25, chunk_text, search

RESULTS_DIR = corpus.ROOT / "results"

JUDGE_PROMPT = """You are checking whether an answer is supported by its sources.

Sources:
{sources}

Question: {question}
Answer: {answer}
Reference answer: {reference}

Split the answer into its factual claims (ignore citation markers like [1]).
For each claim, decide if it is directly supported by the sources above.
Then decide if the answer agrees with the reference answer.
Reply with JSON only:
{{"claims": [{{"claim": "...", "supported": true}}], "correct": true}}"""


def judge(question, answer, reference, chunks, model):
    sources = "\n\n".join(f"[{i + 1}] {c['text']}" for i, c in enumerate(chunks))
    try:
        raw = ollama(JUDGE_PROMPT.format(sources=sources, question=question, answer=answer,
                                         reference=reference),
                     model=model, num_predict=600, fmt="json", timeout=600)
        verdict = json.loads(raw)
    except Exception as e:
        print(f"  judge failed: {e}")
        return None
    claims = [c for c in verdict.get("claims", []) if isinstance(c, dict)]
    return {"claims": claims, "correct": bool(verdict.get("correct"))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--judge", required=True, help="Ollama model used as judge")
    ap.add_argument("--generator", default=OLLAMA_MODEL)
    ap.add_argument("--size", type=int, default=500)
    ap.add_argument("--mode", default="hybrid")
    ap.add_argument("--rerank", action="store_true")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    docs, questions = corpus.load_docs(), corpus.load_questions()[:args.limit]
    model  = SentenceTransformer("all-MiniLM-L6-v2")
    chunks = [c for src, text in docs.items()
              for c in chunk_text(text, src, size=args.size, overlap=args.size // 5)]
    for i, c in enumerate(chunks):
        c["idx"] = i
    embs  = model.encode([c["text"] for c in chunks], batch_size=64, convert_to_numpy=True,
                         normalize_embeddings=True).astype(np.float32)
    index = faiss.IndexFlatIP(embs.shape[1])
    index.add(embs)
    bm25  = BM25([c["text"] for c in chunks])

    # Generate everything first, then judge, so Ollama holds one model in memory at a time.
    records = []
    for q in questions:
        q_emb = model.encode([q["question"]], convert_to_numpy=True,
                             normalize_embeddings=True).astype(np.float32)
        top = search(q["question"], q_emb, chunks, index=index, bm25=bm25, top_k=3,
                     mode=args.mode, rerank=args.rerank)
        t0 = time.perf_counter()
        try:
            answer = generate(q["question"], top, model=args.generator)
        except Exception as e:
            print(f"  generation failed: {e}")
            answer = None
        records.append({"id": q["id"], "question": q["question"], "reference": q["answer"],
                        "answer": answer, "gen_ms": (time.perf_counter() - t0) * 1000,
                        "sources": top})
        print(f"{q['id']}: {'generated' if answer else 'fallback'}")

    for rec in records:
        if rec["answer"]:
            rec["verdict"] = judge(rec["question"], rec["answer"], rec["reference"],
                                   rec["sources"], args.judge)
            print(f"{rec['id']}: {'judged' if rec['verdict'] else 'unparsed'}")

    judged   = [r for r in records if r.get("verdict") and r["verdict"]["claims"]]
    per_ans  = [sum(bool(c.get("supported")) for c in r["verdict"]["claims"]) / len(r["verdict"]["claims"])
                for r in judged]
    summary = {
        "generator": args.generator, "judge": args.judge,
        "retrieval": f"{args.mode}{' + rerank' if args.rerank else ''}, {args.size}-char chunks",
        "questions": len(records),
        "generated": sum(bool(r["answer"]) for r in records),
        "fallback_rate": sum(not r["answer"] for r in records) / len(records),
        "judged": len(judged),
        "faithfulness": float(np.mean(per_ans)) if per_ans else None,
        "fully_grounded": sum(p == 1.0 for p in per_ans) / len(judged) if judged else None,
        "correct": sum(r["verdict"]["correct"] for r in judged) / len(judged) if judged else None,
        "gen_p50_ms": float(np.median([r["gen_ms"] for r in records])),
    }

    RESULTS_DIR.mkdir(exist_ok=True)
    out = RESULTS_DIR / f"faithfulness-{args.generator.replace(':', '_')}.json"
    out.write_text(json.dumps({"summary": summary, "records": records}, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
