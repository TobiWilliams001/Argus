package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func embedderReturning(status int, body string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		io.WriteString(w, body)
	}))
}

func TestProxiesPassEmbedderStatusThrough(t *testing.T) {
	embedder := embedderReturning(http.StatusBadRequest, `{"error":"invalid collection_id"}`)
	defer embedder.Close()

	cases := map[string]func(http.ResponseWriter){
		"GET":    func(w http.ResponseWriter) { proxyGet(w, embedder.URL) },
		"DELETE": func(w http.ResponseWriter) { proxyDelete(w, embedder.URL) },
		"PATCH": func(w http.ResponseWriter) {
			proxyPatch(w, httptest.NewRequest("PATCH", "/", strings.NewReader("{}")), embedder.URL)
		},
		"POST": func(w http.ResponseWriter) {
			proxyJSON(w, httptest.NewRequest("POST", "/", strings.NewReader("{}")), embedder.URL)
		},
	}
	for method, call := range cases {
		rec := httptest.NewRecorder()
		call(rec)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", method, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "invalid collection_id") {
			t.Errorf("%s: body %q lost the embedder's error", method, rec.Body.String())
		}
	}
}

func TestProxyReportsUnavailableEmbedder(t *testing.T) {
	embedder := embedderReturning(http.StatusOK, "{}")
	url := embedder.URL
	embedder.Close()

	rec := httptest.NewRecorder()
	proxyGet(rec, url)
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status %d, want 503", rec.Code)
	}
}
