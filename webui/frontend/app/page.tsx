"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ANALYSTS, BACKEND, Defaults, Provider, RunDoc, api, getToken,
} from "@/lib/api";
import VerdictCard from "@/components/Verdict";

interface SymbolPreview { canonical: string; identity: Record<string, string>; last_close: number | null }
interface AgentStatuses { [agent: string]: string }
interface RunEvent {
  type: string; label?: string; key?: string; agents?: AgentStatuses;
  message?: string; rating?: string; direction?: string; confidence?: number; elapsed?: number;
  debate?: number; risk?: number; chars?: number;
}

const STATUS_DOT: Record<string, string> = {
  completed: "bg-emerald-500", in_progress: "bg-sky-400 animate-pulse", pending: "bg-slate-700",
};

export default function Dashboard() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [ticker, setTicker] = useState("XAUUSD");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [analysts, setAnalysts] = useState<string[]>(["market", "news"]);
  const [depth, setDepth] = useState(1);
  const [provider, setProvider] = useState("google");
  const [quickModel, setQuickModel] = useState("");
  const [deepModel, setDeepModel] = useState("");
  const [preview, setPreview] = useState<SymbolPreview | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentStatuses>({});
  const [stage, setStage] = useState("");
  const [sections, setSections] = useState<string[]>([]);
  const [counts, setCounts] = useState({ debate: 0, risk: 0 });
  const [result, setResult] = useState<RunDoc | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!getToken()) { window.location.href = "/login"; return; }
    api<{ providers: Provider[]; defaults: Defaults }>("/api/settings").then((s) => {
      setProviders(s.providers); setDefaults(s.defaults);
      setProvider(s.defaults.provider); setQuickModel(s.defaults.quick_model);
      setDeepModel(s.defaults.deep_model); setAnalysts(s.defaults.analysts); setDepth(s.defaults.depth);
    }).catch((e) => setError((e as Error).message));
    return () => esRef.current?.close();
  }, []);

  const prov = providers.find((p) => p.id === provider);

  const fetchPreview = useCallback(async (sym: string) => {
    if (!sym.trim()) { setPreview(null); return; }
    try { setPreview(await api<SymbolPreview>(`/api/symbol/${encodeURIComponent(sym.trim().toUpperCase())}`)); }
    catch { setPreview(null); }
  }, []);
  useEffect(() => { const t = setTimeout(() => fetchPreview(ticker), 500); return () => clearTimeout(t); }, [ticker, fetchPreview]);

  function onProviderChange(id: string) {
    setProvider(id);
    const p = providers.find((x) => x.id === id);
    setQuickModel(p?.quick_models[0]?.value === "custom" ? "" : p?.quick_models[0]?.value ?? "");
    setDeepModel(p?.deep_models[0]?.value === "custom" ? "" : p?.deep_models[0]?.value ?? "");
  }

  async function start() {
    setError(""); setResult(null); setSections([]); setAgents({}); setStage("Starting…");
    setRunning(true);
    try {
      const r = await api<{ id: string }>("/api/runs", {
        method: "POST",
        body: JSON.stringify({ ticker, date, analysts, depth, provider, quick_model: quickModel, deep_model: deepModel }),
      });
      setRunId(r.id);
      const es = new EventSource(`${BACKEND}/api/runs/${r.id}/events?token=${getToken()}`);
      esRef.current = es;
      es.onmessage = async (m) => {
        const ev: RunEvent = JSON.parse(m.data);
        if (ev.type === "stage" && ev.label) setStage(ev.label);
        if (ev.type === "status" && ev.agents) { setAgents(ev.agents); setCounts({ debate: ev.debate ?? 0, risk: ev.risk ?? 0 }); }
        if (ev.type === "section" && ev.key) setSections((s) => [...s, ev.key!]);
        if (ev.type === "done") {
          es.close(); setRunning(false); setStage("");
          setResult(await api<RunDoc>(`/api/runs/${r.id}`));
        }
        if (ev.type === "error") { es.close(); setRunning(false); setError(ev.message ?? "run failed"); }
      };
      es.onerror = () => { if (running) setStage("reconnecting…"); };
    } catch (e) { setRunning(false); setError((e as Error).message); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Run analysis</h1>

      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400">Pair / ticker</label>
            <input value={ticker} onChange={(e) => setTicker(e.target.value)} spellCheck={false}
              placeholder="XAUUSD, BTC-USD, AAPL, 0700.HK…"
              className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:border-emerald-500 outline-none" />
            <div className="text-[11px] mt-1 h-4 text-slate-500">
              {preview ? <>→ <span className="text-slate-300">{preview.canonical}</span>
                {preview.identity.company_name ? ` · ${preview.identity.company_name}` : ""}
                {preview.last_close != null ? ` · last ${preview.last_close}` : " · no price data"}</> : " "}
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400">Analysis date</label>
            <input type="date" value={date} max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 outline-none" />
          </div>
          <div>
            <label className="text-xs text-slate-400">Research depth</label>
            <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}
              className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
              <option value={1}>Shallow — 1 debate round (fastest)</option>
              <option value={3}>Medium — 3 rounds</option>
              <option value={5}>Deep — 5 rounds</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400">Analysts</label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {ANALYSTS.map((a) => (
              <button key={a.key} type="button"
                onClick={() => setAnalysts((cur) => cur.includes(a.key) ? cur.filter((x) => x !== a.key) : [...cur, a.key])}
                className={`px-3 py-1.5 rounded-full text-xs border transition ${analysts.includes(a.key)
                  ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
                  : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400">LLM provider</label>
            <select value={provider} onChange={(e) => onProviderChange(e.target.value)}
              className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.id}{p.key_set || p.key_optional ? "" : "  (key missing)"}</option>
              ))}
            </select>
          </div>
          {(["quick", "deep"] as const).map((tier) => {
            const opts = tier === "quick" ? prov?.quick_models : prov?.deep_models;
            const val = tier === "quick" ? quickModel : deepModel;
            const set = tier === "quick" ? setQuickModel : setDeepModel;
            const listed = opts?.some((o) => o.value === val);
            return (
              <div key={tier}>
                <label className="text-xs text-slate-400">{tier === "quick" ? "Quick model (analysts/debates)" : "Deep model (managers)"}</label>
                {opts && opts.length > 0 && (
                  <select value={listed ? val : "custom"}
                    onChange={(e) => set(e.target.value === "custom" ? "" : e.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                    {opts.filter((o) => o.value !== "custom").map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                    <option value="custom">custom model id…</option>
                  </select>
                )}
                {(!opts?.length || !listed) && (
                  <input value={val} onChange={(e) => set(e.target.value)} placeholder="model id"
                    className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono" />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button onClick={start} disabled={running || !ticker.trim() || analysts.length === 0}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg px-6 py-2.5 text-sm font-semibold">
            {running ? "Analyzing…" : "▶ Run analysis"}
          </button>
          {defaults && (
            <button onClick={() => api("/api/settings/defaults", { method: "PUT", body: JSON.stringify({ provider, quick_model: quickModel, deep_model: deepModel, analysts, depth }) })}
              className="text-xs text-slate-500 hover:text-slate-300">save as defaults</button>
          )}
          {prov && !prov.key_set && !prov.key_optional && <span className="text-xs text-amber-400">⚠ no API key for {provider} — add it in Settings</span>}
        </div>
        {error && <div className="text-sm text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-3">{error}</div>}
      </div>

      {(running || Object.keys(agents).length > 0) && !result && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">Live progress</div>
            <div className="text-xs text-slate-500">{stage} {counts.debate > 0 && `· debate turns ${counts.debate}`} {counts.risk > 0 && `· risk turns ${counts.risk}`}</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(agents).map(([name, st]) => (
              <div key={name} className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2">
                <span className={`w-2 h-2 rounded-full ${STATUS_DOT[st] ?? "bg-slate-700"}`} />
                <span className="text-xs text-slate-300">{name}</span>
              </div>
            ))}
          </div>
          {sections.length > 0 && (
            <div className="mt-3 text-xs text-slate-500">completed: {sections.join(" → ")}</div>
          )}
        </div>
      )}

      {result && result.verdict && result.rating && (
        <div className="space-y-3">
          <VerdictCard verdict={result.verdict} rating={result.rating} ticker={result.ticker}
            canonical={result.canonical} elapsed={result.elapsed} />
          <Link href={`/runs/${result.id}`}
            className="inline-block text-sm text-emerald-400 hover:text-emerald-300">
            Open full report (all agents) →
          </Link>
        </div>
      )}
      {runId && running && <div className="text-xs text-slate-600">run id: {runId} — you can leave this page; find it later under History.</div>}
    </div>
  );
}
