"use client";
import { Verdict as VerdictT, directionStyle, ratingChip } from "@/lib/api";

export default function VerdictCard({ verdict, rating, ticker, canonical, elapsed }:
  { verdict: VerdictT; rating: string; ticker: string; canonical?: string | null; elapsed?: number | null }) {
  const d = directionStyle(verdict.direction);
  return (
    <div className={`card p-6 border ${d.bg}`}>
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <div className={`text-3xl font-black tracking-tight ${d.cls}`}>{d.arrow} {d.label}</div>
          <div className="text-sm text-slate-400 mt-1">
            {ticker}{canonical && canonical !== ticker ? ` → ${canonical}` : ""}{elapsed ? ` · ${Math.round(elapsed)}s` : ""}
          </div>
        </div>
        <div className="flex-1 min-w-52">
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Signal alignment</span><span className="text-slate-200 font-semibold">{verdict.confidence}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full rounded-full ${verdict.direction.startsWith("bull") ? "bg-emerald-500" : verdict.direction.startsWith("bear") ? "bg-rose-500" : "bg-amber-400"}`}
              style={{ width: `${verdict.confidence}%` }} />
          </div>
          <div className="text-[11px] text-slate-500 mt-1">{verdict.note}</div>
        </div>
        <div className="flex gap-2">
          {([["PM", verdict.votes.portfolio_manager], ["RM", verdict.votes.research_manager], ["Trader", verdict.votes.trader]] as const).map(([who, r]) => (
            <div key={who} className={`px-3 py-2 rounded-lg border text-center ${ratingChip(r)}`}>
              <div className="text-[10px] uppercase tracking-wide opacity-70">{who}</div>
              <div className="text-sm font-semibold">{r}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 text-xs text-slate-500">Final rating: <span className={`px-2 py-0.5 rounded border ${ratingChip(rating)}`}>{rating}</span></div>
    </div>
  );
}
