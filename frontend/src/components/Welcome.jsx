import { useState } from "react"
import { Icon } from "../icons"

const PROMISES = [
  { icon: Icon.Shield, title: "Your documents stay here", text: "Processing, search and answers all run on this machine." },
  { icon: Icon.Docs,   title: "Answers with citations",   text: "Every answer links to the exact passages it relied on." },
  { icon: Icon.Folder, title: "Organised by matter",       text: "Each client or case gets its own separate search index." },
]

export default function Welcome({ onDone }) {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  const start = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await onDone(name.trim()) } finally { setBusy(false) }
  }

  return (
    <div className="welcome">
      <form className="welcome__card" onSubmit={start}>
        <div className="brand">
          <span className="brand__mark"><Icon.Logo size={16} /></span>
          <span className="brand__name">Argus</span>
        </div>
        <h1 className="welcome__title">Private document search for your practice.</h1>
        <p className="welcome__sub">Ask questions across case files, contracts and correspondence, and get answers you can verify.</p>

        <div className="promises">
          {PROMISES.map(({ icon: I, title, text }) => (
            <div key={title} className="promise">
              <I size={18} />
              <div><strong>{title}</strong><span>{text}</span></div>
            </div>
          ))}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="your-name">Your name</label>
          <input id="your-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jordan Lee" autoFocus />
        </div>
        <button className="btn btn--primary btn--block" type="submit" disabled={busy} style={{ height: 40 }}>
          {busy ? <span className="spinner" /> : "Get started"}
        </button>
      </form>
    </div>
  )
}
