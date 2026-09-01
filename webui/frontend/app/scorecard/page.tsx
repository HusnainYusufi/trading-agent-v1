"use client";
import { useEffect, useState } from "react";
import { ScorecardEntry, api, ratingChip } from "@/lib/api";

interface Scorecard {
  resolved: ScorecardEntry[]; pending: ScorecardEntry[];
  directional_calls: number; directional_correct: number;
}

export default function ScorecardPage() {
  const [data, setData] = useState<Scorecard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Scorecard>("/api/scorecard").then(setData).catch((e) => setError((e as Error).message)); }, []);

  if (error) return <div className="text-sm text-rose-400">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const hit = data.directional_calls ? Math.round(100 * data.directional_correct / data.directional_calls) : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Scorecard</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Every completed run logs its call; the next run on the same pair resolves it against the realised
          5-day return and alpha vs its benchmark. This page is the honest answer to “can I rely on it?” —
          judge the system on this, not on any single call.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["Resolved calls", String(data.resolved.length)],
          ["Pending calls", String(data.pending.length)],
          ["Directional calls", String(data.directional_calls)],
          ["Directional hit rate", hit === null ? "—" : `${hit}%`]].map(([k, v]) => (
          <div key={k} className="card p-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{k}</div>
            <div className="text-2xl font-bold mt-1">{v}</div>
          </div>
        ))}
      </div>

      {data.pending.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-semibold mb-2">Pending (resolve by re-running the pair after ~5 trading days)</div>
          <div className="flex flex-wrap gap-2">
            {data.pending.map((e, i) => (
              <span key={i} className="text-xs border border-slate-700 rounded-full px-3 py-1 text-slate-300">
                {e.ticker} · {e.date} · <span className={`px-1.5 rounded border ${ratingChip(e.rating)}`}>{e.rating}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-800">
            <th className="px-4 py-2">Date</th><th className="px-4 py-2">Pair</th><th className="px-4 py-2">Call</th>
            <th className="px-4 py-2 text-right">Return</th><th className="px-4 py-2 text-right">Alpha</th>
            <th className="px-4 py-2">Held</th><th className="px-4 py-2">Reflection</th>
          </tr></thead>
          <tbody>
            {data.resolved.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-600 text-xs">
                Nothing resolved yet — calls resolve automatically on the next run of the same pair.
              </td></tr>
            )}
            {data.resolved.map((e, i) => (
              <tr key={i} className="border-b border-slate-800/60 align-top">
                <td className="px-4 py-2 text-xs text-slate-500">{e.date}</td>
                <td className="px-4 py-2 font-mono text-slate-200">{e.ticker}</td>
                <td className="px-4 py-2"><span className={`text-[11px] px-2 py-0.5 rounded border ${ratingChip(e.rating)}`}>{e.rating}</span></td>
                <td className={`px-4 py-2 text-right font-mono text-xs ${e.raw?.startsWith("+") ? "text-emerald-400" : "text-rose-400"}`}>{e.raw}</td>
                <td className={`px-4 py-2 text-right font-mono text-xs ${e.alpha?.startsWith("+") ? "text-emerald-400" : "text-rose-400"}`}>{e.alpha}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{e.holding}</td>
                <td className="px-4 py-2 text-xs text-slate-400 max-w-md">{e.reflection}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
