# Argus evaluation suite

Measures whether Argus finds the right passage (retrieval) and whether its answers stay grounded in what it found (faithfulness). Both scripts call the same `embedder/retrieval.py` and `embedder/llm.py` code the app uses.

## Run it

```bash
embedder/venv/bin/python eval/corpus.py            # download the pinned Python 3.12 docs (once)
embedder/venv/bin/python eval/retrieval_eval.py    # ~30 min on an M2 with reranking; --no-rerank for ~2 min
embedder/venv/bin/python eval/faithfulness_eval.py --generator llama3.2 --judge qwen2.5:7b --size 1000 --rerank
```

Results land in `eval/results/`. Embeddings are cached in `eval/data/`, which is git-ignored.

## Files

| File | Purpose |
|---|---|
| `questions.jsonl` | 95 questions, each with a reference answer, a source page and an exact evidence quote. `also` lists accepted alternate passages |
| `corpus.py` | Downloads the docs archive, checks its SHA-256, and maps chunks and evidence to character spans |
| `retrieval_eval.py` | Sweeps chunk size × hard cap × mode (vector, BM25, hybrid) × rerank. Reports hit@1/5, MRR@10 and latency |
| `faithfulness_eval.py` | Generates answers with the app's prompt, then has a separate judge model check each claim against the sources |

## Method

- **Hit:** a retrieved chunk counts as a hit if it contains at least half of a gold evidence passage. This is span overlap, so it's fair across chunk sizes.
- **Questions:** written in different words from the docs, so keyword search gets no free overlap.
- **Alternate gold passages:** the first run used a single gold passage per question, which undercounted. The docs often answer a question in several places. The top 5 passages from every configuration were pooled for missed questions, and overlapping passages were merged. Each was judged strictly: does it answer the question on its own? Judging was LLM-assisted and spot-checked by hand. Borderline calls were rejected, and a quote that doesn't match the docs exactly fails the run. `--dump-pool` regenerates the pool.
- **Faithfulness:** the judge splits each answer into claims and marks each as supported by the sources or not. Use a judge stronger than the generator. Small models used as their own judge mark copied-back source text as "supported". When the generator gives no cited answer, the app shows the top passage verbatim. That fallback rate is reported separately, because counting it as faithful would inflate the score.
