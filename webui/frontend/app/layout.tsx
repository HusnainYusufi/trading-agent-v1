import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "TradingAgents",
  description: "Multi-agent LLM trading analysis dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <div className="flex">
          <Nav />
          <main className="flex-1 min-w-0 p-6 max-w-6xl">{children}</main>
        </div>
      </body>
    </html>
  );
}
