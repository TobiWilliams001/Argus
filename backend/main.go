package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rs/cors"
)

const (
	PORT         = "8080"
	EMBEDDER_URL = "http://localhost:8081"
	DOCS_DIR     = "../docs-sample"
	MAX_PDF_SIZE = 50 << 20
)

func main() {
	mux := http.NewServeMux()

	// core
	mux.HandleFunc("/api/ingest",      handleIngest)
	mux.HandleFunc("/api/ingest-pdf",  handleIngestPDF)
	mux.HandleFunc("/api/search",      handleSearch)
	mux.HandleFunc("/api/status",      handleStatus)
	mux.HandleFunc("/api/reset",       handleReset)
	mux.HandleFunc("/api/ingest-dir",  handleIngestDir)

	// collections
	mux.HandleFunc("/api/collections",    handleCollections)
	mux.HandleFunc("/api/collections/",   handleCollectionItem)

	// documents (source browser)
	mux.HandleFunc("/api/documents",      handleDocuments)
	mux.HandleFunc("/api/documents/",     handleDocumentItem)

	// saves (highlights)
	mux.HandleFunc("/api/saves",          handleSaves)
	mux.HandleFunc("/api/saves/",         handleSaveItem)

	// onboarding + prefs
	mux.HandleFunc("/api/prefs", handlePrefs)

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"http://localhost:3000", "http://localhost:5173"},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type"},
	}).Handler(mux)

	fmt.Printf("Argus backend v3 → http://localhost:%s\n", PORT)
	log.Fatal(http.ListenAndServe(":"+PORT, handler))
}

// ── helpers ───────────────────────────────────────────────────

func proxyJSON(w http.ResponseWriter, r *http.Request, target string) {
	body, _ := io.ReadAll(r.Body)
	resp, err := http.Post(target, "application/json", bytes.NewReader(body))
	if err != nil {
		http.Error(w, "embedder unavailable: "+err.Error(), 503)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func proxyGet(w http.ResponseWriter, url string) {
	resp, err := http.Get(url)
	if err != nil {
		http.Error(w, "embedder unavailable", 503)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

func proxyDelete(w http.ResponseWriter, url string) {
	req, _ := http.NewRequest("DELETE", url, nil)
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		http.Error(w, "embedder unavailable", 503)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

func proxyPatch(w http.ResponseWriter, r *http.Request, url string) {
	body, _ := io.ReadAll(r.Body)
	req, _  := http.NewRequest("PATCH", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		http.Error(w, "embedder unavailable", 503)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

func queryString(r *http.Request) string {
	q := r.URL.RawQuery
	if q != "" {
		return "?" + q
	}
	return ""
}

// ── core routes ───────────────────────────────────────────────

func handleIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		proxyJSON(w, r, EMBEDDER_URL+"/ingest")
	}
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		proxyJSON(w, r, EMBEDDER_URL+"/search")
	}
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	proxyGet(w, EMBEDDER_URL+"/status"+queryString(r))
}

func handleReset(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		proxyJSON(w, r, EMBEDDER_URL+"/reset")
	}
}

func handleIngestPDF(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MAX_PDF_SIZE)
	r.ParseMultipartForm(MAX_PDF_SIZE)

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing file", 400)
		return
	}
	defer file.Close()
	pdfBytes, _ := io.ReadAll(file)

	var buf bytes.Buffer
	mw   := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("file", header.Filename)
	part.Write(pdfBytes)
	mw.WriteField("source",        r.FormValue("source"))
	mw.WriteField("user_id",       r.FormValue("user_id"))
	mw.WriteField("collection_id", r.FormValue("collection_id"))
	mw.Close()

	req, _ := http.NewRequest("POST", EMBEDDER_URL+"/ingest-pdf", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		http.Error(w, "embedder unavailable", 503)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

func handleIngestDir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		return
	}
	dir       := DOCS_DIR
	userID    := r.URL.Query().Get("user_id")
	colID     := r.URL.Query().Get("collection_id")
	if userID == "" { userID = "default" }
	if colID  == "" { colID  = "default" }

	count := 0
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() { return nil }
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".txt" && ext != ".md" { return nil }
		content, err := os.ReadFile(path)
		if err != nil { return nil }
		payload, _ := json.Marshal(map[string]string{
			"text": string(content), "source": filepath.Base(path),
			"user_id": userID, "collection_id": colID,
		})
		http.Post(EMBEDDER_URL+"/ingest", "application/json", bytes.NewReader(payload))
		count++
		return nil
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ingested": count})
}

// ── collections ───────────────────────────────────────────────

func handleCollections(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		proxyGet(w, EMBEDDER_URL+"/collections"+queryString(r))
	case http.MethodPost:
		proxyJSON(w, r, EMBEDDER_URL+"/collections")
	}
}

func handleCollectionItem(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/collections/")
	if r.Method == http.MethodDelete {
		proxyDelete(w, EMBEDDER_URL+"/collections/"+id+queryString(r))
	}
}

// ── documents ─────────────────────────────────────────────────

func handleDocuments(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		proxyGet(w, EMBEDDER_URL+"/documents"+queryString(r))
	}
}

func handleDocumentItem(w http.ResponseWriter, r *http.Request) {
	source := strings.TrimPrefix(r.URL.Path, "/api/documents/")
	if r.Method == http.MethodDelete {
		proxyDelete(w, EMBEDDER_URL+"/documents/"+source+queryString(r))
	}
}

// ── saves ─────────────────────────────────────────────────────

func handleSaves(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		proxyGet(w, EMBEDDER_URL+"/saves"+queryString(r))
	case http.MethodPost:
		proxyJSON(w, r, EMBEDDER_URL+"/saves")
	}
}

func handleSaveItem(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/saves/")
	switch r.Method {
	case http.MethodDelete:
		proxyDelete(w, EMBEDDER_URL+"/saves/"+id+queryString(r))
	case http.MethodPatch:
		proxyPatch(w, r, EMBEDDER_URL+"/saves/"+id)
	}
}

func handlePrefs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		proxyGet(w, EMBEDDER_URL+"/prefs"+queryString(r))
	case http.MethodPost:
		proxyJSON(w, r, EMBEDDER_URL+"/prefs")
	}
}
