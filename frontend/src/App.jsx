import { useCallback, useEffect, useState } from "react"
import { api } from "./api"
import Sidebar from "./components/Sidebar"
import AskView from "./components/AskView"
import DocumentsView from "./components/DocumentsView"
import SavedView from "./components/SavedView"
import ImportView from "./components/ImportView"
import SettingsView from "./components/SettingsView"
import Welcome from "./components/Welcome"
import { ConfirmModal, NewMatterModal } from "./components/Modals"
import { Icon } from "./icons"

const PAGES = { ask: "Ask", documents: "Documents", saved: "Saved", import: "Import", settings: "Settings" }

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("argus_theme") || "system")
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme")
    else document.documentElement.setAttribute("data-theme", theme)
    localStorage.setItem("argus_theme", theme)
  }, [theme])
  return [theme, setTheme]
}

export default function App() {
  const [onboarded, setOnboarded] = useState(null)
  const [matters, setMatters] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [view, setView] = useState("ask")
  const [status, setStatus] = useState(null)
  const [threads, setThreads] = useState({})
  const [collapsed, setCollapsed] = useState(false)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [theme, setTheme] = useTheme()

  const matter = matters.find(m => m.id === activeId)

  const notify = useCallback((msg, type = "success") => {
    setToast({ msg, type, key: Date.now() })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(t)
  }, [toast])

  const loadMatters = useCallback(async (selectId) => {
    const list = await api.matters()
    if (!Array.isArray(list)) return
    setMatters(list)
    setActiveId(prev => selectId || (list.some(m => m.id === prev) ? prev : list[0]?.id ?? null))
  }, [])

  useEffect(() => {
    api.prefs().then(p => setOnboarded(Boolean(p.onboarded))).catch(() => setOnboarded(true))
  }, [])

  useEffect(() => { if (onboarded) loadMatters() }, [onboarded, loadMatters])

  const refreshStatus = useCallback(() => {
    if (!activeId) return setStatus(null)
    api.status(activeId).then(s => setStatus(s.error ? null : s)).catch(() => setStatus(null))
  }, [activeId])

  useEffect(() => {
    refreshStatus()
    const t = setInterval(refreshStatus, 15000)
    return () => clearInterval(t)
  }, [refreshStatus])

  const finishOnboarding = async (name) => {
    const res = await api.savePrefs({ vertical: "legal", display_name: name })
    setOnboarded(true)
    await loadMatters(res.collection_id)
  }

  const createMatter = async (name, color) => {
    const m = await api.createMatter(name, color)
    if (m.error) return notify(m.error, "error")
    await loadMatters(m.id)
    setModal(null)
    setView("ask")
    notify(`Created “${name}”`)
  }

  const deleteMatter = (m) => setModal({
    type: "confirm",
    title: `Delete “${m.name}”?`,
    text: "All documents, saved passages and the search index for this matter will be permanently deleted from this machine.",
    action: "Delete matter",
    onConfirm: async () => {
      await api.deleteMatter(m.id)
      setModal(null)
      setThreads(t => { const { [m.id]: _, ...rest } = t; return rest })
      await loadMatters()
      notify("Matter deleted")
    },
  })

  const setThread = useCallback((updater) => {
    setThreads(t => ({ ...t, [activeId]: updater(t[activeId] || []) }))
  }, [activeId])

  const shared = { matter, matterId: activeId, status, notify, refreshStatus, setView, setModal }

  return (
    <div className={`shell ${collapsed ? "shell--collapsed" : ""}`}>
      {onboarded === false && <Welcome onDone={finishOnboarding} />}

      <Sidebar
        matters={matters}
        matter={matter}
        onSelect={(id) => { setActiveId(id); setView("ask") }}
        onNewMatter={() => setModal({ type: "new-matter" })}
        view={view}
        setView={setView}
        docCount={status?.doc_count ?? 0}
        encrypted={status?.encrypted}
        onCollapse={() => setCollapsed(true)}
        onNewQuestion={() => { setThread(() => []); setView("ask") }}
        theme={theme}
        setTheme={setTheme}
      />

      <main className="main">
        <header className="topbar">
          {collapsed && (
            <button className="icon-btn" onClick={() => setCollapsed(false)} title="Show sidebar" aria-label="Show sidebar">
              <Icon.Sidebar />
            </button>
          )}
          <nav className="crumbs" aria-label="Breadcrumb">
            <span className="crumbs__matter">{matter?.name || "No matter selected"}</span>
            <span className="crumbs__sep">/</span>
            <span className="crumbs__page">{PAGES[view]}</span>
          </nav>
          <span className={`engine ${status ? "" : "engine--off"}`} title={status ? "Search engine is running locally" : "Cannot reach the local engine"}>
            <span className="engine__dot" />
            {status ? `Local engine · ${status.ollama_model}` : "Engine offline"}
          </span>
        </header>

        <div className="page">
          {!matter && onboarded ? (
            <div className="empty">
              <div className="empty__icon"><Icon.Folder /></div>
              <div className="empty__title">No matters yet</div>
              <p className="empty__text">Create a matter to keep each client’s or case’s documents separate.</p>
              <button className="btn btn--primary" onClick={() => setModal({ type: "new-matter" })}><Icon.Plus size={16} /> New matter</button>
            </div>
          ) : matter && (
            <>
              {view === "ask"       && <AskView {...shared} thread={threads[activeId] || []} setThread={setThread} />}
              {view === "documents" && <DocumentsView {...shared} />}
              {view === "saved"     && <SavedView {...shared} />}
              {view === "import"    && <ImportView {...shared} />}
              {view === "settings"  && <SettingsView {...shared} theme={theme} setTheme={setTheme} onDeleteMatter={() => deleteMatter(matter)} />}
            </>
          )}
        </div>
      </main>

      {modal?.type === "new-matter" && <NewMatterModal onClose={() => setModal(null)} onCreate={createMatter} />}
      {modal?.type === "confirm" && <ConfirmModal {...modal} onClose={() => setModal(null)} />}
      {toast && (
        <div key={toast.key} className={`toast toast--${toast.type}`} role="status">
          {toast.type === "success" && <Icon.Check size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
