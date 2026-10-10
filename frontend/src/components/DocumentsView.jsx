import { useEffect, useState } from "react"
import { api } from "../api"
import { Icon } from "../icons"

const fmtDate = (s) => new Date(s * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

export default function DocumentsView({ matter, matterId, notify, refreshStatus, setView, setModal }) {
  const [docs, setDocs] = useState(null)
  const [filter, setFilter] = useState("")

  useEffect(() => {
    setDocs(null)
    api.documents(matterId).then(d => setDocs(Array.isArray(d) ? d : []))
  }, [matterId])

  const remove = (doc) => setModal({
    type: "confirm",
    title: `Remove “${doc.source}”?`,
    text: "The document and all of its passages will be removed from this matter’s search index.",
    action: "Remove document",
    onConfirm: async () => {
      setModal(null)
      const r = await api.deleteDocument(matterId, doc.source)
      if (r.error) return notify(r.error, "error")
      setDocs(d => d.filter(x => x.source !== doc.source))
      refreshStatus()
      notify("Document removed")
    },
  })

  const shown = (docs || []).filter(d => d.source.toLowerCase().includes(filter.toLowerCase()))
  const passages = (docs || []).reduce((n, d) => n + d.chunk_count, 0)

  return (
    <div className="page scroll" style={{ height: "100%" }}>
      <div className="page__inner">
        <div className="page__head">
          <div>
            <h1 className="page__title">Documents</h1>
            <p className="page__sub">
              {docs ? `${docs.length} document${docs.length === 1 ? "" : "s"} · ${passages.toLocaleString()} searchable passages in ${matter.name}` : "Loading…"}
            </p>
          </div>
          <button className="btn btn--primary" onClick={() => setView("import")}><Icon.Upload size={16} /> Import</button>
        </div>

        {docs && docs.length === 0 ? (
          <div className="card empty">
            <div className="empty__icon"><Icon.Docs /></div>
            <div className="empty__title">No documents in this matter</div>
            <p className="empty__text">Import PDFs or paste text. Everything is processed and stored on this machine.</p>
            <button className="btn btn--primary" onClick={() => setView("import")}>Import documents</button>
          </div>
        ) : docs && (
          <>
            {docs.length > 6 && (
              <div className="search-input" style={{ marginBottom: 12 }}>
                <input className="input" placeholder="Filter by name…" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter documents" />
              </div>
            )}
            <div className="card" style={{ overflow: "hidden" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="num">Passages</th>
                    <th className="hide-sm">Added</th>
                    <th className="actions"><span className="sr-only" /></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(d => (
                    <tr key={d.id}>
                      <td><span className="doc-name"><Icon.Docs size={16} /><span title={d.source}>{d.source}</span></span></td>
                      <td className="num">{d.chunk_count}</td>
                      <td className="hide-sm" style={{ color: "var(--muted)" }}>{fmtDate(d.created_at)}</td>
                      <td className="actions">
                        <button className="icon-btn" onClick={() => remove(d)} title="Remove document" aria-label={`Remove ${d.source}`}>
                          <Icon.Trash size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr><td colSpan={4} style={{ color: "var(--muted)", textAlign: "center", padding: 24 }}>No documents match “{filter}”.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
