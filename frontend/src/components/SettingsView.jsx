import { api } from "../api"
import { Icon } from "../icons"

const THEMES = [["system", "System"], ["light", "Light"], ["dark", "Dark"]]

export default function SettingsView({ matter, matterId, status, notify, refreshStatus, setModal, theme, setTheme, onDeleteMatter }) {
  const clearDocuments = () => setModal({
    type: "confirm",
    title: `Remove all documents from “${matter.name}”?`,
    text: "Every document and its search index in this matter will be deleted from this machine. Saved passages are kept.",
    action: "Remove all documents",
    onConfirm: async () => {
      setModal(null)
      const r = await api.resetMatter(matterId)
      refreshStatus()
      notify(r.error ? r.error : "All documents removed", r.error ? "error" : "success")
    },
  })

  return (
    <div className="page scroll" style={{ height: "100%" }}>
      <div className="page__inner" style={{ maxWidth: 720 }}>
        <div className="page__head">
          <div>
            <h1 className="page__title">Settings</h1>
            <p className="page__sub">Engine status, privacy and data for this installation.</p>
          </div>
        </div>

        <div className="settings">
          <section className="card setting">
            <h2 className="setting__title">Engine</h2>
            <p className="setting__desc">Everything below runs on this machine. No document text is sent to external services.</p>
            <div className="facts">
              <Fact label="Status" value={status ? <><span className="ok">●</span> Running</> : "Offline"} />
              <Fact label="Answer model" value={status?.ollama_model ?? "—"} />
              <Fact label="Embedding model" value={status?.model ?? "—"} />
              <Fact label="Search index" value={status ? status.index.toUpperCase() : "—"} />
            </div>
          </section>

          <section className="card setting">
            <h2 className="setting__title">Privacy & security</h2>
            <div className="facts">
              <Fact label="Stored passages" value={status?.encrypted ? <><Icon.Lock size={14} /> AES-256-GCM encrypted</> : "Not encrypted"} />
              <Fact label="Cloud services" value={<><Icon.Shield size={14} /> None</>} />
            </div>
          </section>

          <section className="card setting">
            <h2 className="setting__title">Appearance</h2>
            <div className="theme-picker" role="radiogroup" aria-label="Theme">
              {THEMES.map(([id, label]) => (
                <button key={id} role="radio" aria-checked={theme === id} className={`tab ${theme === id ? "tab--active" : ""}`} onClick={() => setTheme(id)}>
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="card setting setting--danger">
            <h2 className="setting__title">Data in {matter.name}</h2>
            <div className="setting__row" style={{ marginTop: 12 }}>
              <div>
                <div style={{ fontWeight: 550 }}>Remove all documents</div>
                <div className="setting__desc">{status?.doc_count ?? 0} documents, {status?.chunk_count ?? 0} passages.</div>
              </div>
              <button className="btn btn--danger-ghost" onClick={clearDocuments} disabled={!status?.doc_count}>Remove all</button>
            </div>
            <div className="setting__row" style={{ marginTop: 16 }}>
              <div>
                <div style={{ fontWeight: 550 }}>Delete matter</div>
                <div className="setting__desc">Deletes the matter, its documents and saved passages.</div>
              </div>
              <button className="btn btn--danger-ghost" onClick={onDeleteMatter}>Delete matter</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div className="fact">
      <div className="fact__label">{label}</div>
      <div className="fact__value">{value}</div>
    </div>
  )
}
