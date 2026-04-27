"""
Argus Embedder v3
─────────────────
New:
  • Collections — one FAISS index per (user_id, collection_id)
  • Delete by source — rebuilds index minus deleted source
  • Chat mode — conversation history forwarded to Ollama
  • Multi-user — all state namespaced by user_id
"""

import os, json, time, re, logging, sqlite3
import requests
import numpy as np
from pathlib import Path
from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer

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

OLLAMA_URL    = "http://localhost:11434"
OLLAMA_MODEL  = os.getenv("ARGUS_MODEL", "tinyllama")
CHUNK_SIZE    = int(os.getenv("CHUNK_SIZE", "500"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
EMBED_DIM     = 384
ENCRYPT       = os.getenv("ARGUS_ENCRYPT", "true").lower() == "true"

DATA_DIR.mkdir(exist_ok=True)

# ── In-memory index store ─────────────────────────────────────
# Key: (user_id, collection_id)
# Value: {"index": faiss_index, "chunks": [...], "matrix": np.ndarray}
INDEX_STORE: dict = {}

model   = None
aes_key = None


# ═══════════════════════════════════════════════════════════════
#  DATABASE  (SQLite)
# ═══════════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════════
#  ENCRYPTION
# ═══════════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════════
#  INDEX MANAGEMENT  (per collection)
# ═══════════════════════════════════════════════════════════════

def index_key(user_id: str, collection_id: str) -> tuple:
    return (user_id, collection_id)


def get_store(user_id: str, collection_id: str) -> dict:
    """Get or create the in-memory store for a collection."""
    key = index_key(user_id, collection_id)
    if key not in INDEX_STORE:
        INDEX_STORE[key] = {"index": None, "chunks": [], "matrix": None}
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
    texts = [c["text"] for c in store["chunks"]]
    store["matrix"] = model.encode(
        texts, convert_to_numpy=True, normalize_embeddings=True
    ).astype(np.float32)


# ═══════════════════════════════════════════════════════════════
#  CHUNKING
# ═══════════════════════════════════════════════════════════════

def chunk_text(text: str, source: str, base_idx: int = 0) -> list[dict]:
    text      = re.sub(r'\s+', ' ', text).strip()
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks, current = [], ""

    for i, sentence in enumerate(sentences):
        current += sentence + " "
        if len(current) >= CHUNK_SIZE or i == len(sentences) - 1:
            stripped = current.strip()
            if stripped:
                chunks.append({
                    "text": stripped,
                    "source": source,
                    "idx": base_idx + len(chunks)
                })
            words   = current.split()
            current = " ".join(words[-max(1, CHUNK_OVERLAP // 6):]) + " "

    return chunks


# ═══════════════════════════════════════════════════════════════
#  EMBED + INDEX
# ═══════════════════════════════════════════════════════════════

def embed_and_index(store: dict, chunks: list[dict]):
    texts = [c["text"] for c in chunks]
    embs  = model.encode(
        texts, convert_to_numpy=True, normalize_embeddings=True
    ).astype(np.float32)

    if FAISS_AVAILABLE:
        if store["index"] is None:
            store["index"] = faiss.IndexFlatIP(EMBED_DIM)
        store["index"].add(embs)
    else:
        store["matrix"] = embs if store["matrix"] is None \
            else np.vstack([store["matrix"], embs])


# ═══════════════════════════════════════════════════════════════
#  RETRIEVAL
# ═══════════════════════════════════════════════════════════════

def retrieve(store: dict, query: str, top_k: int = 4) -> list[dict]:
    if not store["chunks"]:
        return []

    q_emb = model.encode(
        [query], convert_to_numpy=True, normalize_embeddings=True
    ).astype(np.float32)

    if FAISS_AVAILABLE and store["index"] is not None:
        k = min(top_k, store["index"].ntotal)
        scores, indices = store["index"].search(q_emb, k)
        return [
            {**store["chunks"][idx], "similarity": round(float(s), 4)}
            for s, idx in zip(scores[0], indices[0])
            if idx >= 0 and float(s) > 0.1
        ]

    if store["matrix"] is not None:
        scores  = (store["matrix"] @ q_emb.T).flatten()
        top     = np.argsort(scores)[::-1][:top_k]
        return [
            {**store["chunks"][i], "similarity": round(float(scores[i]), 4)}
            for i in top if float(scores[i]) > 0.1
        ]
    return []


# ═══════════════════════════════════════════════════════════════
#  DELETE BY SOURCE  (rebuilds FAISS index minus that source)
# ═══════════════════════════════════════════════════════════════

def delete_source(store: dict, source: str):
    """Remove all chunks from a source and rebuild the index."""
    store["chunks"] = [c for c in store["chunks"] if c["source"] != source]

    # Renumber indices
    for i, c in enumerate(store["chunks"]):
        c["idx"] = i

    # Rebuild FAISS from scratch
    store["index"]  = None
    store["matrix"] = None

    if not store["chunks"]:
        return

    if FAISS_AVAILABLE:
        store["index"] = faiss.IndexFlatIP(EMBED_DIM)
        texts = [c["text"] for c in store["chunks"]]
        embs  = model.encode(
            texts, convert_to_numpy=True, normalize_embeddings=True
        ).astype(np.float32)
        store["index"].add(embs)
    else:
        _rebuild_matrix(store)


# ═══════════════════════════════════════════════════════════════
#  LLM SYNTHESIS  (with chat history)
# ═══════════════════════════════════════════════════════════════

def synthesise(query: str, chunks: list[dict], history: list[dict] = None) -> str:
    import re as _re

    def clean(text):
        text = _re.sub(r'#+\s*', '', text)
        text = _re.sub(r'\*\*(.+?)\*\*', r'\1', text)
        return text.strip()

    # Take top 3 chunks for more context
    top = chunks[:3]
    
    # Create a numbered context for citations
    context_blocks = []
    for i, c in enumerate(top):
        context_blocks.append(f"Source [{i+1}] ({c['source']}): {clean(c['text'])}")
    
    context_str = "\n\n".join(context_blocks)

    prompt = (
        f"You are a research assistant. Answer the question using ONLY the provided sources.\n"
        f"Use numbered citations like [1] or [2] in your answer to show which source you are using.\n"
        f"Keep it to 2-3 detailed sentences.\n\n"
        f"{context_str}\n\n"
        f"Question: {query}\n"
        f"Answer:"
    )

    try:
        r = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.0, 
                    "num_predict": 300, 
                    "stop": ["\n\n", "Question:", "Source ["]
                }
            },
            timeout=60
        )
        r.raise_for_status()
        answer = r.json().get("response", "").strip()
        
        # Validation: If the model failed to cite or gave a tiny answer, fall back
        if len(answer) < 20 or "[" not in answer:
            fallback = f"According to {top[0]['source']}, {clean(top[0]['text'])[:300]}..."
            return fallback
            
        return answer
    except Exception as e:
        return f"Synthesis error: {e}. Best match: {clean(top[0]['text'])[:300]}"





# ═══════════════════════════════════════════════════════════════
#  PDF
# ═══════════════════════════════════════════════════════════════

def extract_pdf_bytes(data: bytes) -> str:
    if not PDF_AVAILABLE:
        raise RuntimeError("pypdf not installed")
    import io
    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join(
        p.extract_text() for p in reader.pages if p.extract_text()
    )


# ═══════════════════════════════════════════════════════════════
#  ROUTES — COLLECTIONS
# ═══════════════════════════════════════════════════════════════

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

    import uuid
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

    import shutil
    d = _collection_dir(user_id, col_id)
    if d.exists():
        shutil.rmtree(d)

    return jsonify({"status": "deleted"})


# ═══════════════════════════════════════════════════════════════
#  ROUTES — INGEST
# ═══════════════════════════════════════════════════════════════

def _ingest_text(text: str, source: str, user_id: str, collection_id: str) -> dict:
    store  = get_store(user_id, collection_id)
    chunks = chunk_text(text, source, base_idx=len(store["chunks"]))
    store["chunks"].extend(chunks)
    embed_and_index(store, chunks)
    _persist_collection(user_id, collection_id)

    import uuid
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


# ═══════════════════════════════════════════════════════════════
#  ROUTES — SEARCH + CHAT
# ═══════════════════════════════════════════════════════════════

@app.route("/search", methods=["POST"])
def search():
    d             = request.get_json()
    query         = d.get("query", "").strip()
    user_id       = d.get("user_id", "default")
    collection_id = d.get("collection_id", "default")
    top_k         = int(d.get("top_k", 4))
    history       = d.get("history", [])   # list of {role, content}

    if not query:
        return jsonify({"error": "query required"}), 400

    store = get_store(user_id, collection_id)
    if not store["chunks"]:
        return jsonify({"error": "no documents in this collection"}), 400

    t0     = time.time()
    chunks = retrieve(store, query, top_k)
    if not chunks:
        return jsonify({"answer": "Nothing relevant found.", "chunks": [], "elapsed": "0ms"})

    answer  = synthesise(query, chunks, history)
    elapsed = f"{int((time.time() - t0) * 1000)}ms"
    return jsonify({"answer": answer, "chunks": chunks, "elapsed": elapsed})


# ═══════════════════════════════════════════════════════════════
#  ROUTES — DOCUMENTS (source browser)
# ═══════════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════════
#  ROUTES — SAVES (highlights)
# ═══════════════════════════════════════════════════════════════

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
    import uuid
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


# ═══════════════════════════════════════════════════════════════
#  ROUTES — STATUS / RESET
# ═══════════════════════════════════════════════════════════════

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
    import shutil
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


# ═══════════════════════════════════════════════════════════════
#  ROUTES — USER PREFS + ONBOARDING
# ═══════════════════════════════════════════════════════════════

@app.route("/prefs", methods=["GET"])
def get_prefs():
    """
    Returns the user's preferences and onboarding status.
    If the user doesn't exist yet, returns onboarded: false
    so the frontend knows to show the welcome screen.
    """
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
    """
    Called when user completes onboarding.
    Saves their vertical choice and name.
    Also creates their default collection automatically
    so they land directly in a working workspace.
    """
    d            = request.get_json()
    user_id      = d.get("user_id", "default")
    vertical     = d.get("vertical", "")
    display_name = d.get("display_name", "")
    now          = int(time.time())

    con = db()

    # upsert prefs
    con.execute("""
        INSERT INTO user_prefs (user_id, onboarded, vertical, display_name, created_at, updated_at)
        VALUES (?, 1, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            onboarded    = 1,
            vertical     = excluded.vertical,
            display_name = excluded.display_name,
            updated_at   = excluded.updated_at
    """, (user_id, vertical, display_name, now, now))

    # auto-create a default collection named after their vertical
    # so they land in a real workspace immediately
    import uuid
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

    # only create if they don't already have one
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
    log.info("Argus embedder v3 → http://localhost:8081")
    app.run(host="0.0.0.0", port=8081, debug=False)
