function resolveBackend(): string {
  if (process.env.NEXT_PUBLIC_BACKEND) return process.env.NEXT_PUBLIC_BACKEND;
  // Deployed behind a reverse proxy that serves /api on the same host: use
  // same-origin relative URLs (no CORS needed). Local dev talks to :8642.
  if (typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname)) return "";
  return "http://127.0.0.1:8642";
}
export const BACKEND = resolveBackend();

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ta_token");
}
export function setToken(t: string) { localStorage.setItem("ta_token", t); }
export function clearToken() { localStorage.removeItem("ta_token"); }

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BACKEND + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
    clearToken();
    window.location.href = "/login";
    throw new ApiError(401, "unauthorized");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { detail?: string }).detail ?? res.statusText);
  return body as T;
}

export interface ModelOption { label: string; value: string }
export interface Provider {
  id: string; env_var: string | null; key_set: boolean; key_optional: boolean; key_masked: string;
  quick_models: ModelOption[]; deep_models: ModelOption[];
}
export interface Defaults {
  provider: string; quick_model: string; deep_model: string; analysts: string[]; depth: number;
}
export interface Verdict {
  direction: string; confidence: number; alignment: number; note: string;
  votes: { portfolio_manager: string; research_manager: string; trader: string };
}
export interface PriceLevel { price: number; basis: string }
export interface TradePlan {
  direction: string; horizon?: string | null;
  entry: PriceLevel | null; entry_fallback: PriceLevel | null; stop_loss: PriceLevel | null;
  take_profits: PriceLevel[]; risk_reward?: number[];
  invalidation?: string | null; trigger?: string | null; sizing_note?: string | null;
}
export interface RunDoc {
  id: string; ticker: string; canonical: string | null; date: string; created_at: number;
  status: "running" | "done" | "error"; rating: string | null; direction: string | null;
  confidence: number | null; elapsed: number | null; error: string | null;
  provider: string; quick_model: string; deep_model: string; analysts: string[]; depth: number;
  reports?: Record<string, string>; verdict?: Verdict | null; trade_plan?: TradePlan | null;
}
export interface ScorecardEntry {
  date: string; ticker: string; rating: string;
  raw?: string | null; alpha?: string | null; holding?: string | null; reflection?: string;
}

export const ANALYSTS = [
  { key: "market", label: "Market (technicals)" },
  { key: "social", label: "Sentiment (news + social)" },
  { key: "news", label: "News (macro + events)" },
  { key: "fundamentals", label: "Fundamentals" },
];

export function directionStyle(direction: string | null | undefined) {
  switch (direction) {
    case "bullish": return { label: "BULLISH", arrow: "▲", cls: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/40" };
    case "bullish-lean": return { label: "LEAN BULLISH", arrow: "◮", cls: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/30" };
    case "bearish": return { label: "BEARISH", arrow: "▼", cls: "text-rose-400", bg: "bg-rose-500/15 border-rose-500/40" };
    case "bearish-lean": return { label: "LEAN BEARISH", arrow: "◭", cls: "text-rose-300", bg: "bg-rose-500/10 border-rose-500/30" };
    default: return { label: "NEUTRAL", arrow: "▬", cls: "text-amber-300", bg: "bg-amber-500/10 border-amber-500/30" };
  }
}

export function ratingChip(rating: string | null | undefined): string {
  switch ((rating ?? "").toLowerCase()) {
    case "buy": return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case "overweight": return "bg-emerald-500/10 text-emerald-200 border-emerald-500/30";
    case "sell": return "bg-rose-500/20 text-rose-300 border-rose-500/40";
    case "underweight": return "bg-rose-500/10 text-rose-200 border-rose-500/30";
    default: return "bg-amber-500/10 text-amber-200 border-amber-500/30";
  }
}
