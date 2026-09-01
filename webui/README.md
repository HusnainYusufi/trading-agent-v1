# TradingAgents Web UI

Local dashboard over the unchanged `tradingagents` engine: password login,
on-demand analysis runs with live agent progress (SSE), bullish/bearish verdict
with signal-alignment score, per-agent reports, run history, self-scoring
scorecard, and API-key settings for every supported LLM provider.

## Setup

```bash
# from the repo root
python -m venv .venv && .venv/bin/pip install -e . fastapi "uvicorn[standard]"
cd webui/frontend && pnpm install && cd ../..
webui/start.sh          # backend :8642 + frontend :3000
```

Open http://localhost:3000 — the first visit asks you to create a password.
Add provider API keys under Settings (stored in `~/.tradingagents/webui/keys.env`,
chmod 600, applied immediately).

## Deployment notes

- **Same-origin (recommended):** serve the built frontend and proxy `/api/*`
  to the backend on one hostname. The frontend automatically uses same-origin
  relative URLs on any non-localhost host, so no CORS setup is needed.
  Disable proxy buffering for `/api/runs/{id}/events` (SSE).
- **Split origins:** set `NEXT_PUBLIC_BACKEND` at frontend build time and add
  the frontend origin to `WEBUI_ALLOWED_ORIGINS` (comma-separated) on the backend.
- The backend binds 127.0.0.1:8642 by default; keep it behind the proxy.

Research tool — not financial advice.
