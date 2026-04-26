#!/bin/bash
# Argus Search — start.sh v2
# Usage: ./scripts/start.sh

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRN='\033[0;32m'; YLW='\033[1;33m'; RED='\033[0;31m'; CYN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYN}[argus]${NC} $1"; }
ok()   { echo -e "${GRN}[  ok  ]${NC} $1"; }
warn() { echo -e "${YLW}[ warn ]${NC} $1"; }
err()  { echo -e "${RED}[ err  ]${NC} $1"; exit 1; }

echo -e "\n${CYN}  ╔══════════════════════════════╗"
echo    "  ║  ARGUS  ·  local intelligence  ║"
echo -e "  ╚══════════════════════════════╝${NC}\n"

# ── environment fix ─────────────────────────────────────────
if ! command -v go &>/dev/null; then
  if [ -d "/usr/local/go/bin" ]; then
    export PATH="$PATH:/usr/local/go/bin"
  fi
fi

# Also check for Ollama in Applications if not in PATH
if ! command -v ollama &>/dev/null; then
  if [ -f "/Applications/Ollama.app/Contents/Resources/ollama" ]; then
    export PATH="$PATH:/Applications/Ollama.app/Contents/Resources"
  fi
fi

# ── prereqs ─────────────────────────────────────────────────
for cmd in python3 go node; do
  command -v "$cmd" &>/dev/null && ok "$cmd found" || err "$cmd not found"
done

if command -v ollama &>/dev/null; then
  ok "ollama found"; OLLAMA=true
else
  warn "ollama not found — answers will be extractive only"
  warn "install: https://ollama.ai"
  OLLAMA=false
fi

# ── Python venv + deps ───────────────────────────────────────
echo ""
log "Setting up Python environment…"

# Try to find a stable Python version first
PY_CMD=""
for cmd in python3.12 python3.11 python3; do
  if command -v "$cmd" &>/dev/null; then
    # Check if it's 3.14 (we want to avoid it if possible)
    VER=$("$cmd" --version 2>&1 | awk '{print $2}')
    if [[ ! "$VER" =~ ^3\.14 ]]; then
      PY_CMD="$cmd"
      break
    fi
    # If we only have 3.14, we'll store it but keep looking
    [ -z "$PY_CMD" ] && PY_CMD="$cmd"
  fi
done

log "Using $PY_CMD ($($PY_CMD --version))"

cd "$ROOT/embedder"
# If venv exists but is the wrong version, nuke it
if [ -d "venv" ]; then
  VENV_VER=$(./venv/bin/python --version 2>&1 | awk '{print $2}')
  if [[ "$VENV_VER" =~ ^3\.14 ]] && [[ ! "$($PY_CMD --version)" =~ ^3\.14 ]]; then
    warn "Nuking old 3.14 venv to switch to stable version"
    rm -rf venv
  fi
fi

[ ! -d "venv" ] && "$PY_CMD" -m venv venv
source venv/bin/activate

# Install packages one at a time with retries — handles slow/flaky connections
log "Installing Python dependencies (this takes a few minutes on first run)…"
pip install --upgrade pip -q
while IFS= read -r pkg || [[ -n "$pkg" ]]; do
  # Skip blank lines and comments
  [[ -z "$pkg" || "$pkg" == \#* ]] && continue
  for attempt in 1 2 3; do
    log "  Installing $pkg (attempt $attempt/3)…"
    pip install --timeout=120 --retries=3 "$pkg" && break
    warn "  Retrying $pkg…"
    sleep 3
  done
done < requirements.txt
ok "Python deps ready"

# ── Go backend ───────────────────────────────────────────────
echo ""
log "Fetching Go deps…"
cd "$ROOT/backend"
go mod tidy 2>/dev/null; go mod download
ok "Go backend deps ready"

# ── Crawler deps (optional) ──────────────────────────────────
if [ -f "$ROOT/crawler/go.mod" ]; then
  cd "$ROOT/crawler"
  go mod tidy 2>/dev/null; go mod download 2>/dev/null || true
  ok "Crawler deps ready"
fi

# ── Ollama ──────────────────────────────────────────────────
if [ "$OLLAMA" = true ]; then
  echo ""
  log "Starting Ollama…"
  if ! pgrep -x "ollama" > /dev/null; then
    ollama serve &>/dev/null &
    sleep 2
    log "Pulling llama3.2 (2GB)... this may take a while."
    ollama list 2>/dev/null | grep -q "llama3.2" || ollama pull llama3.2 || warn "Model pull failed (network issue), synthesis may be disabled."
    ok "Ollama ready"
  else
    ok "Ollama already running"
  fi
fi

# ── Python embedder ──────────────────────────────────────────
echo ""
log "Starting embedder on :8081…"
cd "$ROOT/embedder"
source venv/bin/activate
python3 embedder.py &
EMBEDDER_PID=$!
sleep 4
kill -0 $EMBEDDER_PID 2>/dev/null && ok "Embedder running (pid $EMBEDDER_PID)" || err "Embedder failed"

# ── Go backend ───────────────────────────────────────────────
echo ""
log "Starting backend on :8080…"
cd "$ROOT/backend"
go run main.go &
BACKEND_PID=$!
sleep 1
kill -0 $BACKEND_PID 2>/dev/null && ok "Backend running (pid $BACKEND_PID)" || err "Backend failed"

# ── Frontend ─────────────────────────────────────────────────
echo ""
log "Starting frontend on :3000…"
cd "$ROOT/frontend"
[ ! -d "node_modules" ] && npm install
npm run dev &>/dev/null &
FRONTEND_PID=$!
sleep 2
kill -0 $FRONTEND_PID 2>/dev/null && ok "Frontend running (pid $FRONTEND_PID)" || err "Frontend failed"

echo ""
echo -e "${GRN}════════════════════════════════════${NC}"
echo -e "${GRN}  Argus v2 is running${NC}"
echo -e "${GRN}════════════════════════════════════${NC}\n"
echo -e "  Frontend  →  ${CYN}http://localhost:3000${NC}"
echo -e "  Backend   →  ${CYN}http://localhost:8080${NC}"
echo -e "  Embedder  →  ${CYN}http://localhost:8081${NC}\n"
echo -e "  Crawler   →  ${YLW}Triggered via the 'Crawl' tab in the UI${NC}"
echo -e "\n  ${YLW}Ctrl+C${NC} to stop all services\n"

cleanup() {
  echo ""; log "Shutting down…"
  kill $FRONTEND_PID $BACKEND_PID $EMBEDDER_PID 2>/dev/null || true
  ok "All services stopped"
}
trap cleanup SIGINT SIGTERM
wait
