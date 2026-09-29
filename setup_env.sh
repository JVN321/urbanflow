#!/usr/bin/env bash
# UrbanFlow Setup Script (Python venv + Node npm)
# Usage: ./setup_env.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "======================================================"
echo "      UrbanFlow Environment Initialization            "
echo "======================================================"

# 1. Detect Python 3
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "❌ Error: Python 3 is not installed or not in PATH."
    exit 1
fi

echo "Using Python: $($PYTHON_CMD --version)"

# 2. Create Python virtual environment in backend/venv if not exists
VENV_DIR="$PROJECT_ROOT/backend/venv"

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment in backend/venv..."
    $PYTHON_CMD -m venv "$VENV_DIR"
else
    echo "Virtual environment already exists in backend/venv."
fi

# 3. Activate venv and install backend requirements
echo "Installing backend dependencies from backend/requirements.txt..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install -r "$PROJECT_ROOT/backend/requirements.txt"

echo "✅ Backend dependencies installed successfully."

# 4. Initialize frontend npm packages (if npm is available)
if command -v npm &> /dev/null; then
    echo ""
    echo "Initializing frontend dependencies in frontend/..."
    cd "$PROJECT_ROOT/frontend"
    npm install
    cd "$PROJECT_ROOT"
    echo "✅ Frontend dependencies installed successfully."
fi

echo ""
echo "======================================================"
echo "  🎉 Setup Complete! Ready for Development             "
echo "======================================================"
echo ""
echo "▶ To run the Backend (Person B):"
echo "    cd backend"
echo "    source venv/bin/activate"
echo "    uvicorn app.main:app --reload --port 8000"
echo ""
echo "▶ To run the Frontend (Person A):"
echo "    cd frontend"
echo "    npm run dev"
echo "======================================================"
