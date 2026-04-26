package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html"
)

// ── Config ──────────────────────────────────────────────────
const (
	EMBEDDER_URL   = "http://localhost:8081"
	MAX_CONCURRENT = 8   // goroutines crawling in parallel
	MAX_PAGES      = 50  // hard stop per crawl job
	REQUEST_DELAY  = 300 // ms between requests per worker
)

type CrawlJob struct {
	StartURL string `json:"url"`
	MaxPages int    `json:"max_pages"`
	SameHost bool   `json:"same_host"` // stay on same domain
}

type Page struct {
	URL  string `json:"url"`
	Text string `json:"text"`
}

type CrawlResult struct {
	PagesFound  int    `json:"pages_found"`
	ChunksAdded int    `json:"chunks_added"`
	Elapsed     string `json:"elapsed"`
}

// ── HTML text extraction ─────────────────────────────────────

func extractText(r io.Reader) (string, []string) {
	doc, err := html.Parse(r)
	if err != nil {
		return "", nil
	}
	var text strings.Builder
	var links []string
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		// skip script/style/nav/footer nodes
		if n.Type == html.ElementNode {
			skip := map[string]bool{
				"script": true, "style": true, "nav": true,
				"footer": true, "header": true, "noscript": true,
			}
			if skip[n.Data] {
				return
			}
			// collect href links
			if n.Data == "a" {
				for _, attr := range n.Attr {
					if attr.Key == "href" {
						links = append(links, attr.Val)
					}
				}
			}
		}
		if n.Type == html.TextNode {
			s := strings.TrimSpace(n.Data)
			if s != "" {
				text.WriteString(s)
				text.WriteString(" ")
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return text.String(), links
}

func resolveLinks(base *url.URL, hrefs []string) []string {
	var resolved []string
	for _, href := range hrefs {
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

// ── Crawler ──────────────────────────────────────────────────

type Crawler struct {
	job     CrawlJob
	visited sync.Map
	pages   []Page
	mu      sync.Mutex
	sem     chan struct{}
	wg      sync.WaitGroup
	queue   chan string
	baseURL *url.URL
}

func NewCrawler(job CrawlJob) *Crawler {
	limit := job.MaxPages
	if limit == 0 || limit > MAX_PAGES {
		limit = MAX_PAGES
	}
	job.MaxPages = limit

	base, _ := url.Parse(job.StartURL)
	return &Crawler{
		job:     job,
		sem:     make(chan struct{}, MAX_CONCURRENT),
		queue:   make(chan string, 500),
		baseURL: base,
	}
}

func (c *Crawler) Run() []Page {
	c.queue <- c.job.StartURL
	c.wg.Add(1)
	go c.worker()
	c.wg.Wait()
	return c.pages
}

func (c *Crawler) worker() {
	defer c.wg.Done()

	for {
		select {
		case rawURL, ok := <-c.queue:
			if !ok {
				return
			}
			c.crawlOne(rawURL)
		default:
			// queue empty — try to drain a bit
			time.Sleep(50 * time.Millisecond)
			if len(c.queue) == 0 {
				return
			}
		}
	}
}

func (c *Crawler) crawlOne(rawURL string) {
	// de-duplicate
	if _, loaded := c.visited.LoadOrStore(rawURL, true); loaded {
		return
	}

	c.mu.Lock()
	if len(c.pages) >= c.job.MaxPages {
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()

	// same-host guard
	if c.job.SameHost {
		u, err := url.Parse(rawURL)
		if err != nil || u.Host != c.baseURL.Host {
			return
		}
	}

	c.sem <- struct{}{} // acquire concurrency slot
	defer func() { <-c.sem }()

	time.Sleep(time.Duration(REQUEST_DELAY) * time.Millisecond)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(rawURL)
	if err != nil {
		log.Printf("[crawler] GET %s error: %v", rawURL, err)
		return
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") && !strings.Contains(ct, "text/plain") {
		return
	}

	text, hrefs := extractText(resp.Body)
	text = strings.TrimSpace(text)
	if len(text) < 200 {
		return // skip thin pages
	}

	c.mu.Lock()
	c.pages = append(c.pages, Page{URL: rawURL, Text: text})
	pageCount := len(c.pages)
	c.mu.Unlock()

	log.Printf("[crawler] ✓ %s (%d chars, page %d/%d)", rawURL, len(text), pageCount, c.job.MaxPages)

	if pageCount >= c.job.MaxPages {
		return
	}

	// enqueue discovered links
	base, _ := url.Parse(rawURL)
	for _, link := range resolveLinks(base, hrefs) {
		select {
		case c.queue <- link:
			c.wg.Add(1)
			go c.worker()
		default:
			// queue full — skip
		}
	}
}

// ── Send pages to embedder ───────────────────────────────────

func sendToEmbedder(pages []Page) (int, error) {
	payload, _ := json.Marshal(map[string]interface{}{"pages": pages})
	resp, err := http.Post(EMBEDDER_URL+"/crawl", "application/json", bytes.NewReader(payload))
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

// ── Main ─────────────────────────────────────────────────────

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: crawler <url> [max_pages]")
		fmt.Println("Example: ./crawler https://go.dev/doc 20")
		os.Exit(1)
	}

	startURL := os.Args[1]
	maxPages := MAX_PAGES
	if len(os.Args) >= 3 {
		fmt.Sscanf(os.Args[2], "%d", &maxPages)
	}

	job := CrawlJob{
		StartURL: startURL,
		MaxPages: maxPages,
		SameHost: true,
	}

	log.Printf("Crawling %s (max %d pages, %d concurrent workers)", startURL, maxPages, MAX_CONCURRENT)
	t0 := time.Now()

	crawler := NewCrawler(job)
	pages := crawler.Run()

	log.Printf("Crawl done: %d pages in %s. Sending to embedder…", len(pages), time.Since(t0))

	chunks, err := sendToEmbedder(pages)
	if err != nil {
		log.Fatalf("Failed to send to embedder: %v", err)
	}

	elapsed := time.Since(t0)
	fmt.Printf("\nDone.\n  Pages crawled : %d\n  Chunks indexed: %d\n  Time elapsed  : %s\n", len(pages), chunks, elapsed)
}
