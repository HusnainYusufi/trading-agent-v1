"""Local persistence for the TradingAgents web UI.

Everything lives under ~/.tradingagents/webui/:
  config.json  - password hash + token secret + default run settings
  keys.env     - provider API keys (chmod 600), loaded into os.environ
  runs/*.json  - one metadata+reports document per analysis run
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

BASE = Path(os.path.expanduser("~")) / ".tradingagents" / "webui"
RUNS_DIR = BASE / "runs"
CONFIG_PATH = BASE / "config.json"
KEYS_PATH = BASE / "keys.env"

TOKEN_TTL = 7 * 24 * 3600


def ensure_dirs() -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


def _load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {}


def _save_config(cfg: dict) -> None:
    ensure_dirs()
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    os.chmod(CONFIG_PATH, 0o600)


# --- auth -------------------------------------------------------------------

def is_setup() -> bool:
    return "password_hash" in _load_config()


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()


def set_password(password: str) -> None:
    cfg = _load_config()
    salt = secrets.token_hex(16)
    cfg["password_salt"] = salt
    cfg["password_hash"] = _hash_password(password, salt)
    cfg.setdefault("token_secret", secrets.token_hex(32))
    _save_config(cfg)


def verify_password(password: str) -> bool:
    cfg = _load_config()
    if "password_hash" not in cfg:
        return False
    return hmac.compare_digest(cfg["password_hash"], _hash_password(password, cfg["password_salt"]))


def make_token() -> str:
    cfg = _load_config()
    ts = str(int(time.time()))
    sig = hmac.new(cfg["token_secret"].encode(), ts.encode(), hashlib.sha256).hexdigest()
    return f"{ts}.{sig}"


def verify_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    cfg = _load_config()
    if "token_secret" not in cfg:
        return False
    ts, sig = token.split(".", 1)
    expect = hmac.new(cfg["token_secret"].encode(), ts.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expect, sig):
        return False
    try:
        return time.time() - int(ts) < TOKEN_TTL
    except ValueError:
        return False


# --- provider keys ----------------------------------------------------------

def load_keys_into_env() -> None:
    """Load saved keys at startup. Saved keys win over ambient env so the UI is authoritative."""
    if not KEYS_PATH.exists():
        return
    for line in KEYS_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            if v:
                os.environ[k.strip()] = v.strip()


def save_key(env_var: str, value: str) -> None:
    ensure_dirs()
    lines: list[str] = []
    if KEYS_PATH.exists():
        lines = [
            ln for ln in KEYS_PATH.read_text(encoding="utf-8").splitlines()
            if not ln.startswith(f"{env_var}=")
        ]
    value = value.strip()
    if value:
        lines.append(f"{env_var}={value}")
        os.environ[env_var] = value
    else:
        os.environ.pop(env_var, None)
    KEYS_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.chmod(KEYS_PATH, 0o600)


def key_status() -> dict[str, str]:
    """env_var -> masked value ('' when unset). Never returns full secrets."""
    out: dict[str, str] = {}
    if KEYS_PATH.exists():
        for line in KEYS_PATH.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                v = v.strip()
                out[k.strip()] = (v[:4] + "…" + v[-4:]) if len(v) > 10 else ("set" if v else "")
    return out


# --- default run settings ---------------------------------------------------

def get_defaults() -> dict:
    cfg = _load_config()
    return cfg.get("defaults", {
        "provider": "google",
        "quick_model": "gemini-3.5-flash",
        "deep_model": "gemini-3.5-flash",
        "analysts": ["market", "news"],
        "depth": 1,
    })


def set_defaults(defaults: dict) -> None:
    cfg = _load_config()
    cfg["defaults"] = defaults
    _save_config(cfg)


# --- run documents ----------------------------------------------------------

def save_run(doc: dict) -> None:
    ensure_dirs()
    (RUNS_DIR / f"{doc['id']}.json").write_text(json.dumps(doc, indent=1), encoding="utf-8")


def get_run(run_id: str) -> dict | None:
    p = RUNS_DIR / f"{run_id}.json"
    if not p.exists() or "/" in run_id or ".." in run_id:
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def list_runs() -> list[dict]:
    ensure_dirs()
    docs = []
    for p in RUNS_DIR.glob("*.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            docs.append({k: d.get(k) for k in (
                "id", "ticker", "canonical", "date", "created_at", "status", "rating",
                "direction", "confidence", "elapsed", "provider", "quick_model",
                "deep_model", "analysts", "depth", "error",
            )})
        except (json.JSONDecodeError, OSError):
            continue
    docs.sort(key=lambda d: d.get("created_at") or 0, reverse=True)
    return docs
