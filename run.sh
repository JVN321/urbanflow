#!/bin/bash
# ==============================================================================
# UrbanFlow - Unified Launcher Script (Backend & Frontend)
# Automatically sources environment variables and Python virtual environment.
# ==============================================================================

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo "======================================================================"
echo "  🚀 Starting UrbanFlow Simulation & Optimization Suite"
echo "======================================================================"

# 1. Automatically Source Environment Files (.env)
if [ -f "$ROOT_DIR/.env" ]; then
    echo "📄 Sourcing root .env file..."
    set -a
    # shellcheck disable=SC1090
    source "$ROOT_DIR/.env"
    set +a
fi

if [ -f "$BACKEND_DIR/.env" ]; then
    echo "📄 Sourcing backend .env file..."
    set -a
    # shellcheck disable=SC1090
    source "$BACKEND_DIR/.env"
    set +a
fi

if [ -f "$FRONTEND_DIR/.env" ]; then
    echo "📄 Sourcing frontend .env file..."
    set -a
    # shellcheck disable=SC1090
    source "$FRONTEND_DIR/.env"
    set +a
fi

BACKEND_HOST="${HOST:-0.0.0.0}"
BACKEND_PORT="${PORT:-8000}"

echo "  Root:     $ROOT_DIR"
echo "  Backend:  http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "  Frontend: http://localhost:3000"
echo "======================================================================"

# 2. Automatically Source / Activate Python Virtual Environment
VENV_PATH=""
if [ -d "$BACKEND_DIR/venv" ]; then
    VENV_PATH="$BACKEND_DIR/venv"
elif [ -d "$ROOT_DIR/venv" ]; then
    VENV_PATH="$ROOT_DIR/venv"
elif [ -d "$ROOT_DIR/.venv" ]; then
    VENV_PATH="$ROOT_DIR/.venv"
elif [ -d "$BACKEND_DIR/.venv" ]; then
    VENV_PATH="$BACKEND_DIR/.venv"
fi

if [ -n "$VENV_PATH" ]; then
    echo "🐍 Sourcing Python virtual environment: $VENV_PATH..."
    # shellcheck disable=SC1090
    source "$VENV_PATH/bin/activate"
else
    echo "⚙️ Creating backend Python virtual environment in $BACKEND_DIR/venv..."
    python3 -m venv "$BACKEND_DIR/venv"
    # shellcheck disable=SC1090
    source "$BACKEND_DIR/venv/bin/activate"
    pip install --upgrade pip
    pip install -r "$BACKEND_DIR/requirements.txt"
fi

echo "  Active Python: $(which python) ($(python --version 2>&1))"

# 3. Detect Node Package Manager (pnpm preferred, fallback to npm)
if command -v pnpm &> /dev/null; then
    PKG_MGR="pnpm"
elif command -v npm &> /dev/null; then
    PKG_MGR="npm"
else
    echo "❌ Error: Neither pnpm nor npm is installed in PATH."
    exit 1
fi

# Ensure frontend dependencies are installed
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "⚙️ Installing frontend dependencies with $PKG_MGR..."
    cd "$FRONTEND_DIR" && $PKG_MGR install && cd "$ROOT_DIR"
fi

# 4. Clean Process Management & Signal Trapping
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    trap - SIGINT SIGTERM EXIT
    echo ""
    echo "🛑 Shutting down UrbanFlow backend and frontend servers..."
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
    [ -n "$BACKEND_PID" ] && wait "$BACKEND_PID" 2>/dev/null || true
    [ -n "$FRONTEND_PID" ] && wait "$FRONTEND_PID" 2>/dev/null || true
    echo "✅ All servers stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# 5. Start Backend FastAPI Server
echo "🌐 Starting Backend FastAPI Server on http://${BACKEND_HOST}:${BACKEND_PORT}..."
cd "$BACKEND_DIR"
PYTHONPATH="$BACKEND_DIR" uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" --reload &
BACKEND_PID=$!

# Wait for backend health check
for _ in {1..60}; do
    if curl --silent --fail "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
        break
    fi
    sleep 0.2
done

# 6. Start Frontend Dev Server
echo "⚡ Starting Frontend Dev Server with $PKG_MGR..."
cd "$FRONTEND_DIR"
$PKG_MGR run dev &
FRONTEND_PID=$!

echo ""
echo "======================================================================"
echo "  ✨ UrbanFlow is RUNNING!"
echo "  👉 Frontend: http://localhost:3000"
echo "  👉 API Docs: http://localhost:${BACKEND_PORT}/docs"
echo "  Press Ctrl+C to terminate both servers."
echo "======================================================================"

wait
