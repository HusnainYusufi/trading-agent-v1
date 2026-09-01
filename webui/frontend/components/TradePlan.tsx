"use client";
import { useState } from "react";
import { TradePlan as TradePlanT, api } from "@/lib/api";

function Level({ label, price, basis, tone, rr }: {
  label: string; price: number; basis: string; tone: "entry" | "stop" | "tp"; rr?: number;
}) {
  const toneCls = tone === "stop" ? "border-rose-500/40 bg-rose-500/10"
    : tone === "tp" ? "border-emerald-500/40 bg-emerald-500/10"
    : "border-sky-500/40 bg-sky-500/10";
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneCls}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}{rr != null ? ` · ${rr}R` : ""}</div>
      <div className="text-xl font-bold font-mono text-slate-100">{price.toLocaleString()}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{basis}</div>
    </div>
  );
}

export default function TradePlanCard({ plan, runId, onUpdated }: {
  plan: TradePlanT | null | undefined; runId: string; onUpdated?: (p: TradePlanT) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true); setError("");
    try {
      const r = await api<{ trade_plan: TradePlanT }>(`/api/runs/${runId}/tradeplan`, { method: "POST" });
      onUpdated?.(r.trade_plan);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (!plan) {
    return (
      <div className="card p-4 flex items-center justify-between">
        <div className="text-sm text-slate-400">No trade plan extracted for this run yet.</div>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-rose-400">{error}</span>}
          <button onClick={generate} disabled={busy}
            className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg px-3 py-1.5">
            {busy ? "Extracting…" : "Generate trade plan"}
          </button>
        </div>
      </div>
    );
  }

  const dirCls = plan.direction === "long" ? "text-emerald-400" : plan.direction === "short" ? "text-rose-400" : "text-amber-300";
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="text-sm font-semibold">
          Trade plan · <span className={`uppercase ${dirCls}`}>{plan.direction}</span>
          {plan.horizon && <span className="text-slate-500 font-normal"> · horizon {plan.horizon}</span>}
        </div>
        <div className="text-[10px] text-slate-600">levels extracted from the agents’ reports — verify before trading</div>
      </div>

      {plan.direction === "no-trade" ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <div className="font-semibold mb-1">Stand aside — no setup at current levels.</div>
          {plan.trigger && <div className="text-amber-100/90"><span className="text-amber-400 font-medium">Activates:</span> {plan.trigger}</div>}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {plan.entry && <Level label="Entry" price={plan.entry.price} basis={plan.entry.basis} tone="entry" />}
          {plan.entry_fallback && <Level label="Fallback entry" price={plan.entry_fallback.price} basis={plan.entry_fallback.basis} tone="entry" />}
          {plan.stop_loss && <Level label="Stop loss" price={plan.stop_loss.price} basis={plan.stop_loss.basis} tone="stop" />}
          {plan.take_profits.map((tp, i) => (
            <Level key={i} label={`TP${i + 1}`} price={tp.price} basis={tp.basis} tone="tp" rr={plan.risk_reward?.[i]} />
          ))}
        </div>
      )}

      <div className="text-xs space-y-1">
        {plan.invalidation && <div><span className="text-slate-500">Invalidation:</span> <span className="text-slate-300">{plan.invalidation}</span></div>}
        {plan.sizing_note && <div><span className="text-slate-500">Sizing:</span> <span className="text-slate-300">{plan.sizing_note}</span></div>}
      </div>
    </div>
  );
}
