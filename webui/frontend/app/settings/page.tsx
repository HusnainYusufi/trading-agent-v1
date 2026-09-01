"use client";
import { useEffect, useState } from "react";
import { Provider, api } from "@/lib/api";

const EXTRA_KEYS = [
  { env_var: "FRED_API_KEY", label: "FRED (free macro data — recommended)" },
  { env_var: "ALPHA_VANTAGE_API_KEY", label: "Alpha Vantage (alt. market data vendor)" },
];

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const load = () => api<{ providers: Provider[] }>("/api/settings")
    .then((s) => setProviders(s.providers)).catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, []);

  async function save(envVar: string) {
    setError("");
    try {
      await api("/api/settings/keys", { method: "PUT", body: JSON.stringify({ env_var: envVar, value: inputs[envVar] ?? "" }) });
      setSaved((s) => ({ ...s, [envVar]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [envVar]: false })), 2000);
      setInputs((s) => ({ ...s, [envVar]: "" }));
      load();
    } catch (e) { setError((e as Error).message); }
  }

  const keyed = providers.filter((p) => p.env_var);
  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          API keys are stored locally in <code className="text-xs bg-slate-800 px-1 rounded">~/.tradingagents/webui/keys.env</code> (chmod 600)
          and take effect immediately — no restart needed. Add whichever providers you want to switch between.
        </p>
      </div>
      {error && <div className="text-sm text-rose-400">{error}</div>}

      <div className="card divide-y divide-slate-800">
        {keyed.map((p) => (
          <KeyRow key={p.id} label={p.id} envVar={p.env_var!} isSet={p.key_set} masked={p.key_masked}
            value={inputs[p.env_var!] ?? ""} saved={!!saved[p.env_var!]}
            onChange={(v) => setInputs((s) => ({ ...s, [p.env_var!]: v }))} onSave={() => save(p.env_var!)} />
        ))}
        {EXTRA_KEYS.map((k) => (
          <KeyRow key={k.env_var} label={k.label} envVar={k.env_var} isSet={false} masked=""
            value={inputs[k.env_var] ?? ""} saved={!!saved[k.env_var]}
            onChange={(v) => setInputs((s) => ({ ...s, [k.env_var]: v }))} onSave={() => save(k.env_var)} />
        ))}
      </div>
      <p className="text-xs text-slate-600">
        Ollama and generic OpenAI-compatible endpoints need no key. Azure additionally reads
        AZURE_OPENAI_ENDPOINT / DEPLOYMENT_NAME from the repo’s .env.enterprise. Bedrock uses your AWS credential chain.
      </p>
    </div>
  );
}

function KeyRow({ label, envVar, isSet, masked, value, saved, onChange, onSave }: {
  label: string; envVar: string; isSet: boolean; masked: string; value: string; saved: boolean;
  onChange: (v: string) => void; onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-44 shrink-0">
        <div className="text-sm text-slate-200">{label}</div>
        <div className="text-[10px] text-slate-600 font-mono">{envVar}</div>
      </div>
      <div className="w-24 text-xs shrink-0">
        {isSet ? <span className="text-emerald-400">● set {masked && <span className="text-slate-600">{masked}</span>}</span>
          : <span className="text-slate-600">○ not set</span>}
      </div>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={isSet ? "paste new key to replace (empty = remove)" : "paste API key"}
        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono focus:border-emerald-500 outline-none" />
      <button onClick={onSave} className="text-xs bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5">
        {saved ? "✓ saved" : "Save"}
      </button>
    </div>
  );
}
