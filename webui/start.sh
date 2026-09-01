#!/usr/bin/env bash
# Start the TradingAgents web UI: FastAPI backend on :8642 + Next.js on :3000.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/.venv/bin/python" -m uvicorn app:app --app-dir "$ROOT/webui/backend" --host 127.0.0.1 --port 8642 &
BACK_PID=$!
trap "kill $BACK_PID 2>/dev/null" EXIT
cd "$ROOT/webui/frontend" && pnpm dev
