"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { RunDoc, api } from "@/lib/api";
import Markdown from "@/components/Markdown";
import VerdictCard from "@/components/Verdict";
import TradePlanCard from "@/components/TradePlan";

const TAB_ORDER: [string, string][] = [
  ["final_trade_decision", "Final Decision"],
  ["trader_investment_plan", "Trader"],
  ["investment_plan", "Research Manager"],
  ["bull_case", "Bull Case"],
  ["bear_case", "Bear Case"],
  ["market_report", "Market"],
  ["news_report", "News"],
  ["sentiment_report", "Sentiment"],
  ["fundamentals_report", "Fundamentals"],
  ["risk_aggressive", "Risk: Aggressive"],
  ["risk_conservative", "Risk: Conservative"],
  ["risk_neutral", "Risk: Neutral"],
];

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDoc | null>(null);
  const [tab, setTab] = useState("final_trade_decision");
  const [error, setError] = useState("");

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = () => api<RunDoc>(`/api/runs/${id}`).then((r) => {
      setRun(r);
      if (r.status !== "running" && timer) clearInterval(timer);
    }).catch((e) => setError((e as Error).message));
    load();
    timer = setInterval(load, 4000);
    return () => { if (timer) clearInterval(timer); };
  }, [id]);

  if (error) return <div className="text-sm text-rose-400">{error}</div>;
  if (!run) return <div className="text-sm text-slate-500">Loading…</div>;

  const tabs = TAB_ORDER.filter(([k]) => run.reports?.[k]);
  const active = run.reports?.[tab] ? tab : tabs[0]?.[0];

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold font-mono">{run.ticker} <span className="text-slate-500 text-base font-sans">· {run.date}</span></h1>
        <div className="text-xs text-slate-600">{run.provider} · quick {run.quick_model} · deep {run.deep_model} · depth {run.depth}</div>
      </div>

      {run.status === "running" && <div className="text-sm text-sky-400 animate-pulse">Analysis in progress — this page refreshes automatically.</div>}
      {run.status === "error" && <div className="text-sm text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-3">{run.error}</div>}
      {run.verdict && run.rating && (
        <VerdictCard verdict={run.verdict} rating={run.rating} ticker={run.ticker} canonical={run.canonical} elapsed={run.elapsed} />
      )}
      {run.status === "done" && (
        <TradePlanCard plan={run.trade_plan} runId={run.id}
          onUpdated={(p) => setRun((r) => (r ? { ...r, trade_plan: p } : r))} />
      )}

      {tabs.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
            {tabs.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-1.5 text-xs rounded-lg ${active === k ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="card p-5 mt-3">
            {active && <Markdown>{run.reports![active]}</Markdown>}
          </div>
        </div>
      )}
    </div>
  );
}
