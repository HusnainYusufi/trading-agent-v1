"""Extract an actionable trade plan from a completed run's reports.

One structured-output call on the run's own provider/quick model. The prompt
constrains the model to levels already present in the agent reports, so this is
an extraction step, not a second opinion. Mirrors the engine's structured
pattern (schema -> typed instance -> graceful None on failure).
"""
from __future__ import annotations

import json
import logging
import re

from pydantic import BaseModel, Field

logger = logging.getLogger("webui.tradeplan")


class PriceLevel(BaseModel):
    price: float = Field(description="The exact price level, copied from the reports.")
    basis: str = Field(description="Short basis for the level, e.g. '10 EMA retest', '50 SMA', 'March crash low'. Max 8 words.")


class TradePlan(BaseModel):
    """Actionable levels distilled from the analysts' reports. Copy numbers, never invent."""

    direction: str = Field(description="'long', 'short', or 'no-trade' (when the decision is a pure Hold with no actionable setup).")
    horizon: str | None = Field(default=None, description="Trade horizon stated or implied by the decision, e.g. '4-8 weeks', '3-10 sessions'.")
    entry: PriceLevel | None = Field(default=None, description="Primary entry level or zone midpoint. None only for no-trade.")
    entry_fallback: PriceLevel | None = Field(default=None, description="Secondary entry if the primary never fills (e.g. deeper pullback zone).")
    stop_loss: PriceLevel | None = Field(default=None, description="Hard stop level. None only for no-trade.")
    take_profits: list[PriceLevel] = Field(default_factory=list, description="1-3 targets in order (TP1 first). Empty only for no-trade.")
    invalidation: str | None = Field(default=None, description="The specific condition that voids the idea (e.g. 'daily close above 4,640'). One sentence.")
    trigger: str | None = Field(default=None, description="For no-trade only: the level/condition that would activate a long or short.")
    sizing_note: str | None = Field(default=None, description="Position-sizing guidance from the reports, e.g. 'size 30-40% below normal, ATR 80'.")


def _rr(plan: TradePlan) -> list[float]:
    """Risk-reward multiple per TP, computed here so the UI never does math."""
    if not plan.entry or not plan.stop_loss:
        return []
    risk = abs(plan.entry.price - plan.stop_loss.price)
    if risk == 0:
        return []
    return [round(abs(tp.price - plan.entry.price) / risk, 1) for tp in plan.take_profits]


PROMPT = """You are a trade-plan extractor. Below are the finished reports of a multi-agent \
analysis of {ticker} (final rating: {rating}). Distill them into ONE actionable plan.

Hard rules:
- Use ONLY price levels that literally appear in the reports. Never invent or interpolate a number.
- direction: 'short' for Sell/Underweight, 'long' for Buy/Overweight. For Hold: 'no-trade' unless the \
reports explicitly describe an actionable conditional setup, in which case use its direction.
- entry = the level the reports say to act at (e.g. 'sell rallies into X', 'buy the dip at Y'), not the current price.
- entry_fallback = the alternative entry the reports mention (deeper zone / breakout retest), if any.
- take_profits: up to 3, nearest first, each with its basis.
- invalidation: the exact voiding condition stated in the reports, ONE short sentence.
- For 'no-trade' you MUST fill `trigger` with the specific activation condition and its level(s) (e.g. 'long on stabilization at 4,201-4,218 (lower Bollinger / 50 SMA)', 'short on daily close below X').

=== FINAL DECISION (Portfolio Manager) ===
{final}

=== TRADER PROPOSAL ===
{trader}

=== RESEARCH MANAGER PLAN ===
{plan}

=== MARKET REPORT (levels source) ===
{market}"""


def extract_trade_plan(doc: dict) -> dict | None:
    """Build a trade-plan dict for a completed run doc, or None on any failure."""
    from tradingagents.llm_clients import create_llm_client

    reports = doc.get("reports") or {}
    if not reports.get("final_trade_decision"):
        return None
    prompt = PROMPT.format(
        ticker=doc["ticker"], rating=doc.get("rating") or "?",
        final=reports.get("final_trade_decision", ""),
        trader=reports.get("trader_investment_plan", ""),
        plan=reports.get("investment_plan", ""),
        market=(reports.get("market_report") or "")[-6000:],
    )
    try:
        # The deep (managers') model: extraction quality tracks model quality,
        # and this is a single call on the run's decisive output.
        llm = create_llm_client(
            provider=doc["provider"], model=doc["deep_model"], max_retries=3
        ).get_llm()
        plan = None
        # Thinking models sometimes answer in prose instead of calling the schema
        # tool (same failure mode the engine's structured agents guard against):
        # retry the structured call once, then fall back to free-text JSON.
        try:
            structured = llm.with_structured_output(TradePlan)
            for _ in range(2):
                plan = structured.invoke(prompt)
                if plan is not None:
                    break
        except Exception as exc:  # noqa: BLE001
            logger.info("structured extraction unavailable (%s); using JSON fallback", exc)
        if plan is None:
            raw = llm.invoke(
                prompt + "\n\nReturn ONLY a JSON object with exactly these keys: "
                + json.dumps(list(TradePlan.model_fields.keys()))
                + ". Price levels are objects {\"price\": number, \"basis\": string}; "
                "use null for anything not applicable. No markdown, no commentary."
            ).content
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if not match:
                raise ValueError("no JSON object in free-text fallback")
            plan = TradePlan.model_validate(json.loads(match.group(0)))
        out = plan.model_dump()
        out["risk_reward"] = _rr(plan)
        return out
    except Exception as exc:  # noqa: BLE001 - plan is an enhancement, never fail the run
        logger.warning("trade-plan extraction failed for %s: %s", doc.get("id"), exc)
        return None
