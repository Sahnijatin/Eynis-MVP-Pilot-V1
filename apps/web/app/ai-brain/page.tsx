"use client";

import { useState } from "react";
import { Brain, Send, Loader2, Database, FileText, Users, BarChart3 } from "lucide-react";

const SUGGESTED = [
  "Which clients haven't ordered in 60+ days?",
  "What is our average margin on hospitality orders this quarter?",
  "Which materials are most frequently over-consumed vs BOM?",
  "Show top 5 orders by value currently in production",
  "Which quotes are expiring in the next 7 days?",
  "What was our on-time delivery rate last month?"
];

const DATA_SOURCES = [
  { icon: FileText, label: "Orders & Quotes", count: "234 records" },
  { icon: Users, label: "Client Database", count: "47 clients" },
  { icon: Database, label: "Material Logs", count: "1,840 transactions" },
  { icon: BarChart3, label: "Production Reports", count: "6 months" }
];

interface Message {
  role: "user" | "assistant";
  text: string;
}

const MOCK_ANSWERS: Record<string, string> = {
  "Which clients haven't ordered in 60+ days?": "Based on your client database, **2 clients** haven't placed an order in 60+ days:\n\n• **Kapoor Developers** — last order 8 Apr 2025 (47 days ago). LTV ₹92L. Suggested action: send WhatsApp re-engagement.\n• **Tata Housing Ltd.** — last order 15 Mar 2025 (71 days ago). LTV ₹58L. Mark as at-risk and schedule a follow-up call.",
  "What is our average margin on hospitality orders this quarter?": "Looking at hospitality-sector orders (Marriott, ITC, The Leela) for Q2 2025:\n\n• Average margin: **34.2%** — above your 25% floor\n• Best margin: Marriott Suite Furniture at **38%**\n• Total hospitality revenue this quarter: **₹2.94 Cr**\n\nHospitality accounts for 39% of your total revenue.",
  "Which materials are most frequently over-consumed vs BOM?": "Your top 3 over-consumed materials in the last 30 days:\n\n1. **Burma Teak Planks** — avg +18% over BOM across 6 orders\n2. **Marine Ply (19mm)** — avg +22% on wardrobes specifically\n3. **Upholstery Foam** — avg +9% variance\n\nSuggested fix: review BOM templates for wardrobe SKUs — they appear to consistently under-estimate material requirements."
};

export default function AIBrainPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: "user", text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    setTimeout(() => {
      const answer = MOCK_ANSWERS[text] ??
        "I've searched your order history, client records, and production data. This query would be answered using your live data once the AI Brain is connected to your real-time data pipeline. For now, try one of the suggested questions above.";
      setMessages(prev => [...prev, { role: "assistant", text: answer }]);
      setLoading(false);
    }, 1200);
  }

  return (
    <div className="grid grid-cols-3 gap-4 h-full" style={{ minHeight: "calc(100vh - 120px)" }}>
      {/* Chat panel */}
      <div className="card col-span-2 flex flex-col" style={{ maxHeight: "calc(100vh - 140px)" }}>
        {/* Header */}
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#1d4ed808" }}>
            <Brain className="w-5 h-5 text-blue-700" />
          </div>
          <div>
            <div className="font-semibold text-slate-800">Eynis AI Brain</div>
            <div className="text-xs text-slate-500">Answers sourced from your own data — orders, clients, materials, reports</div>
          </div>
          <span className="ml-auto badge" style={{ background: "#fef3c7", color: "#b45309" }}>Preview</span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <Brain className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <div className="text-slate-500 text-sm">Ask anything about your business</div>
              <div className="text-slate-300 text-xs mt-1">Orders · Clients · Materials · Quotes · Reports</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[80%] px-4 py-3 rounded-2xl text-sm"
                style={m.role === "user"
                  ? { background: "#1d4ed8", color: "#fff", borderBottomRightRadius: 4 }
                  : { background: "#f8fafc", color: "#1e293b", border: "1px solid #e2e8f0", borderBottomLeftRadius: 4 }}
              >
                {m.text.split("\n").map((line, j) => (
                  // Render **bold** as React nodes (never dangerouslySetInnerHTML) — the
                  // text will include contact/order/AI content once wired to live data,
                  // and raw HTML injection would be stored XSS (F-…).
                  <p key={j} className="mb-1 last:mb-0">
                    {line.split(/\*\*(.*?)\*\*/g).map((seg, k) => (k % 2 === 1 ? <strong key={k}>{seg}</strong> : seg))}
                  </p>
                ))}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span className="text-sm text-slate-500">Searching your data...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2">
          <input
            className="flex-1 text-sm outline-none bg-transparent text-slate-700 placeholder-slate-400"
            placeholder="Ask anything about your orders, clients, materials..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage(input)}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40"
            style={{ background: "#1d4ed8" }}
          >
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>

      {/* Right: Suggested + Sources */}
      <div className="flex flex-col gap-4">
        {/* Suggestions */}
        <div className="card">
          <h3 className="card-title mb-3">Suggested Questions</h3>
          <div className="space-y-2">
            {SUGGESTED.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="w-full text-left text-xs px-3 py-2.5 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Data sources */}
        <div className="card">
          <h3 className="card-title mb-3">Data Sources</h3>
          <div className="space-y-3">
            {DATA_SOURCES.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50">
                    <Icon className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-700">{s.label}</div>
                    <div className="text-xs text-slate-500">{s.count}</div>
                  </div>
                  <span className="ml-auto w-2 h-2 rounded-full bg-emerald-500" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
