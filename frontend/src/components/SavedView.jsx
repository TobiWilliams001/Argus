import { useEffect, useState } from "react"
import { api } from "../api"
import { Icon } from "../icons"

export default function SavedView({ matterId, notify, setView }) {
  const [saves, setSaves] = useState(null)

  useEffect(() => {
    setSaves(null)
    api.saves(matterId).then(s => setSaves(Array.isArray(s) ? s : []))
  }, [matterId])

  const remove = async (id) => {
    await api.deleteSave(id)
    setSaves(s => s.filter(x => x.id !== id))
    notify("Removed from saved")
  }

  const annotate = async (id, value, original) => {
    if (value === original) return
    await api.annotate(id, value)
    setSaves(s => s.map(x => (x.id === id ? { ...x, annotation: value } : x)))
    notify("Note saved")
  }

  return (
    <div className="page scroll" style={{ height: "100%" }}>
      <div className="page__inner" style={{ maxWidth: 780 }}>
        <div className="page__head">
          <div>
            <h1 className="page__title">Saved passages</h1>
            <p className="page__sub">Passages you’ve kept from answers, with your notes.</p>
          </div>
        </div>

        {saves && saves.length === 0 ? (
          <div className="card empty">
            <div className="empty__icon"><Icon.Bookmark /></div>
            <div className="empty__title">Nothing saved yet</div>
            <p className="empty__text">When a source passage is useful, select Save in the sources panel to keep it here.</p>
            <button className="btn btn--secondary" onClick={() => setView("ask")}>Ask a question</button>
          </div>
        ) : (
          <div className="saves">
            {(saves || []).map(s => (
              <article key={s.id} className="card save">
                <div className="save__head">
                  <Icon.Docs size={15} />
                  <span className="save__source">{s.source}</span>
                  <span>· {new Date(s.created_at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  <button className="icon-btn" onClick={() => remove(s.id)} title="Remove" aria-label="Remove saved passage">
                    <Icon.Trash size={15} />
                  </button>
                </div>
                <blockquote className="save__text">{s.chunk_text}</blockquote>
                {s.query && <p className="save__query">Saved from: “{s.query}”</p>}
                <textarea
                  className="textarea save__note"
                  placeholder="Add a note…"
                  defaultValue={s.annotation}
                  onBlur={(e) => annotate(s.id, e.target.value, s.annotation)}
                  aria-label="Note"
                />
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
