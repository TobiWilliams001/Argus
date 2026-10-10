const BASE = "http://localhost:8080/api"

export const UID = localStorage.getItem("argus_user_id") || (() => {
  const id = crypto.randomUUID()
  localStorage.setItem("argus_user_id", id)
  return id
})()

async function request(path, opts = {}) {
  const res = await fetch(BASE + path, opts)
  const data = await res.json().catch(() => ({}))
  if (!res.ok && !data.error) data.error = `Request failed (${res.status})`
  return data
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

const qs = (params) => "?" + new URLSearchParams({ user_id: UID, ...params })

export const api = {
  prefs:          ()               => request(`/prefs${qs({})}`),
  savePrefs:      (body)           => request("/prefs", json("POST", { user_id: UID, ...body })),
  status:         (col)            => request(`/status${qs({ collection_id: col })}`),

  matters:        ()               => request(`/collections${qs({})}`),
  createMatter:   (name, color)    => request("/collections", json("POST", { user_id: UID, name, color })),
  deleteMatter:   (id)             => request(`/collections/${id}${qs({})}`, { method: "DELETE" }),

  search:         (col, query)     => request("/search", json("POST", { user_id: UID, collection_id: col, query, top_k: 5 })),

  documents:      (col)            => request(`/documents${qs({ collection_id: col })}`),
  deleteDocument: (col, source)    => request(`/documents/${encodeURIComponent(source)}${qs({ collection_id: col })}`, { method: "DELETE" }),
  ingestText:     (col, text, source) => request("/ingest", json("POST", { user_id: UID, collection_id: col, text, source })),
  ingestPdf:      (col, file) => {
    const fd = new FormData()
    fd.append("file", file)
    fd.append("source", file.name)
    fd.append("user_id", UID)
    fd.append("collection_id", col)
    return request("/ingest-pdf", { method: "POST", body: fd })
  },
  ingestSamples:  (col)            => request(`/ingest-dir${qs({ collection_id: col })}`, { method: "POST" }),
  resetMatter:    (col)            => request("/reset", json("POST", { user_id: UID, collection_id: col })),

  saves:          (col)            => request(`/saves${qs({ collection_id: col })}`),
  save:           (col, chunk, query) => request("/saves", json("POST", {
    user_id: UID, collection_id: col, chunk_text: chunk.text, source: chunk.source, query, annotation: "",
  })),
  deleteSave:     (id)             => request(`/saves/${id}${qs({})}`, { method: "DELETE" }),
  annotate:       (id, annotation) => request(`/saves/${id}`, json("PATCH", { user_id: UID, annotation })),
}
