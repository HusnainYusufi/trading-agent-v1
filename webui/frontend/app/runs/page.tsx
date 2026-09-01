"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RunDoc, api, directionStyle, ratingChip } from "@/lib/api";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunDoc[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ runs: RunDoc[] }>("/api/runs").then((r) => setRuns(r.runs)).catch((e) => setError((e as Error).message));
    const t = setInterval(() => api<{ runs: RunDoc[] }>("/api/runs").then((r) => setRuns(r.runs)).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Run history</h1>
      {error && <div className="text-sm text-rose-400">{error}</div>}
      {runs.length === 0 && <div className="text-sm text-slate-500">No runs yet — start one from the Dashboard.</div>}
      <div className="card divide-y divide-slate-800">
        {runs.map((r) => {
          const d = directionStyle(r.direction);
          return (
            <Link key={r.id} href={`/runs/${r.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-800/40 transition">
              <div className="w-28 font-mono text-sm text-slate-200">{r.ticker}</div>
              <div className="w-28 text-xs text-slate-500">{r.date}</div>
              <div className="w-32">
                {r.status === "running" ? <span className="text-xs text-sky-400 animate-pulse">running…</span>
                  : r.status === "error" ? <span className="text-xs text-rose-400">failed</span>
                  : <span className={`text-xs font-semibold ${d.cls}`}>{d.arrow} {d.label}</span>}
              </div>
              <div className="w-28">{r.rating && <span className={`text-[11px] px-2 py-0.5 rounded border ${ratingChip(r.rating)}`}>{r.rating}</span>}</div>
              <div className="w-16 text-right text-xs text-slate-500">{r.confidence != null ? `${r.confidence}%` : ""}</div>
              <div className="flex-1 text-right text-[11px] text-slate-600">
                {r.provider} · {new Date(r.created_at * 1000).toLocaleString()}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
