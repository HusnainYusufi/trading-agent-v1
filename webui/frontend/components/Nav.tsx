"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "◉" },
  { href: "/runs", label: "History", icon: "≡" },
  { href: "/scorecard", label: "Scorecard", icon: "✓" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === "/login") return null;
  return (
    <aside className="w-56 shrink-0 border-r border-slate-800 min-h-screen p-4 flex flex-col gap-1 sticky top-0">
      <div className="mb-6 px-2">
        <div className="text-lg font-bold tracking-tight">Trading<span className="text-emerald-400">Agents</span></div>
        <div className="text-[11px] text-slate-500">multi-agent analysis · local</div>
      </div>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href}
          className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition ${
            pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href))
              ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"}`}>
          <span className="text-xs opacity-70">{l.icon}</span>{l.label}
        </Link>
      ))}
      <div className="mt-auto">
        <button onClick={() => { clearToken(); router.push("/login"); }}
          className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-rose-300 hover:bg-slate-900 w-full text-left">
          ⎋ Log out
        </button>
        <div className="px-3 pt-2 text-[10px] text-slate-600 leading-snug">
          Research tool — not financial advice.
        </div>
      </div>
    </aside>
  );
}
