import { useEffect, useState } from "react"

const COLORS = ["#24477a", "#2f6b46", "#8a5a14", "#a8321f", "#5b4b8a", "#3f6f78"]

function Modal({ onClose, children, label }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", esc)
    return () => document.removeEventListener("keydown", esc)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} onMouseDown={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function NewMatterModal({ onClose, onCreate }) {
  const [name, setName] = useState("")
  const [color, setColor] = useState(COLORS[0])
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    await onCreate(name.trim(), color)
    setBusy(false)
  }

  return (
    <Modal onClose={onClose} label="New matter">
      <form onSubmit={submit}>
        <h2 className="modal__title">New matter</h2>
        <p className="modal__text">Each matter has its own documents and search index.</p>
        <div className="field">
          <label className="field__label" htmlFor="matter-name">Name</label>
          <input id="matter-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Smith v. Jones (2026)" autoFocus />
        </div>
        <div className="field">
          <span className="field__label">Colour</span>
          <div className="swatches" role="radiogroup" aria-label="Colour">
            {COLORS.map(c => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                className={`swatch ${color === c ? "swatch--on" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <div className="row-end">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={!name.trim() || busy}>Create matter</button>
        </div>
      </form>
    </Modal>
  )
}

export function ConfirmModal({ title, text, action = "Confirm", onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal onClose={onClose} label={title}>
      <h2 className="modal__title">{title}</h2>
      <p className="modal__text">{text}</p>
      <div className="row-end">
        <button className="btn btn--ghost" onClick={onClose} autoFocus>Cancel</button>
        <button className="btn btn--danger" disabled={busy} onClick={async () => { setBusy(true); await onConfirm() }}>
          {action}
        </button>
      </div>
    </Modal>
  )
}
