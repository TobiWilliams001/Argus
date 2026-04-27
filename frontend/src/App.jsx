import { useState, useEffect, useRef, useCallback } from "react"
import "./index.css"

const API = "http://localhost:8080/api"

// Generate or retrieve a persistent User ID
const UID = localStorage.getItem("argus_user_id") || (() => {
  const id = crypto.randomUUID()
  localStorage.setItem("argus_user_id", id)
  return id
})()

async function api(path, opts = {}) {
  const r = await fetch(API + path, opts)
  return r.json()
}
const GET = (p) => api(p)
const POST = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
const DEL = (p) => api(p, { method: "DELETE" })
const PATCH = (p, b) => api(p, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })

// Clean, minimalist icons
const Icons = {
  Research: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  Finance: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
  Legal: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" /><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" /><path d="M7 21h10" /><path d="M12 3v18" /><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </svg>
  ),
  General: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Chat: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
    </svg>
  ),
  Sources: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  Saved: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  ),
  Import: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  Settings: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />
    </svg>
  )
}

const PERSONAS = {
  research: {
    name: "Research & Academia",
    icon: <Icons.Research />,
    color: "#60c8f0",
    welcome: "Deep dive into your papers, journals, and thesis notes.",
    questions: [
      "What are the core arguments in these papers?",
      "Summarize the methodology used here.",
      "Are there any conflicting findings between these authors?"
    ]
  },
  finance: {
    name: "Finance & Analysis",
    icon: <Icons.Finance />,
    color: "#c8f060",
    welcome: "Extract insights from reports, filings, and market data.",
    questions: [
      "What are the key risks mentioned in this report?",
      "Compare the Q3 performance vs last year.",
      "Extract all EBITDA mentions and their context."
    ]
  },
  legal: {
    name: "Legal & Contracts",
    icon: <Icons.Legal />,
    color: "#f060c8",
    welcome: "Review case files, contracts, and legal precedents.",
    questions: [
      "Does this contract have a termination for convenience clause?",
      "Summarize the liability limits in Section 4.",
      "Find all mentions of governing law."
    ]
  },
  general: {
    name: "General Purpose",
    icon: <Icons.General />,
    color: "#c8f060",
    welcome: "Private intelligence for any document corpus.",
    questions: [
      "Give me a summary of this document.",
      "What are the most important takeaways?",
      "Explain this like I'm five."
    ]
  }
}

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [onboarded, setOnboarded] = useState(true) // Default to true while checking
  const [persona, setPersona] = useState("general")
  const chatEnd = useRef(null)
  const pdfRef = useRef(null)

  const notify = useCallback((msg, type = "success") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // 1. Initial check: Onboarding + Preferences
  useEffect(() => {
    GET(`/prefs?user_id=${UID}`).then(data => {
      setOnboarded(data.onboarded)
      if (data.vertical) setPersona(data.vertical)
    })
  }, [])

  // 2. Load collections
  useEffect(() => {
    if (onboarded) {
      GET(`/collections?user_id=${UID}`).then(data => {
        setCols(data)
        if (data.length > 0) {
          setActiveCol(data[0].id)
          setActiveColName(data[0].name)
        }
      })
    }
  }, [onboarded])

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

  const completeOnboarding = async (pKey) => {
    const res = await POST("/prefs", {
      user_id: UID,
      vertical: pKey,
      display_name: "" // Can add a field for this later
    })
    
    setPersona(pKey)
    setOnboarded(true)
    
    // The backend auto-created the first collection
    GET(`/collections?user_id=${UID}`).then(data => {
      setCols(data)
      const col = data.find(c => c.id === res.collection_id) || data[0]
      if (col) switchCol(col.id, col.name)
      // Auto-ingest sample docs
      POST(`/ingest-dir?user_id=${UID}&collection_id=${col.id}`, {})
    })
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
      {!onboarded && (
        <div className="onboarding">
          <div className="onboarding__content">
            <div className="onboarding__header">
              <h1>ARGUS</h1>
              <p>Your private document intelligence engine. Select your primary use case to get started.</p>
            </div>
            <div className="persona-grid">
              {Object.entries(PERSONAS).map(([key, p]) => (
                <div key={key} className="persona-card" onClick={() => completeOnboarding(key)}>
                  <span className="persona-card__icon">{p.icon}</span>
                  <span className="persona-card__title">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Sidebar ── */}
      <aside className={`sidebar ${sidebarCollapsed ? "sidebar--collapsed" : ""}`}>
        <div className="sidebar__logo">
          <h1>ARGUS</h1>
          <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(true)} title="Close sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="m14 9-2 2 2 2" /></svg>
          </button>
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
          <button className="nav-item nav-item--new-chat" onClick={() => { setMessages([]); setView("chat"); notify("New chat session started") }}>
            <span>+</span> New Chat
          </button>
        </div>

        <div className="sidebar__section">
          <div className="sidebar__label">Navigate</div>
          {[
            { id: "chat", label: "Chat", icon: <Icons.Chat />, badge: null },
            { id: "sources", label: "Sources", icon: <Icons.Sources />, badge: docCount || null },
            { id: "notebook", label: "Saved", icon: <Icons.Saved />, badge: null },
            { id: "add", label: "Import", icon: <Icons.Import />, badge: null },
          ].map(n => (
            <button key={n.id} className={`nav-item ${view === n.id ? "nav-item--active" : ""}`} onClick={() => setView(n.id)}>
              {n.icon}
              {n.label}
              {n.badge != null && <span className="nav-badge">{n.badge}</span>}
            </button>
          ))}
        </div>

        <div className="sidebar__footer">
          <div className="profile-card" onClick={() => setView("settings")}>
            <div className="profile-card__avatar">
              {persona.charAt(0).toUpperCase()}
            </div>
            <div className="profile-card__info">
              <span className="profile-card__name">{PERSONAS[persona]?.name || "User"}</span>
              <span className="profile-card__role">Settings</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main">
        {sidebarCollapsed && (
          <button className="sidebar-toggle sidebar-toggle--floating" onClick={() => setSidebarCollapsed(false)} title="Open sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="m14 11 2 2-2 2" /></svg>
          </button>
        )}
        <div className="main__header">
          <div className="main__title" style={{ marginLeft: sidebarCollapsed ? "48px" : "0" }}>
            {view === "chat" ? activeColName : view.charAt(0).toUpperCase() + view.slice(1)}
          </div>
          <button className="btn btn--ghost btn--sm" style={{ marginLeft: "auto" }} onClick={() => { localStorage.clear(); location.reload() }}>Reset onboarding</button>
        </div>
        {view === "chat" && <ChatView {...{ messages, query, setQuery, sendMessage, thinking, chatEnd, saveChunk, expandedSources, toggleSources, docCount, persona }} />}
        {view === "sources" && <SourcesView {...{ sources, setConfirm, docCount }} />}
        {view === "notebook" && <NotebookView {...{ saves, deleteSave, updateAnnotation }} />}
        {view === "add" && <AddDataView {...{ addTab, setAddTab, pasteText, setPasteText, docName, setDocName, ingestText, pdfFile, setPdfFile, pdfRef, ingestPDF, ingestDir, feedback }} />}
        {view === "settings" && <SettingsView {...{ persona, setConfirm, status }} />}
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

function ChatView({ messages, query, setQuery, sendMessage, thinking, chatEnd, saveChunk, expandedSources, toggleSources, docCount, persona }) {
  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }
  const p = PERSONAS[persona] || PERSONAS.general

  return (
    <div className="chat">
      {messages.length === 0 && !thinking ? (
        <div className="chat__empty">
          <div className="chat__empty-icon">{p.icon}</div>
          <h3>{p.welcome}</h3>
          <p>{docCount > 0 ? `I've prepared ${docCount} documents for you. Try asking one of these:` : "Import some documents to get started, or try one of these general questions:"}</p>
          <div className="suggested-queries">
            {p.questions.map((q, i) => (
              <button key={i} className="query-chip" onClick={() => { setQuery(q); setTimeout(sendMessage, 50) }}>{q}</button>
            ))}
          </div>
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
      <div className="main__body">
        {sources.length === 0 ? (
          <div className="empty">
            <div className="empty__icon"><Icons.Sources /></div>
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
      <div className="main__body">
        {saves.length === 0 ? (
          <div className="empty">
            <div className="empty__icon"><Icons.Saved /></div>
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
                  <div className="upload-zone__icon"><Icons.Sources /></div>
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


/* ═══════════════════════════════════════════════════════════
   SETTINGS VIEW
   ═══════════════════════════════════════════════════════════ */

function SettingsView({ persona, setConfirm, status }) {
  const p = PERSONAS[persona] || PERSONAS.general
  
  return (
    <>
      <div className="main__body">
        <div className="add-panel">
          <h2 style={{ marginBottom: 24 }}>System Settings</h2>
          
          <div className="field">
            <label className="field__label">Active Persona</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "var(--bg-input)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 20 }}>{p.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>{p.welcome}</div>
              </div>
            </div>
          </div>

          <div className="field" style={{ marginTop: 32 }}>
            <label className="field__label">Intelligence Engine</label>
            <div className="status-row" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`status-dot ${status ? "" : "status-dot--offline"}`} style={{ width: 8, height: 8, borderRadius: "50%", background: status ? "var(--accent)" : "var(--danger)" }} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{status ? `Ollama Active (${status.model || "tinyllama"})` : "Engine Offline"}</span>
            </div>
            {status?.encrypted && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 6 }}>
                🔒 Data is encrypted at rest (AES-256-GCM)
              </div>
            )}
          </div>

          <div style={{ marginTop: 48, borderTop: "1px solid var(--border-subtle)", paddingTop: 32 }}>
            <h3 style={{ color: "var(--danger)", fontSize: 14, marginBottom: 16 }}>Danger Zone</h3>
            <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>Reseting will clear all your local preferences, workspaces, and ingested documents. This action is permanent.</p>
            <button className="btn btn--danger" onClick={() => setConfirm({ title: "Reset everything?", text: "This will clear your preferences and ALL data. This cannot be undone.", onConfirm: () => { localStorage.clear(); location.reload() } })}>
              Factory Reset Argus
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

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
