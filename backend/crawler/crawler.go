// Package crawler provides a concurrent web crawler that emits
// progress events on a channel so callers can stream them to the browser.
package crawler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	MaxConcurrent = 8
	RequestDelay  = 300 * time.Millisecond
	MinTextLen    = 200
)

// Event is one progress update sent to the browser via SSE.
type Event struct {
	Type    string `json:"type"`    // "page" | "done" | "error"
	URL     string `json:"url,omitempty"`
	Chars   int    `json:"chars,omitempty"`
	Page    int    `json:"page,omitempty"`
	MaxPage int    `json:"max_page,omitempty"`
	Chunks  int    `json:"chunks,omitempty"`
	Elapsed string `json:"elapsed,omitempty"`
	Message string `json:"message,omitempty"`
}

type Page struct {
	URL  string `json:"url"`
	Text string `json:"text"`
}

// Job configures a crawl run.
type Job struct {
	StartURL string
	MaxPages int
	SameHost bool
	Events   chan<- Event // caller reads from this
}

// Run crawls synchronously, emitting events, then closes Events.
func Run(job Job, embedderURL string) {
	defer close(job.Events)

	base, err := url.Parse(job.StartURL)
	if err != nil {
		job.Events <- Event{Type: "error", Message: "invalid URL: " + err.Error()}
		return
	}

	c := &crawler{
		job:     job,
		baseURL: base,
		sem:     make(chan struct{}, MaxConcurrent),
		queue:   make(chan string, 500),
	}

	t0 := time.Now()
	c.queue <- job.StartURL
	c.wg.Add(1)
	go c.worker()
	c.wg.Wait()

	// send collected pages to embedder
	chunks, err := sendToEmbedder(c.pages, embedderURL)
	if err != nil {
		job.Events <- Event{Type: "error", Message: "embedder error: " + err.Error()}
		return
	}

	job.Events <- Event{
		Type:    "done",
		Page:    len(c.pages),
		Chunks:  chunks,
		Elapsed: fmt.Sprintf("%.1fs", time.Since(t0).Seconds()),
	}
}

type crawler struct {
	job     Job
	baseURL *url.URL
	visited sync.Map
	pages   []Page
	mu      sync.Mutex
	sem     chan struct{}
	wg      sync.WaitGroup
	queue   chan string
}

func (c *crawler) worker() {
	defer c.wg.Done()
	for {
		select {
		case rawURL, ok := <-c.queue:
			if !ok {
				return
			}
			c.crawlOne(rawURL)
		default:
			time.Sleep(50 * time.Millisecond)
			if len(c.queue) == 0 {
				return
			}
		}
	}
}

func (c *crawler) crawlOne(rawURL string) {
	if _, loaded := c.visited.LoadOrStore(rawURL, true); loaded {
		return
	}

	c.mu.Lock()
	count := len(c.pages)
	c.mu.Unlock()
	if count >= c.job.MaxPages {
		return
	}

	if c.job.SameHost {
		u, err := url.Parse(rawURL)
		if err != nil || u.Host != c.baseURL.Host {
			return
		}
	}

	c.sem <- struct{}{}
	defer func() { <-c.sem }()

	time.Sleep(RequestDelay)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(rawURL)
	if err != nil {
		log.Printf("[crawler] skip %s: %v", rawURL, err)
		return
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") && !strings.Contains(ct, "text/plain") {
		return
	}

	text, hrefs := extractText(resp.Body)
	text = strings.TrimSpace(text)
	if len(text) < MinTextLen {
		return
	}

	c.mu.Lock()
	c.pages = append(c.pages, Page{URL: rawURL, Text: text})
	pageNum := len(c.pages)
	c.mu.Unlock()

	// emit progress event
	c.job.Events <- Event{
		Type:    "page",
		URL:     rawURL,
		Chars:   len(text),
		Page:    pageNum,
		MaxPage: c.job.MaxPages,
	}

	if pageNum >= c.job.MaxPages {
		return
	}

	base, _ := url.Parse(rawURL)
	for _, link := range resolveLinks(base, hrefs) {
		select {
		case c.queue <- link:
			c.wg.Add(1)
			go c.worker()
		default:
		}
	}
}

// ── HTML helpers ─────────────────────────────────────────────

func extractText(r io.Reader) (string, []string) {
	// Use a simple byte-by-byte approach to avoid importing golang.org/x/net/html
	// inside the backend module — we parse it ourselves.
	data, err := io.ReadAll(r)
	if err != nil {
		return "", nil
	}
	s := string(data)

	// Strip script/style blocks
	s = stripTags(s, "script")
	s = stripTags(s, "style")
	s = stripTags(s, "nav")
	s = stripTags(s, "footer")

	// Collect hrefs
	var links []string
	idx := 0
	for {
		i := strings.Index(s[idx:], "href=\"")
		if i == -1 {
			break
		}
		start := idx + i + 6
		end := strings.Index(s[start:], "\"")
		if end == -1 {
			break
		}
		links = append(links, s[start:start+end])
		idx = start + end
	}

	// Strip all remaining HTML tags
	var out strings.Builder
	inTag := false
	for _, ch := range s {
		if ch == '<' {
			inTag = true
			out.WriteRune(' ')
			continue
		}
		if ch == '>' {
			inTag = false
			continue
		}
		if !inTag {
			out.WriteRune(ch)
		}
	}

	// Decode common HTML entities
	text := out.String()
	text = strings.ReplaceAll(text, "&amp;", "&")
	text = strings.ReplaceAll(text, "&lt;", "<")
	text = strings.ReplaceAll(text, "&gt;", ">")
	text = strings.ReplaceAll(text, "&nbsp;", " ")
	text = strings.ReplaceAll(text, "&#39;", "'")
	text = strings.ReplaceAll(text, "&quot;", "\"")

	// Collapse whitespace
	words := strings.Fields(text)
	text = strings.Join(words, " ")

	return text, links
}

func stripTags(s, tag string) string {
	open := "<" + tag
	close := "</" + tag + ">"
	for {
		start := strings.Index(strings.ToLower(s), open)
		if start == -1 {
			break
		}
		end := strings.Index(strings.ToLower(s[start:]), close)
		if end == -1 {
			break
		}
		s = s[:start] + s[start+end+len(close):]
	}
	return s
}

func resolveLinks(base *url.URL, hrefs []string) []string {
	var resolved []string
	for _, href := range hrefs {
		href = strings.TrimSpace(href)
		if href == "" || strings.HasPrefix(href, "#") || strings.HasPrefix(href, "mailto:") {
			continue
		}
		u, err := url.Parse(href)
		if err != nil {
			continue
		}
		abs := base.ResolveReference(u)
		abs.Fragment = ""
		if abs.Scheme == "http" || abs.Scheme == "https" {
			resolved = append(resolved, abs.String())
		}
	}
	return resolved
}

// ── Send to embedder ─────────────────────────────────────────

func sendToEmbedder(pages []Page, embedderURL string) (int, error) {
	payload, _ := json.Marshal(map[string]interface{}{"pages": pages})
	resp, err := http.Post(embedderURL+"/crawl", "application/json", bytes.NewReader(payload))
	if err != nil {
		return 0, fmt.Errorf("embedder unavailable: %w", err)
	}
	defer resp.Body.Close()
	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	chunks := 0
	if v, ok := result["chunks_added"].(float64); ok {
		chunks = int(v)
	}
	return chunks, nil
}
