import { useState, useEffect, useRef, useCallback } from "react"
import "./index.css"

const API = "http://localhost:8080/api"
const UID = "default"

async function api(path, opts = {}) {
  const r = await fetch(API + path, opts)
  return r.json()
}
const GET = (p) => api(p)
const POST = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
const DEL = (p) => api(p, { method: "DELETE" })
const PATCH = (p, b) => api(p, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })

export default function ArgusApp() {
  const [view, setView] = useState("chat")
  const [cols, setCols] = useState([])
  const [activeCol, setActiveCol] = useState("default")
  const [activeColName, setActiveColName] = useState("All Documents")
  const [colOpen, setColOpen] = useState(false)
  const [showNewCol, setShowNewCol] = useState(false)
  const [messages, setMessages] = useState([])
  const [query, setQuery] = useState("")
  const [thinking, setThinking] = useState(false)
  const [sources, setSources] = useState([])
  const [saves, setSaves] = useState([])
  const [status, setStatus] = useState(null)
  const [toast, setToast] = useState(null)
  const [addTab, setAddTab] = useState("text")
  const [pasteText, setPasteText] = useState("")
  const [docName, setDocName] = useState("")
  const [pdfFile, setPdfFile] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [expandedSources, setExpandedSources] = useState({})
  const chatEnd = useRef(null)
  const pdfRef = useRef(null)

  const notify = useCallback((msg, type = "success") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Load collections
  useEffect(() => {
    GET(`/collections?user_id=${UID}`).then(setCols).catch(() => {})
  }, [])

  // Load status when collection changes
  useEffect(() => {
    const load = () => GET(`/status?user_id=${UID}&collection_id=${activeCol}`).then(setStatus).catch(() => setStatus(null))
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [activeCol])

  // Load sources/saves when switching views
  useEffect(() => {
    if (view === "sources") GET(`/documents?user_id=${UID}&collection_id=${activeCol}`).then(setSources)
    if (view === "notebook") GET(`/saves?user_id=${UID}&collection_id=${activeCol}`).then(setSaves)
  }, [view, activeCol])

  // Auto-scroll chat
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }) }, [messages, thinking])

  const switchCol = (id, name) => {
    setActiveCol(id)
    setActiveColName(name)
    setColOpen(false)
    setMessages([])
  }

  const createCollection = async (name, color) => {
    const c = await POST("/collections", { user_id: UID, name, color })
    setCols(prev => [c, ...prev])
    switchCol(c.id, c.name)
    setShowNewCol(false)
    notify("Workspace created")
  }

  const deleteCollection = async (id) => {
    await DEL(`/collections/${id}?user_id=${UID}`)
    setCols(prev => prev.filter(c => c.id !== id))
    if (activeCol === id) switchCol("default", "All Documents")
    notify("Workspace deleted")
    setConfirm(null)
  }

  // ── Chat ──
  const sendMessage = async () => {
    const q = query.trim()
    if (!q || thinking) return
    setQuery("")
    const userMsg = { role: "user", content: q }
    setMessages(prev => [...prev, userMsg])
    setThinking(true)

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
      const res = await POST("/search", { query: q, user_id: UID, collection_id: activeCol, top_k: 4, history })
      const assistantMsg = { role: "assistant", content: res.answer || res.error || "No results found.", chunks: res.chunks || [], elapsed: res.elapsed }
      setMessages(prev => [...prev, assistantMsg])
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Is the backend running?", chunks: [] }])
    }
    setThinking(false)
  }

  const saveChunk = async (chunk, q) => {
    await POST("/saves", { user_id: UID, collection_id: activeCol, chunk_text: chunk.text, source: chunk.source, query: q, annotation: "" })
    notify("Saved to notebook")
  }

  // ── Ingest ──
  const ingestText = async () => {
    if (!pasteText.trim()) return
    setFeedback(null)
    const res = await POST("/ingest", { text: pasteText, source: docName || `note-${Date.now()}`, user_id: UID, collection_id: activeCol })
    if (res.error) { setFeedback({ type: "error", msg: res.error }); return }
    setFeedback({ type: "success", msg: `Imported successfully — ${res.chunks_added} passages added.` })
    setPasteText("")
    setDocName("")
    notify("Document imported")
  }

  const ingestPDF = async () => {
    if (!pdfFile) return
    setFeedback(null)
    const fd = new FormData()
    fd.append("file", pdfFile)
    fd.append("source", pdfFile.name)
    fd.append("user_id", UID)
    fd.append("collection_id", activeCol)
    const r = await fetch(API + "/ingest-pdf", { method: "POST", body: fd })
    const res = await r.json()
    if (res.error) { setFeedback({ type: "error", msg: res.error }); return }
    setFeedback({ type: "success", msg: `PDF imported — ${res.chunks_added} passages extracted.` })
    setPdfFile(null)
    notify("PDF imported")
  }

  const ingestDir = async () => {
    setFeedback(null)
    const res = await POST(`/ingest-dir?user_id=${UID}&collection_id=${activeCol}`, {})
    setFeedback({ type: "success", msg: `Scanned folder — ${res.ingested} files imported.` })
    notify("Folder imported")
  }

  const deleteDoc = async (source) => {
    await DEL(`/documents/${encodeURIComponent(source)}?user_id=${UID}&collection_id=${activeCol}`)
    setSources(prev => prev.filter(s => s.source !== source))
    notify("Document removed")
    setConfirm(null)
  }

  const deleteSave = async (id) => {
    await DEL(`/saves/${id}?user_id=${UID}`)
    setSaves(prev => prev.filter(s => s.id !== id))
    notify("Removed from notebook")
  }

  const updateAnnotation = async (id, annotation) => {
    await PATCH(`/saves/${id}`, { user_id: UID, annotation })
  }

  const resetCollection = async () => {
    await POST("/reset", { user_id: UID, collection_id: activeCol })
    setMessages([])
    notify("All data cleared")
    setConfirm(null)
  }

  const toggleSources = (i) => setExpandedSources(prev => ({ ...prev, [i]: !prev[i] }))

  const docCount = status?.doc_count || 0

  return (
    <div className="app">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar__logo">
          <h1>ARGUS</h1>
          <p>Private intelligence engine</p>
        </div>

        <div className="sidebar__section">
          <div className="sidebar__label">Workspace</div>
          <div className="col-selector">
            <button className="col-selector__btn" onClick={() => setColOpen(!colOpen)}>
              <span className="col-dot" style={{ background: activeCol === "default" ? "#c8f060" : (cols.find(c => c.id === activeCol)?.color || "#c8f060") }} />
              <span>{activeColName}</span>
              <span className="col-selector__chevron">{colOpen ? "▲" : "▼"}</span>
            </button>
            {colOpen && (
              <div className="col-selector__dropdown">
                <button className={`col-option ${activeCol === "default" ? "col-option--active" : ""}`} onClick={() => switchCol("default", "All Documents")}>
                  <span className="col-dot" style={{ background: "#c8f060" }} /> All Documents
                </button>
                {cols.map(c => (
                  <button key={c.id} className={`col-option ${activeCol === c.id ? "col-option--active" : ""}`} onClick={() => switchCol(c.id, c.name)}>
                    <span className="col-dot" style={{ background: c.color || "#c8f060" }} /> {c.name}
                  </button>
                ))}
                <button className="col-option col-option--new" onClick={() => { setColOpen(false); setShowNewCol(true) }}>
                  + New workspace
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="sidebar__section">
          <div className="sidebar__label">Navigate</div>
          {[
            { id: "chat", label: "Chat", badge: null },
            { id: "sources", label: "Sources", badge: docCount || null },
            { id: "notebook", label: "Saved", badge: null },
            { id: "add", label: "Import", badge: null },
          ].map(n => (
            <button key={n.id} className={`nav-item ${view === n.id ? "nav-item--active" : ""}`} onClick={() => setView(n.id)}>
              {n.label}
              {n.badge != null && <span className="nav-badge">{n.badge}</span>}
            </button>
          ))}
        </div>

        <div className="sidebar__footer">
          <div className="status-row">
            <span className={`status-dot ${status ? "" : "status-dot--offline"}`} />
            {status ? "Online" : "Connecting…"}
          </div>
          {status?.encrypted && (
            <div className="status-row" style={{ marginTop: 6 }}>🔒 Encrypted</div>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main">
        {view === "chat" && <ChatView {...{ messages, query, setQuery, sendMessage, thinking, chatEnd, saveChunk, expandedSources, toggleSources, docCount }} />}
        {view === "sources" && <SourcesView {...{ sources, setConfirm, docCount }} />}
        {view === "notebook" && <NotebookView {...{ saves, deleteSave, updateAnnotation }} />}
        {view === "add" && <AddDataView {...{ addTab, setAddTab, pasteText, setPasteText, docName, setDocName, ingestText, pdfFile, setPdfFile, pdfRef, ingestPDF, ingestDir, feedback }} />}
      </main>

      {showNewCol && <NewColModal onClose={() => setShowNewCol(false)} onCreate={createCollection} />}
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      {toast && <div className={`toast toast--${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   CHAT VIEW
   ═══════════════════════════════════════════════════════════ */

function ChatView({ messages, query, setQuery, sendMessage, thinking, chatEnd, saveChunk, expandedSources, toggleSources, docCount }) {
  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }

  return (
    <div className="chat">
      {messages.length === 0 && !thinking ? (
        <div className="chat__empty">
          <div className="chat__empty-icon">⬡</div>
          <h3>Ask anything about your documents</h3>
          <p>{docCount > 0 ? `You have ${docCount} document${docCount > 1 ? "s" : ""} in this workspace. Start asking questions.` : "Import some documents first, then ask questions here."}</p>
        </div>
      ) : (
        <div className="chat__messages">
          {messages.map((m, i) => (
            <div key={i} className={`message message--${m.role}`}>
              {m.role === "user" ? (
                <div className="message__bubble">{m.content}</div>
              ) : (
                <>
                  <div className="message__answer">{m.content}</div>
                  {m.elapsed && <div className="message__meta"><span>Answered in {m.elapsed}</span></div>}
                  {m.chunks?.length > 0 && (
                    <div className="message__sources">
                      <button className="message__sources-toggle" onClick={() => toggleSources(i)}>
                        {expandedSources[i] ? "Hide" : "Show"} {m.chunks.length} source{m.chunks.length > 1 ? "s" : ""}
                      </button>
                      {expandedSources[i] && m.chunks.map((c, j) => (
                        <div key={j} className="source-card">
                          <div className="source-card__header">
                            <span className="source-card__name">{c.source}</span>
                            <div className="source-card__relevance">
                              <div className="relevance-bar"><div className="relevance-bar__fill" style={{ width: `${Math.round((c.similarity || 0) * 100)}%` }} /></div>
                              <span>{Math.round((c.similarity || 0) * 100)}%</span>
                            </div>
                          </div>
                          <div className="source-card__text">{c.text}</div>
                          <div className="source-card__actions">
                            <button className="btn btn--ghost btn--sm" onClick={() => saveChunk(c, messages[i - 1]?.content || "")}>Save</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {thinking && <div className="thinking"><span className="thinking__dot" /><span className="thinking__dot" /><span className="thinking__dot" /></div>}
          <div ref={chatEnd} />
        </div>
      )}

      <div className="chat__input-wrap">
        <div className="chat__input-box">
          <input className="chat__input" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Ask a question…" disabled={thinking} />
          <button className="chat__send" onClick={sendMessage} disabled={!query.trim() || thinking}>↑</button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   SOURCES VIEW
   ═══════════════════════════════════════════════════════════ */

function SourcesView({ sources, setConfirm, docCount }) {
  return (
    <>
      <div className="main__header">
        <h2 className="main__title">Sources</h2>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{docCount} document{docCount !== 1 ? "s" : ""}</span>
      </div>
      <div className="main__body">
        {sources.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">📄</div>
            <h3>No documents yet</h3>
            <p>Import text, PDFs, or scan a folder to build your knowledge base.</p>
          </div>
        ) : (
          <div className="sources-grid">
            {sources.map(s => (
              <div key={s.id} className="doc-card">
                <div className="doc-card__name">{s.source}</div>
                <div className="doc-card__meta">Added {new Date(s.created_at * 1000).toLocaleDateString()}</div>
                <div className="doc-card__footer">
                  <span className="doc-card__passages">{s.chunk_count} passage{s.chunk_count !== 1 ? "s" : ""}</span>
                  <button className="btn btn--danger btn--sm" onClick={() => setConfirm({ title: "Remove document?", text: `This will remove "${s.source}" and all its passages from this workspace.`, onConfirm: () => setConfirm(null) || fetch(API + `/documents/${encodeURIComponent(s.source)}?user_id=${UID}&collection_id=${s.collection_id}`, { method: "DELETE" }).then(() => location.reload()) })}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════
   NOTEBOOK VIEW
   ═══════════════════════════════════════════════════════════ */

function NotebookView({ saves, deleteSave, updateAnnotation }) {
  return (
    <>
      <div className="main__header">
        <h2 className="main__title">Saved Passages</h2>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{saves.length} saved</span>
      </div>
      <div className="main__body">
        {saves.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">📌</div>
            <h3>Nothing saved yet</h3>
            <p>When you find useful passages during research, save them here for later.</p>
          </div>
        ) : (
          <div className="saves-list">
            {saves.map(s => (
              <div key={s.id} className="save-card">
                <div className="save-card__source">{s.source}</div>
                <div className="save-card__text">{s.chunk_text}</div>
                <textarea className="save-card__note" placeholder="Add a note…" defaultValue={s.annotation} onBlur={e => updateAnnotation(s.id, e.target.value)} />
                <div className="save-card__footer">
                  {s.query && <span className="save-card__query">From: "{s.query}"</span>}
                  <button className="btn btn--danger btn--sm" onClick={() => deleteSave(s.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════
   ADD DATA VIEW
   ═══════════════════════════════════════════════════════════ */

function AddDataView({ addTab, setAddTab, pasteText, setPasteText, docName, setDocName, ingestText, pdfFile, setPdfFile, pdfRef, ingestPDF, ingestDir, feedback }) {
  return (
    <>
      <div className="main__header"><h2 className="main__title">Import Documents</h2></div>
      <div className="main__body">
        <div className="add-tabs">
          {[["text", "Paste Text"], ["pdf", "Upload PDF"], ["folder", "Scan Folder"]].map(([id, label]) => (
            <button key={id} className={`add-tab ${addTab === id ? "add-tab--active" : ""}`} onClick={() => setAddTab(id)}>{label}</button>
          ))}
        </div>

        {feedback && <div className={`feedback feedback--${feedback.type}`}>{feedback.msg}</div>}

        {addTab === "text" && (
          <div className="add-panel">
            <p className="add-panel__desc">Copy and paste any text — articles, notes, research papers. It will be automatically organised into searchable passages.</p>
            <div className="field">
              <label className="field__label">Document name (optional)</label>
              <input className="input" value={docName} onChange={e => setDocName(e.target.value)} placeholder="e.g. Research Notes" />
            </div>
            <div className="field">
              <label className="field__label">Content</label>
              <textarea className="textarea" value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="Paste your text here…" rows={8} />
            </div>
            <button className="btn btn--primary" onClick={ingestText} disabled={!pasteText.trim()}>Import text</button>
          </div>
        )}

        {addTab === "pdf" && (
          <div className="add-panel">
            <p className="add-panel__desc">Upload a PDF document. The text will be extracted page by page and made searchable.</p>
            <input type="file" accept=".pdf" ref={pdfRef} style={{ display: "none" }} onChange={e => setPdfFile(e.target.files[0])} />
            <div className="upload-zone" onClick={() => pdfRef.current?.click()}>
              {pdfFile ? (
                <div className="upload-zone__file">📎 {pdfFile.name}</div>
              ) : (
                <>
                  <div className="upload-zone__icon">📄</div>
                  <div className="upload-zone__text">Click to choose a PDF</div>
                  <div className="upload-zone__hint">or drag and drop</div>
                </>
              )}
            </div>
            {pdfFile && <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={ingestPDF}>Import PDF</button>}
          </div>
        )}

        {addTab === "folder" && (
          <div className="add-panel">
            <p className="add-panel__desc">Import all text and markdown files from the sample documents folder.</p>
            <button className="folder-btn" onClick={ingestDir}>
              <div className="folder-btn__title">📁 Scan docs-sample/</div>
              <div className="folder-btn__desc">Imports all .txt and .md files</div>
            </button>
          </div>
        )}
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════
   MODALS
   ═══════════════════════════════════════════════════════════ */

function NewColModal({ onClose, onCreate }) {
  const [name, setName] = useState("")
  const [color, setColor] = useState("#c8f060")
  const colors = ["#c8f060", "#60c8f0", "#f060c8", "#f0c860", "#60f0c8", "#c860f0"]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>New Workspace</h2>
        <div className="field">
          <label className="field__label">Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Thesis Research" autoFocus />
        </div>
        <div className="field">
          <label className="field__label">Colour</label>
          <div style={{ display: "flex", gap: 8 }}>
            {colors.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{
                width: 28, height: 28, borderRadius: "50%", background: c, border: color === c ? "2px solid white" : "2px solid transparent",
                cursor: "pointer", transition: "var(--transition)"
              }} />
            ))}
          </div>
        </div>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onCreate(name, color)} disabled={!name.trim()}>Create</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({ title, text, onConfirm, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="confirm__text">{text}</p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--danger" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  )
}
