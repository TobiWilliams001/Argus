"""
Argus embedder: ingestion, retrieval and answer synthesis behind a small Flask API.

Every collection has its own FAISS index, keyed by (user_id, collection_id).
Chunking and retrieval live in retrieval.py; the eval suite in eval/ uses the same code.
"""

import io, json, logging, os, shutil, sqlite3, time, uuid
import numpy as np
from pathlib import Path
from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer

from llm import OLLAMA_MODEL, synthesise
from retrieval import BM25, chunk_text, search as search_chunks

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

try:
    from pypdf import PdfReader
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

logging.basicConfig(level=logging.INFO, format='%(asctime)s [embedder] %(message)s')
log = logging.getLogger(__name__)

app      = Flask(__name__)
DATA_DIR = Path("./data")
DB_PATH  = DATA_DIR / "argus.db"
KEY_FILE = DATA_DIR / ".key"

CHUNK_SIZE     = int(os.getenv("CHUNK_SIZE", "1000"))
CHUNK_OVERLAP  = int(os.getenv("CHUNK_OVERLAP", "200"))
RETRIEVAL_MODE = os.getenv("ARGUS_RETRIEVAL", "hybrid")   # vector | bm25 | hybrid
RERANK         = os.getenv("ARGUS_RERANK", "true").lower() == "true"
EMBED_DIM      = 384
ENCRYPT        = os.getenv("ARGUS_ENCRYPT", "true").lower() == "true"

DATA_DIR.mkdir(exist_ok=True)

# ── In-memory index store ─────────────────────────────────────
# (user_id, collection_id) -> {"index", "chunks", "matrix", "bm25"}
INDEX_STORE: dict = {}

model   = None
aes_key = None


# ── Database (SQLite) ─────────────────────────────────────────

def init_db():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    cur.executescript("""
    CREATE TABLE IF NOT EXISTS collections (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        name        TEXT NOT NULL,
        color       TEXT DEFAULT '#c8f060',
        created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        source        TEXT NOT NULL,
        chunk_count   INTEGER DEFAULT 0,
        created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saves (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        chunk_text    TEXT NOT NULL,
        source        TEXT NOT NULL,
        annotation    TEXT DEFAULT '',
        query         TEXT DEFAULT '',
        created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_prefs (
        user_id      TEXT PRIMARY KEY,
        onboarded    INTEGER DEFAULT 0,
        vertical     TEXT DEFAULT '',
        display_name TEXT DEFAULT '',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
    );
    """)

    con.commit()
    con.close()
    log.info("SQLite DB ready ✓")


def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


# ── Encryption ────────────────────────────────────────────────

def load_or_create_key():
    global aes_key
    if not CRYPTO_AVAILABLE:
        return
    if KEY_FILE.exists():
        aes_key = KEY_FILE.read_bytes()
    else:
        aes_key = os.urandom(32)
        KEY_FILE.write_bytes(aes_key)
        KEY_FILE.chmod(0o600)
    log.info("Encryption key ready ✓")


def aes_encrypt(plaintext: bytes) -> bytes:
    if not CRYPTO_AVAILABLE or not aes_key: return plaintext
    nonce = os.urandom(12)
    return nonce + AESGCM(aes_key).encrypt(nonce, plaintext, None)


def aes_decrypt(data: bytes) -> bytes:
    if not CRYPTO_AVAILABLE or not aes_key: return data
    return AESGCM(aes_key).decrypt(data[:12], data[12:], None)


# ── Index management (one per collection) ─────────────────────

def index_key(user_id: str, collection_id: str) -> tuple:
    return (user_id, collection_id)


def get_store(user_id: str, collection_id: str) -> dict:
    """Get or create the in-memory store for a collection."""
    key = index_key(user_id, collection_id)
    if key not in INDEX_STORE:
        INDEX_STORE[key] = {"index": None, "chunks": [], "matrix": None, "bm25": None}
        _load_collection_from_disk(user_id, collection_id)
    return INDEX_STORE[key]


def _collection_dir(user_id: str, collection_id: str) -> Path:
    d = DATA_DIR / user_id / collection_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_collection_from_disk(user_id: str, collection_id: str):
    key   = index_key(user_id, collection_id)
    store = INDEX_STORE[key]
    d     = _collection_dir(user_id, collection_id)

    chunks_file = d / "chunks.json"
    index_file  = d / "index.faiss"

    if chunks_file.exists():
        raw = chunks_file.read_bytes()
        if CRYPTO_AVAILABLE and aes_key and ENCRYPT:
            raw = aes_decrypt(raw)
        store["chunks"] = json.loads(raw)

    if FAISS_AVAILABLE and index_file.exists():
        store["index"] = faiss.read_index(str(index_file))
    elif store["chunks"]:
        _rebuild_matrix(store)

    log.info(f"Loaded collection {collection_id} ({len(store['chunks'])} chunks) ✓")


def _persist_collection(user_id: str, collection_id: str):
    key   = index_key(user_id, collection_id)
    store = INDEX_STORE[key]
    d     = _collection_dir(user_id, collection_id)

    raw = json.dumps(store["chunks"]).encode()
    if CRYPTO_AVAILABLE and aes_key and ENCRYPT:
        raw = aes_encrypt(raw)
    (d / "chunks.json").write_bytes(raw)

    if FAISS_AVAILABLE and store["index"] is not None:
        faiss.write_index(store["index"], str(d / "index.faiss"))


def _rebuild_matrix(store: dict):
    if not store["chunks"]:
        store["matrix"] = None
        return
    store["matrix"] = encode([c["text"] for c in store["chunks"]])


# ── Embed + index ─────────────────────────────────────────────

def encode(texts: list[str]) -> np.ndarray:
    return model.encode(texts, convert_to_numpy=True,
                        normalize_embeddings=True).astype(np.float32)


def embed_and_index(store: dict, chunks: list[dict]):
    embs = encode([c["text"] for c in chunks])
    store["bm25"] = None

    if FAISS_AVAILABLE:
        if store["index"] is None:
            store["index"] = faiss.IndexFlatIP(EMBED_DIM)
        store["index"].add(embs)
    else:
        store["matrix"] = embs if store["matrix"] is None \
            else np.vstack([store["matrix"], embs])


# ── Retrieval ─────────────────────────────────────────────────

def retrieve(store: dict, query: str, top_k: int = 4) -> list[dict]:
    if not store["chunks"]:
        return []
    if store.get("bm25") is None and RETRIEVAL_MODE != "vector":
        store["bm25"] = BM25([c["text"] for c in store["chunks"]])
    return search_chunks(query, encode([query]), store["chunks"],
                         index=store["index"] if FAISS_AVAILABLE else None,
                         matrix=store["matrix"], bm25=store.get("bm25"),
                         top_k=top_k, mode=RETRIEVAL_MODE, rerank=RERANK)


# ── Delete by source ──────────────────────────────────────────

def delete_source(store: dict, source: str):
    """Remove all chunks from a source and rebuild the index from the rest."""
    store["chunks"] = [c for c in store["chunks"] if c["source"] != source]
    for i, c in enumerate(store["chunks"]):
        c["idx"] = i

    store["index"]  = None
    store["matrix"] = None
    store["bm25"]   = None
    if store["chunks"]:
        embs = encode([c["text"] for c in store["chunks"]])
        if FAISS_AVAILABLE:
            store["index"] = faiss.IndexFlatIP(EMBED_DIM)
            store["index"].add(embs)
        else:
            store["matrix"] = embs


# ── PDF ───────────────────────────────────────────────────────

def extract_pdf_bytes(data: bytes) -> str:
    if not PDF_AVAILABLE:
        raise RuntimeError("pypdf not installed")
    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join(
        p.extract_text() for p in reader.pages if p.extract_text()
    )


# ── Routes: collections ───────────────────────────────────────

@app.route("/collections", methods=["GET"])
def list_collections():
    user_id = request.args.get("user_id", "default")
    con = db()
    rows = con.execute(
        "SELECT * FROM collections WHERE user_id=? ORDER BY created_at DESC",
        (user_id,)
    ).fetchall()
    con.close()
    return jsonify([dict(r) for r in rows])


@app.route("/collections", methods=["POST"])
def create_collection():
    d       = request.get_json()
    user_id = d.get("user_id", "default")
    name    = d.get("name", "").strip()
    color   = d.get("color", "#c8f060")
    if not name:
        return jsonify({"error": "name required"}), 400

    col_id = str(uuid.uuid4())[:8]
    con    = db()
    con.execute(
        "INSERT INTO collections VALUES (?,?,?,?,?)",
        (col_id, user_id, name, color, int(time.time()))
    )
    con.commit()
    con.close()
    return jsonify({"id": col_id, "name": name, "color": color})


@app.route("/collections/<col_id>", methods=["DELETE"])
def delete_collection(col_id):
    user_id = request.args.get("user_id", "default")
    con     = db()
    con.execute("DELETE FROM collections WHERE id=? AND user_id=?", (col_id, user_id))
    con.execute("DELETE FROM documents WHERE collection_id=? AND user_id=?", (col_id, user_id))
    con.execute("DELETE FROM saves WHERE collection_id=? AND user_id=?", (col_id, user_id))
    con.commit()
    con.close()

    key = index_key(user_id, col_id)
    if key in INDEX_STORE:
        del INDEX_STORE[key]

    d = _collection_dir(user_id, col_id)
    if d.exists():
        shutil.rmtree(d)

    return jsonify({"status": "deleted"})


# ── Routes: ingest ────────────────────────────────────────────

def _ingest_text(text: str, source: str, user_id: str, collection_id: str) -> dict:
    store  = get_store(user_id, collection_id)
    chunks = chunk_text(text, source, base_idx=len(store["chunks"]),
                        size=CHUNK_SIZE, overlap=CHUNK_OVERLAP)
    store["chunks"].extend(chunks)
    embed_and_index(store, chunks)
    _persist_collection(user_id, collection_id)

    con = db()
    con.execute(
        "INSERT OR REPLACE INTO documents VALUES (?,?,?,?,?,?)",
        (str(uuid.uuid4())[:8], user_id, collection_id, source,
         len(chunks), int(time.time()))
    )
    con.commit()
    con.close()

    return {"status": "ingested", "source": source,
            "chunks_added": len(chunks),
            "total_chunks": len(store["chunks"])}


@app.route("/ingest", methods=["POST"])
def ingest():
    d             = request.get_json()
    text          = d.get("text", "").strip()
    source        = d.get("source", f"doc-{int(time.time())}")
    user_id       = d.get("user_id", "default")
    collection_id = d.get("collection_id", "default")
    if not text:
        return jsonify({"error": "text required"}), 400
    return jsonify(_ingest_text(text, source, user_id, collection_id))


@app.route("/ingest-pdf", methods=["POST"])
def ingest_pdf():
    f             = request.files.get("file")
    user_id       = request.form.get("user_id", "default")
    collection_id = request.form.get("collection_id", "default")
    source        = request.form.get("source", f.filename if f else "pdf")
    if not f:
        return jsonify({"error": "file required"}), 400
    try:
        text = extract_pdf_bytes(f.read())
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    if not text.strip():
        return jsonify({"error": "no extractable text"}), 400
    return jsonify(_ingest_text(text, source, user_id, collection_id))


# ── Routes: search ────────────────────────────────────────────

@app.route("/search", methods=["POST"])
def search():
    d             = request.get_json()
    query         = d.get("query", "").strip()
    user_id       = d.get("user_id", "default")
    collection_id = d.get("collection_id", "default")
    top_k         = int(d.get("top_k", 4))

    if not query:
        return jsonify({"error": "query required"}), 400

    store = get_store(user_id, collection_id)
    if not store["chunks"]:
        return jsonify({"error": "no documents in this collection"}), 400

    t0     = time.time()
    chunks = retrieve(store, query, top_k)
    if not chunks:
        return jsonify({"answer": "Nothing relevant found.", "chunks": [], "elapsed": "0ms"})

    answer  = synthesise(query, chunks)
    elapsed = f"{int((time.time() - t0) * 1000)}ms"
    return jsonify({"answer": answer, "chunks": chunks, "elapsed": elapsed})


# ── Routes: documents ─────────────────────────────────────────

@app.route("/documents", methods=["GET"])
def list_documents():
    user_id       = request.args.get("user_id", "default")
    collection_id = request.args.get("collection_id", "default")
    con  = db()
    rows = con.execute(
        "SELECT * FROM documents WHERE user_id=? AND collection_id=? ORDER BY created_at DESC",
        (user_id, collection_id)
    ).fetchall()
    con.close()
    return jsonify([dict(r) for r in rows])


@app.route("/documents/<source>", methods=["DELETE"])
def delete_document(source):
    user_id       = request.args.get("user_id", "default")
    collection_id = request.args.get("collection_id", "default")

    store = get_store(user_id, collection_id)
    delete_source(store, source)
    _persist_collection(user_id, collection_id)

    con = db()
    con.execute(
        "DELETE FROM documents WHERE source=? AND user_id=? AND collection_id=?",
        (source, user_id, collection_id)
    )
    con.commit()
    con.close()
    return jsonify({"status": "deleted", "source": source})


# ── Routes: saves (highlights) ────────────────────────────────

@app.route("/saves", methods=["GET"])
def list_saves():
    user_id       = request.args.get("user_id", "default")
    collection_id = request.args.get("collection_id", "default")
    con  = db()
    rows = con.execute(
        "SELECT * FROM saves WHERE user_id=? AND collection_id=? ORDER BY created_at DESC",
        (user_id, collection_id)
    ).fetchall()
    con.close()
    return jsonify([dict(r) for r in rows])


@app.route("/saves", methods=["POST"])
def create_save():
    d             = request.get_json()
    user_id       = d.get("user_id", "default")
    collection_id = d.get("collection_id", "default")
    con           = db()
    save_id       = str(uuid.uuid4())[:8]
    con.execute(
        "INSERT INTO saves VALUES (?,?,?,?,?,?,?,?)",
        (save_id, user_id, collection_id,
         d.get("chunk_text", ""), d.get("source", ""),
         d.get("annotation", ""), d.get("query", ""),
         int(time.time()))
    )
    con.commit()
    con.close()
    return jsonify({"id": save_id, "status": "saved"})


@app.route("/saves/<save_id>", methods=["DELETE"])
def delete_save(save_id):
    user_id = request.args.get("user_id", "default")
    con     = db()
    con.execute("DELETE FROM saves WHERE id=? AND user_id=?", (save_id, user_id))
    con.commit()
    con.close()
    return jsonify({"status": "deleted"})


@app.route("/saves/<save_id>", methods=["PATCH"])
def update_save(save_id):
    d       = request.get_json()
    user_id = d.get("user_id", "default")
    con     = db()
    con.execute(
        "UPDATE saves SET annotation=? WHERE id=? AND user_id=?",
        (d.get("annotation", ""), save_id, user_id)
    )
    con.commit()
    con.close()
    return jsonify({"status": "updated"})


# ── Routes: status / reset ────────────────────────────────────

@app.route("/status", methods=["GET"])
def status():
    user_id       = request.args.get("user_id", "default")
    collection_id = request.args.get("collection_id", "default")
    store         = get_store(user_id, collection_id)
    sources       = list(set(c["source"] for c in store["chunks"]))
    return jsonify({
        "chunk_count":  len(store["chunks"]),
        "doc_count":    len(sources),
        "docs":         sources,
        "model":        "all-MiniLM-L6-v2",
        "ollama_model": OLLAMA_MODEL,
        "index":        "faiss" if FAISS_AVAILABLE else "brute-force",
        "encrypted":    bool(CRYPTO_AVAILABLE and ENCRYPT),
        "pdf_support":  PDF_AVAILABLE,
    })


@app.route("/reset", methods=["POST"])
def reset():
    d             = request.get_json() or {}
    user_id       = d.get("user_id", "default")
    collection_id = d.get("collection_id", "default")
    key           = index_key(user_id, collection_id)
    if key in INDEX_STORE:
        del INDEX_STORE[key]
    p = _collection_dir(user_id, collection_id)
    if p.exists():
        shutil.rmtree(p)
    con = db()
    con.execute("DELETE FROM documents WHERE user_id=? AND collection_id=?",
                (user_id, collection_id))
    con.commit()
    con.close()
    return jsonify({"status": "reset"})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# ── Routes: user prefs + onboarding ───────────────────────────

@app.route("/prefs", methods=["GET"])
def get_prefs():
    """User prefs; unknown users get onboarded=false so the frontend shows the welcome screen."""
    user_id = request.args.get("user_id", "default")
    con     = db()
    row     = con.execute(
        "SELECT * FROM user_prefs WHERE user_id=?", (user_id,)
    ).fetchone()
    con.close()

    if not row:
        return jsonify({
            "user_id":      user_id,
            "onboarded":    False,
            "vertical":     "",
            "display_name": ""
        })

    return jsonify({
        "user_id":      row["user_id"],
        "onboarded":    bool(row["onboarded"]),
        "vertical":     row["vertical"],
        "display_name": row["display_name"]
    })


@app.route("/prefs", methods=["POST"])
def save_prefs():
    """Finish onboarding: save prefs and create a first collection named after the vertical."""
    d            = request.get_json()
    user_id      = d.get("user_id", "default")
    vertical     = d.get("vertical", "")
    display_name = d.get("display_name", "")
    now          = int(time.time())

    con = db()

    con.execute("""
        INSERT INTO user_prefs (user_id, onboarded, vertical, display_name, created_at, updated_at)
        VALUES (?, 1, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            onboarded    = 1,
            vertical     = excluded.vertical,
            display_name = excluded.display_name,
            updated_at   = excluded.updated_at
    """, (user_id, vertical, display_name, now, now))

    vertical_names = {
        "research": "My Research",
        "finance":  "Financial Docs",
        "legal":    "Case Files",
        "general":  "My Documents"
    }
    col_name  = vertical_names.get(vertical, "My Documents")
    col_id    = str(uuid.uuid4())[:8]
    col_color = {
        "research": "#a78bfa",
        "finance":  "#34d399",
        "legal":    "#f59e0b",
        "general":  "#c8f060"
    }.get(vertical, "#c8f060")

    existing = con.execute(
        "SELECT id FROM collections WHERE user_id=? LIMIT 1", (user_id,)
    ).fetchone()

    if not existing:
        con.execute(
            "INSERT INTO collections VALUES (?,?,?,?,?)",
            (col_id, user_id, col_name, col_color, now)
        )

    con.commit()
    con.close()

    return jsonify({
        "status":       "onboarded",
        "vertical":     vertical,
        "display_name": display_name,
        "collection_id": col_id if not existing else existing["id"]
    })


if __name__ == "__main__":
    load_or_create_key()
    init_db()
    log.info("Loading model…")
    model = SentenceTransformer("all-MiniLM-L6-v2")
    log.info(f"FAISS:   {'✓' if FAISS_AVAILABLE else '✗'}")
    log.info(f"PDF:     {'✓' if PDF_AVAILABLE else '✗'}")
    log.info(f"Encrypt: {'✓ AES-256-GCM' if CRYPTO_AVAILABLE and ENCRYPT else '✗'}")
    log.info(f"Search:  {RETRIEVAL_MODE}{' + rerank' if RERANK else ''}")
    log.info("Argus embedder → http://localhost:8081")
    app.run(host="0.0.0.0", port=8081, debug=False)
