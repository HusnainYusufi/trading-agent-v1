"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ setup: boolean }>("/api/auth/status").then((s) => setNeedsSetup(!s.setup)).catch(() => setError("Backend unreachable — is it running on :8642?"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (needsSetup && password !== confirm) { setError("Passwords do not match"); return; }
    setBusy(true);
    try {
      const r = await api<{ token: string }>(needsSetup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST", body: JSON.stringify({ password }),
      });
      setToken(r.token);
      router.push("/");
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <form onSubmit={submit} className="card p-8 w-96 space-y-4">
        <div>
          <div className="text-xl font-bold">Trading<span className="text-emerald-400">Agents</span></div>
          <div className="text-sm text-slate-400 mt-1">
            {needsSetup === null ? "Checking…" : needsSetup ? "First run — create a password" : "Enter your password"}
          </div>
        </div>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" autoFocus
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 outline-none" />
        {needsSetup && (
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 outline-none" />
        )}
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <button disabled={busy || needsSetup === null}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg py-2 text-sm font-medium">
          {busy ? "…" : needsSetup ? "Create password" : "Log in"}
        </button>
      </form>
    </div>
  );
}
