import { useRef, useState } from "react"
import { api } from "../api"
import { Icon } from "../icons"

const TABS = [
  { id: "files", label: "Upload PDFs", icon: Icon.Upload },
  { id: "text",  label: "Paste text",  icon: Icon.Text },
  { id: "sample", label: "Sample documents", icon: Icon.Folder },
]

export default function ImportView({ matter, matterId, notify, refreshStatus }) {
  const [tab, setTab] = useState("files")

  return (
    <div className="page scroll" style={{ height: "100%" }}>
      <div className="page__inner" style={{ maxWidth: 720 }}>
        <div className="page__head">
          <div>
            <h1 className="page__title">Import documents</h1>
            <p className="page__sub">Add documents to {matter.name}. They’re processed and stored on this machine only.</p>
          </div>
        </div>

        <div className="tabs" role="tablist">
          {TABS.map(({ id, label, icon: I }) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "tab--active" : ""}`} onClick={() => setTab(id)}>
              <I size={15} /> {label}
            </button>
          ))}
        </div>

        {tab === "files"  && <FileUpload matterId={matterId} notify={notify} refreshStatus={refreshStatus} />}
        {tab === "text"   && <PasteText matterId={matterId} notify={notify} refreshStatus={refreshStatus} />}
        {tab === "sample" && <Samples matterId={matterId} notify={notify} refreshStatus={refreshStatus} />}
      </div>
    </div>
  )
}

function FileUpload({ matterId, notify, refreshStatus }) {
  const [over, setOver] = useState(false)
  const [items, setItems] = useState([])
  const input = useRef(null)

  const upload = async (files) => {
    const pdfs = [...files].filter(f => f.name.toLowerCase().endsWith(".pdf"))
    if (pdfs.length < files.length) notify("Only PDF files are supported here", "error")
    if (!pdfs.length) return
    const start = items.length
    setItems(it => [...it, ...pdfs.map(f => ({ name: f.name, state: "uploading" }))])
    let ok = 0
    for (const [i, file] of pdfs.entries()) {
      let next
      try {
        const r = await api.ingestPdf(matterId, file)
        next = r.error ? { state: "error", msg: r.error } : { state: "done", msg: `${r.chunks_added} passages` }
      } catch {
        next = { state: "error", msg: "Upload failed" }
      }
      if (next.state === "done") ok++
      setItems(it => it.map((x, j) => (j === start + i ? { ...x, ...next } : x)))
    }
    refreshStatus()
    if (ok) notify(`Imported ${ok} document${ok === 1 ? "" : "s"}`)
  }

  return (
    <>
      <input ref={input} type="file" accept=".pdf,application/pdf" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = "" }} />
      <div
        className={`drop ${over ? "drop--over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click() }}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) }}
      >
        <span className="drop__icon"><Icon.Upload size={20} /></span>
        <span className="drop__title">Drop PDFs here, or click to browse</span>
        <span className="drop__hint">Text is extracted page by page. Up to 50 MB per file.</span>
      </div>

      {items.length > 0 && (
        <div className="card uploads" style={{ padding: "4px 16px" }}>
          {items.map((it, i) => (
            <div key={i} className="upload">
              <Icon.Docs size={16} />
              <span className="upload__name">{it.name}</span>
              {it.state === "uploading" ? (
                <span className="upload__state" style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="spinner" /> Processing</span>
              ) : (
                <span className={`upload__state upload__state--${it.state}`}>{it.state === "done" ? `✓ ${it.msg}` : it.msg}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function PasteText({ matterId, notify, refreshStatus }) {
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const r = await api.ingestText(matterId, text, name.trim() || `Note ${new Date().toLocaleString()}`)
    setBusy(false)
    if (r.error) return notify(r.error, "error")
    setText("")
    setName("")
    refreshStatus()
    notify(`Imported · ${r.chunks_added} passages`)
  }

  return (
    <div className="card panel-card">
      <div className="field">
        <label className="field__label" htmlFor="doc-name">Document name</label>
        <input id="doc-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Engagement letter — Smith v. Jones" />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="doc-text">Text</label>
        <textarea id="doc-text" className="textarea" rows={10} value={text} onChange={e => setText(e.target.value)} placeholder="Paste the document text here…" />
        <span className="field__hint">{text.trim() ? `${text.trim().split(/\s+/).length.toLocaleString()} words` : "Emails, notes, clauses or full documents."}</span>
      </div>
      <div className="row-end">
        <button className="btn btn--primary" onClick={submit} disabled={!text.trim() || busy}>
          {busy ? <span className="spinner" /> : <Icon.Upload size={16} />} Import text
        </button>
      </div>
    </div>
  )
}

function Samples({ matterId, notify, refreshStatus }) {
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    const r = await api.ingestSamples(matterId)
    setBusy(false)
    refreshStatus()
    notify(r.error ? r.error : `Imported ${r.ingested} sample documents`, r.error ? "error" : "success")
  }
  return (
    <div className="card panel-card">
      <p className="panel-card__desc">
        Load the bundled sample documents to try Argus before importing your own files. You can remove them later from Documents.
      </p>
      <button className="btn btn--secondary" onClick={load} disabled={busy}>
        {busy ? <span className="spinner" /> : <Icon.Folder size={16} />} Load sample documents
      </button>
    </div>
  )
}
