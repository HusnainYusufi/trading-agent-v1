"""Run TradingAgents analyses in background threads and stream progress events.

Thin adapter over the repo: builds the graph exactly like TradingAgentsGraph.propagate()
does, but streams per-node state so the UI can show live agent progress, then performs
the same post-run steps (state log, memory-log entry, report tree).
"""
from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from pathlib import Path

import store

logger = logging.getLogger("webui.runner")

RATING_SCORE = {"buy": 1.0, "overweight": 0.5, "hold": 0.0, "underweight": -0.5, "sell": -1.0}

ANALYST_LABELS = {
    "market": "Market Analyst",
    "social": "Sentiment Analyst",
    "news": "News Analyst",
    "fundamentals": "Fundamentals Analyst",
}
ANALYST_REPORT_KEYS = {
    "market": "market_report",
    "social": "sentiment_report",
    "news": "news_report",
    "fundamentals": "fundamentals_report",
}
REPORT_SECTIONS = [
    ("market_report", "Market Analyst"),
    ("sentiment_report", "Sentiment Analyst"),
    ("news_report", "News Analyst"),
    ("fundamentals_report", "Fundamentals Analyst"),
    ("investment_plan", "Research Manager"),
    ("trader_investment_plan", "Trader"),
    ("final_trade_decision", "Portfolio Manager"),
]


class Run:
    def __init__(self, doc: dict):
        self.doc = doc
        self.events: list[dict] = []
        self.cond = threading.Condition()
        self.done = False

    def emit(self, type_: str, **data) -> None:
        with self.cond:
            self.events.append({"type": type_, "t": round(time.time(), 2), **data})
            if type_ in ("done", "error"):
                self.done = True
            self.cond.notify_all()


class RunManager:
    def __init__(self):
        self.runs: dict[str, Run] = {}
        self.lock = threading.Lock()

    def get(self, run_id: str) -> Run | None:
        return self.runs.get(run_id)

    def start(self, params: dict) -> dict:
        run_id = uuid.uuid4().hex[:12]
        doc = {
            "id": run_id,
            "ticker": params["ticker"],
            "canonical": None,
            "date": params["date"],
            "created_at": time.time(),
            "status": "running",
            "provider": params["provider"],
            "quick_model": params["quick_model"],
            "deep_model": params["deep_model"],
            "analysts": params["analysts"],
            "depth": params["depth"],
            "language": params.get("language", "English"),
            "rating": None, "direction": None, "confidence": None,
            "elapsed": None, "error": None, "reports": {}, "verdict": None,
        }
        run = Run(doc)
        with self.lock:
            self.runs[run_id] = run
        store.save_run(doc)
        threading.Thread(target=self._execute, args=(run,), daemon=True).start()
        return doc

    # --- worker ------------------------------------------------------------

    def _execute(self, run: Run) -> None:
        t0 = time.time()
        doc = run.doc
        try:
            from tradingagents.default_config import DEFAULT_CONFIG
            from tradingagents.dataflows.symbol_utils import normalize_symbol
            from tradingagents.graph.trading_graph import TradingAgentsGraph

            config = DEFAULT_CONFIG.copy()
            config["llm_provider"] = doc["provider"]
            config["quick_think_llm"] = doc["quick_model"]
            config["deep_think_llm"] = doc["deep_model"]
            config["backend_url"] = None
            config["max_debate_rounds"] = doc["depth"]
            config["max_risk_discuss_rounds"] = doc["depth"]
            config["output_language"] = doc.get("language", "English")
            config["llm_max_retries"] = 6

            doc["canonical"] = normalize_symbol(doc["ticker"])
            run.emit("stage", label=f"Resolving {doc['ticker']} → {doc['canonical']}, building graph")

            ta = TradingAgentsGraph(selected_analysts=doc["analysts"], debug=False, config=config)
            ta.ticker = doc["ticker"]

            # Resolve earlier pending memory-log entries for this ticker (scorecard fuel).
            try:
                ta._resolve_pending_entries(doc["ticker"])
            except Exception as exc:  # noqa: BLE001 - never block a new run on scoring
                logger.warning("pending-entry resolution failed: %s", exc)

            instrument_context = ta.resolve_instrument_context(doc["ticker"])
            init_state = ta.propagator.create_initial_state(
                doc["ticker"], doc["date"],
                past_context=ta.memory_log.get_past_context(doc["ticker"]),
                instrument_context=instrument_context,
            )
            run.emit("stage", label="Analysts running")

            final_state = None
            seen_sections: set[str] = set()
            for chunk in ta.graph.stream(init_state, **ta.propagator.get_graph_args()):
                final_state = chunk
                statuses = self._derive_statuses(doc["analysts"], chunk)
                run.emit("status", agents=statuses,
                         msgs=len(chunk.get("messages", [])),
                         debate=chunk.get("investment_debate_state", {}).get("count", 0),
                         risk=chunk.get("risk_debate_state", {}).get("count", 0))
                for key, label in REPORT_SECTIONS:
                    if chunk.get(key) and key not in seen_sections:
                        seen_sections.add(key)
                        doc["reports"][key] = chunk[key]
                        run.emit("section", key=key, label=label, chars=len(chunk[key]))

            # Post-run bookkeeping, mirroring propagate()'s tail end.
            self._collect_reports(doc, final_state)
            ta.curr_state = final_state
            ta._log_state(doc["date"], final_state)
            ta.memory_log.store_decision(
                ticker=doc["ticker"], trade_date=doc["date"],
                final_trade_decision=final_state["final_trade_decision"],
            )
            rating = ta.process_signal(final_state["final_trade_decision"])
            report_dir = Path(config["results_dir"]) / "webui" / f"{doc['id']}"
            ta.save_reports(final_state, doc["ticker"], save_path=report_dir)

            verdict = compute_verdict(rating, final_state)
            doc.update(status="done", rating=rating, elapsed=round(time.time() - t0, 1),
                       direction=verdict["direction"], confidence=verdict["confidence"],
                       verdict=verdict, report_dir=str(report_dir))
            store.save_run(doc)
            run.emit("done", rating=rating, direction=verdict["direction"],
                     confidence=verdict["confidence"], elapsed=doc["elapsed"])
        except Exception as exc:  # noqa: BLE001 - surface everything to the UI
            logger.exception("run %s failed", doc["id"])
            doc.update(status="error", error=f"{type(exc).__name__}: {exc}",
                       elapsed=round(time.time() - t0, 1))
            store.save_run(doc)
            run.emit("error", message=doc["error"])

    @staticmethod
    def _derive_statuses(analysts: list[str], chunk: dict) -> dict[str, str]:
        s: dict[str, str] = {}
        active_found = False
        for key in ("market", "social", "news", "fundamentals"):
            if key not in analysts:
                continue
            label = ANALYST_LABELS[key]
            if chunk.get(ANALYST_REPORT_KEYS[key]):
                s[label] = "completed"
            elif not active_found:
                s[label] = "in_progress"; active_found = True
            else:
                s[label] = "pending"
        debate = chunk.get("investment_debate_state", {})
        risk = chunk.get("risk_debate_state", {})
        if debate.get("judge_decision"):
            s["Research Team"] = "completed"
        elif debate.get("history"):
            s["Research Team"] = "in_progress"
        else:
            s["Research Team"] = "pending" if active_found else ("in_progress" if analysts and not active_found and all(chunk.get(ANALYST_REPORT_KEYS[a]) for a in analysts) else "pending")
        s["Trader"] = "completed" if chunk.get("trader_investment_plan") else (
            "in_progress" if debate.get("judge_decision") else "pending")
        if risk.get("judge_decision"):
            s["Risk Team"] = "completed"
        elif risk.get("history"):
            s["Risk Team"] = "in_progress"
        else:
            s["Risk Team"] = "pending"
        s["Portfolio Manager"] = "completed" if chunk.get("final_trade_decision") else (
            "in_progress" if risk.get("judge_decision") else "pending")
        return s

    @staticmethod
    def _collect_reports(doc: dict, final_state: dict) -> None:
        for key, _ in REPORT_SECTIONS:
            if final_state.get(key):
                doc["reports"][key] = final_state[key]
        debate = final_state.get("investment_debate_state") or {}
        risk = final_state.get("risk_debate_state") or {}
        for key, src, field in (
            ("bull_case", debate, "bull_history"), ("bear_case", debate, "bear_history"),
            ("risk_aggressive", risk, "aggressive_history"),
            ("risk_conservative", risk, "conservative_history"),
            ("risk_neutral", risk, "neutral_history"),
        ):
            if src.get(field):
                doc["reports"][key] = src[field]


# --- verdict ----------------------------------------------------------------

def compute_verdict(pm_rating: str, state: dict) -> dict:
    """Direction + a transparent 'signal alignment' confidence in [0, 100].

    Not a statistical probability: it measures how strongly and how unanimously
    the agent chain leaned, plus the sentiment analyst's own confidence when present.
    """
    from tradingagents.agents.utils.rating import parse_rating

    pm = RATING_SCORE.get(pm_rating.lower(), 0.0)
    rm = RATING_SCORE.get(parse_rating(state.get("investment_plan") or "").lower(), 0.0)
    m = re.search(r"FINAL TRANSACTION PROPOSAL:\s*\**\s*(BUY|HOLD|SELL)",
                  state.get("trader_investment_plan") or "", re.IGNORECASE)
    trader = {"buy": 1.0, "hold": 0.0, "sell": -1.0}.get((m.group(1).lower() if m else "hold"), 0.0)

    votes = [pm, rm, trader]
    if pm > 0:
        direction = "bullish"
    elif pm < 0:
        direction = "bearish"
    else:
        lean = rm + trader
        direction = "neutral" if lean == 0 else ("bullish-lean" if lean > 0 else "bearish-lean")

    def sign(x: float) -> int:
        return (x > 0) - (x < 0)

    ref = sign(pm) if pm != 0 else sign(rm + trader)
    agree = sum(1 for v in votes if sign(v) == ref or v == 0)
    alignment = agree / len(votes)

    sent_component = 0.5
    sent = state.get("sentiment_report") or ""
    conf_m = re.search(r"Confidence:\*{0,2}\s*(Low|Medium|High)", sent, re.IGNORECASE)
    if conf_m:
        sent_component = {"low": 0.25, "medium": 0.5, "high": 0.85}[conf_m.group(1).lower()]

    confidence = round(100 * (0.45 * abs(pm) + 0.35 * alignment + 0.20 * sent_component))
    return {
        "direction": direction,
        "confidence": confidence,
        "votes": {"portfolio_manager": pm_rating,
                  "research_manager": parse_rating(state.get("investment_plan") or ""),
                  "trader": (m.group(1).capitalize() if m else "Hold")},
        "alignment": round(alignment, 2),
        "note": "Signal alignment across Research Manager, Trader and Portfolio Manager - not a win-probability.",
    }


MANAGER = RunManager()
