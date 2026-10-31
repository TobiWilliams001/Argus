# Argus

**Private, local-first semantic search and RAG over your own documents. No cloud APIs, no API keys, no data leaving your machine.**

Most RAG tools send your documents to a hosted embedding API and a hosted LLM. That means proprietary or personal data leaves your machine, every query adds latency, and costs grow with usage. Argus runs the whole pipeline locally: ingestion, embeddings, vector search and answer generation, with everything it stores encrypted at rest.

---

## What it does

- **Ask questions in plain English** over your documents and get a generated answer with the source passages and similarity scores it was based on.
- **Ingest** pasted text, PDFs (page by page), or a folder of `.txt` / `.md` files.
- **Fully local stack:** embeddings with `all-MiniLM-L6-v2`, vector search with FAISS, and answer generation through [Ollama](https://ollama.ai). Ollama is optional: without it, Argus still returns ranked passages.
- **Encrypted at rest:** every stored chunk is encrypted with AES-256-GCM.
- **Collections:** organise documents into separate knowledge bases, each with its own vector index, persisted to disk and reloaded on startup. Documents, saved results and preferences are tracked in SQLite.
- **Standalone concurrent crawler:** a Go CLI that crawls a site with 8 concurrent workers (see [`crawler/`](crawler)). It is not yet connected to the API or UI (see [Roadmap](#roadmap)).

## Architecture

```
┌────────────────┐   HTTP   ┌────────────────────┐   HTTP   ┌──────────────────────────┐
│ React + Vite   │ ───────► │ Go API  (:8080)    │ ───────► │ Python embedder (:8081)  │
│ (:3000)        │          │ routing, CORS,     │          │ chunking, embeddings,    │
│ ask, import,   │          │ PDF proxy          │          │ per-collection FAISS,    │
│ collections    │          │                    │          │ AES-256-GCM, SQLite,     │
│                │          │                    │          │ Ollama answer generation │
└────────────────┘          └────────────────────┘          └──────────────────────────┘
```

**Why it's split this way:** Go handles HTTP routing and the concurrent crawler. Python handles the ML workload and its state, where the ecosystem (sentence-transformers, FAISS) lives. Each side can change without touching the other.

### Query path
1. Text is split at sentence boundaries into ~1000-character chunks with overlap, so context isn't lost at chunk edges.
2. Each chunk is embedded into a 384-dimension vector and added to a FAISS inner-product index. A BM25 keyword index is built alongside it.
3. A query runs against both indexes. The two result lists are merged with reciprocal rank fusion, and a cross-encoder reranks the top 30 candidates.
4. If Ollama is running, the top passages are passed to a local LLM to write an answer with numbered citations. The sources are always returned alongside it.

## Design decisions & trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| Hybrid search + reranker | Keyword search catches exact terms (names, section numbers) that embeddings miss; the reranker fixes the ordering. Lifted top-5 accuracy from 78% to 92% on the eval set | Reranking adds ~1.2s per query on CPU |
| Exact search (`IndexFlatIP`) | Exact results and zero tuning at personal-corpus scale | Linear cost per query; an approximate index (HNSW/IVF) is needed at large scale |
| `all-MiniLM-L6-v2` embeddings | Small (~90MB), fast on CPU, good general retrieval | Lower quality than larger embedding models on specialist text |
| `tinyllama` as default LLM | Runs reliably on low-RAM machines | Weaker answers; switch to `llama3.2` or `mistral` with `ARGUS_MODEL` if you have the memory |
| Encryption at rest | Stored chunks are unreadable if the data directory is copied | The key lives in the same data directory; protects copied data, not a fully compromised machine |

## Quick start

**Requirements:** Go 1.21+, Python 3.12 (not 3.14: wheels for numpy/faiss aren't available yet), Node.js 18+. Ollama is optional.

```bash
git clone https://github.com/TobiWilliams001/Argus.git
cd Argus
./scripts/start.sh        # sets up and starts all three services
open http://localhost:3000
```

On first run it creates a Python virtualenv, downloads the embedding model (~90MB) and, if Ollama is installed, pulls the default LLM. After that, startup takes a few seconds.

<details>
<summary>Run each service manually</summary>

```bash
# 1. Embedder
cd embedder && python3.12 -m venv venv && source venv/bin/activate
pip install -r requirements.txt && python3 embedder.py

# 2. API
cd backend && go run main.go

# 3. Frontend
cd frontend && npm install && npm run dev
```
</details>

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ARGUS_MODEL` | `tinyllama` | Ollama model used for answers |
| `CHUNK_SIZE` | `1000` | Characters per chunk |
| `CHUNK_OVERLAP` | `200` | Overlap between chunks |
| `ARGUS_RETRIEVAL` | `hybrid` | `vector`, `bm25` or `hybrid` |
| `ARGUS_RERANK` | `true` | Rerank candidates with a cross-encoder (more accurate, ~1s slower on CPU) |
| `ARGUS_ENCRYPT` | `true` | Encrypt stored chunks (not recommended to disable) |

## Evaluation

Retrieval and answer quality are measured against a fixed test set, so changes are judged on numbers rather than impressions. Full details and reproduction steps are in [`eval/`](eval).

**Test set:** 95 questions over 58 pages of the Python 3.12 documentation (tutorial, FAQ, how-tos, language reference and glossary), pinned by checksum. Each question has a reference answer and an evidence passage. Questions were written in different words from the docs so keyword overlap doesn't inflate results.

**Retrieval** (gold passage in the top results; median latency per query on an M2 CPU):

| Configuration | Top-1 | Top-5 | MRR@10 | p50 latency |
|---|---:|---:|---:|---:|
| Vector search, 500-char chunks (previous default) | 43% | 78% | 0.569 | 9 ms |
| Hybrid (vector + BM25), 500-char chunks | 52% | 82% | 0.650 | 10 ms |
| Hybrid + reranker, 1000-char chunks (**current default**) | 54% | 92% | 0.703 | 1.2 s |

**What the experiments showed:**
- **Hybrid search is a free win:** +4 points top-5 and +9 points top-1 at no measurable latency cost.
- **The reranker matters most with larger chunks:** at 1000 characters it lifts top-5 from 78% to 92%.
- **Capping oversized chunks (code listings) didn't help,** so it's off by default. The model truncates long chunks, but on this set that didn't cost accuracy.
- **Larger chunks hand the LLM more text:** the top 5 contain ~5,600 characters at 1000-char chunks vs ~3,100 at 500. That's part of why top-5 rises. Top-1 and MRR, which don't benefit from extra text, rose too.

**Answer faithfulness** (`llama3.2` generating, `qwen2.5:7b` judging, current default retrieval):

| Metric | Result |
|---|---:|
| Claims supported by the cited sources | 91% |
| Answers with every claim supported | 84% |
| Answers agreeing with the reference answer | 82% |
| Questions where the model gave no cited answer (top passage shown instead) | 23% |
| Median answer generation time | 11.9 s |

The judge is itself a small local model and makes mistakes in both directions, so treat these as approximate. The first three rows are measured over the 73 generated answers.

**Caveats:**
- **Sample size:** with 95 questions, each question is about 1 point, so gaps under ~7 points are within noise.
- **Alternate answers:** the docs often answer a question in more than one place. Passages retrieved by any configuration were pooled, and those that fully answer the question were accepted as alternate gold answers. These were labelled with LLM assistance and spot-checked by hand. Without them every configuration scores 10–25 points lower, but the ranking between configurations holds.
- **Domain:** these are technical docs. Contracts and case files will score differently. The same harness can be pointed at a client's own documents.

## API

| Method | Route | Description |
|---|---|---|
| POST | `/api/search` | Search `{ query, top_k }` and return answer + sources |
| POST | `/api/ingest` | Ingest text `{ text, source }` |
| POST | `/api/ingest-pdf` | Ingest a PDF (multipart) |
| POST | `/api/ingest-dir` | Ingest all files in `docs-sample/` |
| GET | `/api/status` | Corpus stats and capability flags |
| POST | `/api/reset` | Wipe the index |
| — | `/api/collections`, `/api/documents`, `/api/saves`, `/api/prefs` | Collections, document management, saved results, preferences |

## Limitations

Argus is a working end-to-end prototype for a single user. Specifically:
- **No authentication:** indexes are scoped per user and collection, but the user ID is supplied by the client and all data shares one encryption key, so it is not safe to expose to untrusted users.
- **Evaluated on technical docs, not legal documents yet** (see [Evaluation](#evaluation)).
- **Unit tests cover retrieval only.** CI runs them and builds the Go services and frontend on every push.
- **Crawler not yet connected** to the API or UI.

## Roadmap

- [x] **Retrieval evaluation suite:** a labelled question set measuring recall@k and answer faithfulness
- [x] **Hybrid search** (BM25 + vectors) and a reranker, measured against the eval suite
- [ ] **Benchmarks:** p50/p95 query latency and memory at 10k and 100k chunks; approximate index (HNSW) at scale
- [ ] **Real multi-user isolation:** authentication, server-side user identity and per-user encryption keys (indexes are already namespaced per user and collection)
- [ ] **MCP server:** expose Argus search as a tool for AI agents
- [ ] **Connect the crawler** to the API with live progress over SSE
- [ ] One-command `docker compose up` and broader test coverage

## Project structure

```
argus/
├── backend/      Go API: routing, CORS, PDF proxy
│   └── crawler/  concurrent crawler package
├── embedder/     Python: chunking, hybrid retrieval, per-collection FAISS, encryption, SQLite, Ollama
├── eval/         retrieval and faithfulness evaluation suite
├── frontend/     React + Vite UI
├── crawler/      standalone crawler CLI
├── docs-sample/  sample documents to ingest
└── scripts/      start.sh, one-command startup
```

## Contributing

Issues and pull requests are welcome. The roadmap above is a good place to start.
