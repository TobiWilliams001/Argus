import { useEffect, useRef, useState } from "react"
import { Icon } from "../icons"

const NAV = [
  { id: "ask",       label: "Ask",       icon: Icon.Ask },
  { id: "documents", label: "Documents", icon: Icon.Docs },
  { id: "saved",     label: "Saved",     icon: Icon.Bookmark },
  { id: "import",    label: "Import",    icon: Icon.Upload },
]

export default function Sidebar({
  matters, matter, onSelect, onNewMatter, view, setView, docCount, encrypted,
  onCollapse, onNewQuestion, theme, setTheme,
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", esc)
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc) }
  }, [open])

  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand__mark"><Icon.Logo size={16} /></span>
        <span className="brand__name">Argus</span>
        <button className="icon-btn" onClick={onCollapse} title="Hide sidebar" aria-label="Hide sidebar">
          <Icon.Sidebar />
        </button>
      </div>

      <div className="matter-switch" ref={ref}>
        <button className="matter-switch__btn" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
          <span className="dot" style={{ background: matter?.color || "var(--border-2)" }} />
          <span className="matter-switch__text">
            <span className="matter-switch__label">Matter</span>
            <span className="matter-switch__name">{matter?.name || "Select a matter"}</span>
          </span>
          <Icon.Chevron size={16} className={`matter-switch__chev ${open ? "matter-switch__chev--open" : ""}`} />
        </button>

        {open && (
          <div className="menu" role="listbox">
            {matters.map(m => (
              <button
                key={m.id}
                role="option"
                aria-selected={m.id === matter?.id}
                className={`menu__item ${m.id === matter?.id ? "menu__item--active" : ""}`}
                onClick={() => { onSelect(m.id); setOpen(false) }}
              >
                <span className="dot" style={{ background: m.color }} />
                {m.name}
                {m.id === matter?.id && <Icon.Check size={15} className="check" />}
              </button>
            ))}
            {matters.length > 0 && <div className="menu__sep" />}
            <button className="menu__item menu__item--muted" onClick={() => { setOpen(false); onNewMatter() }}>
              <Icon.Plus size={15} /> New matter
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: "0 12px" }}>
        <button className="btn btn--secondary btn--block" onClick={onNewQuestion} disabled={!matter}>
          <Icon.Plus size={16} /> New question
        </button>
      </div>

      <nav className="nav" aria-label="Main">
        <div className="nav__label">Workspace</div>
        {NAV.map(({ id, label, icon: I }) => (
          <button
            key={id}
            className={`nav__item ${view === id ? "nav__item--active" : ""}`}
            onClick={() => setView(id)}
            aria-current={view === id ? "page" : undefined}
          >
            <I />
            {label}
            {id === "documents" && docCount > 0 && <span className="nav__count">{docCount}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="privacy">
          <Icon.Shield size={16} />
          <div>
            <strong>Private by design</strong>
            Runs on this machine{encrypted ? ", encrypted at rest" : ""}. Nothing is sent to the cloud.
          </div>
        </div>
        <div className="sidebar__actions">
          <button
            className={`nav__item ${view === "settings" ? "nav__item--active" : ""}`}
            style={{ flex: 1 }}
            onClick={() => setView("settings")}
          >
            <Icon.Settings /> Settings
          </button>
          <button
            className="icon-btn"
            onClick={() => setTheme(dark ? "light" : "dark")}
            title={dark ? "Switch to light theme" : "Switch to dark theme"}
            aria-label="Toggle theme"
          >
            {dark ? <Icon.Sun /> : <Icon.Moon />}
          </button>
        </div>
      </div>
    </aside>
  )
}
