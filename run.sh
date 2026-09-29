#!/bin/bash
# ==============================================================================
# UrbanFlow - Unified Launcher Script (Backend & Frontend)
# ==============================================================================

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo "======================================================================"
echo "  🚀 Starting UrbanFlow Simulation & Optimization Suite"
echo "======================================================================"
echo "  Root:     $ROOT_DIR"
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:3000"
echo "======================================================================"

# Ensure Python Virtual Environment
if [ ! -d "$BACKEND_DIR/venv" ]; then
    echo "⚙️ Creating backend Python virtual environment..."
    python3 -m venv "$BACKEND_DIR/venv"
    source "$BACKEND_DIR/venv/bin/activate"
    pip install --upgrade pip
    pip install -r "$BACKEND_DIR/requirements.txt"
else
    source "$BACKEND_DIR/venv/bin/activate"
fi

# Ensure frontend dependencies
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "⚙️ Installing frontend dependencies with pnpm..."
    cd "$FRONTEND_DIR" && pnpm install && cd "$ROOT_DIR"
fi

# Trap SIGINT/SIGTERM to cleanly kill both processes on Ctrl+C
cleanup() {
    echo ""
    echo "🛑 Shutting down UrbanFlow backend and frontend servers..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    echo "✅ All servers stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# 1. Start Backend FastAPI Server
echo "🌐 Starting Backend FastAPI Server on http://localhost:8000..."
cd "$BACKEND_DIR"
PYTHONPATH="$BACKEND_DIR" uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Wait for the backend to accept requests before starting the UI.
for _ in {1..50}; do
    if curl --silent --fail http://localhost:8000/api/health >/dev/null; then
        break
    fi
    sleep 0.2
done

# 2. Start Frontend Vite Dev Server
echo "⚡ Starting Frontend Dev Server..."
cd "$FRONTEND_DIR"
pnpm run dev &
FRONTEND_PID=$!

echo ""
echo "======================================================================"
echo "  ✨ UrbanFlow is RUNNING!"
echo "  👉 Frontend: http://localhost:3000"
echo "  👉 API Docs: http://localhost:8000/docs"
echo "  Press Ctrl+C to terminate both servers."
echo "======================================================================"

# Keep script running and wait for background processes
wait
