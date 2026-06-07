"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Lightbulb,
  Star,
  Clock,
  Download,
  Printer
} from "lucide-react";
import type { NightAuditReport, NightAuditResponse } from "../../lib/data";
import { ReportBrandHeader } from "../../components/ui/report-brand-header";

// Client-safe wrappers around the /api/night-audit proxy route. Defined here (not
// imported from lib/data) because lib/data transitively imports server-only Clerk
// code, which a Client Component must not pull in.
async function fetchNightAuditLatest(): Promise<NightAuditResponse> {
  try {
    const res = await fetch("/api/night-audit", { cache: "no-store" });
    return (await res.json()) as NightAuditResponse;
  } catch {
    return { ok: false, error: "Unable to fetch night audit report" };
  }
}

async function generateNightAudit(provider: "claude" | "openai" = "claude"): Promise<NightAuditResponse> {
  try {
    const res = await fetch("/api/night-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
      cache: "no-store"
    });
    return (await res.json()) as NightAuditResponse;
  } catch {
    return { ok: false, error: "Unable to generate night audit report" };
  }
}

export default function NightAuditPage() {
  const [report, setReport] = useState<NightAuditReport | null>(null);
  const [reportDate, setReportDate] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<"claude" | "openai">("claude");

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNightAuditLatest();
      if (res.ok && res.report) {
        setReport(res.report);
        setReportDate(res.reportDate ?? null);
        setProvider(res.provider ?? null);
        setGeneratedAt(res.generatedAt ?? null);
      } else {
        setReport(null);
      }
    } catch {
      setError("Failed to load report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateNightAudit(selectedProvider);
      if (res.ok && res.report) {
        setReport(res.report);
        setReportDate(res.reportDate ?? null);
        setProvider(res.provider ?? null);
        setGeneratedAt(res.generatedAt ?? null);
      } else {
        setError((res as { error?: string }).error ?? "Generation failed");
      }
    } catch {
      setError("Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 8) return "text-teal-600";
    if (score >= 6) return "text-amber-600";
    return "text-red-600";
  };

  const scoreBg = (score: number) => {
    if (score >= 8) return "bg-teal-50 border-teal-200";
    if (score >= 6) return "bg-amber-50 border-amber-200";
    return "bg-red-50 border-red-200";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-teal-700" />
            Night Audit Report
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">AI-generated daily operations summary</p>
        </div>
        <div className="flex items-center gap-2">
          {report && (
            <>
              {/* Branded exports (E-9): real binary PDF + CSV. */}
              <a
                href="/api/night-audit/export?format=pdf"
                className="inline-flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 bg-white hover:bg-slate-50"
              >
                <Printer className="w-3.5 h-3.5" /> PDF
              </a>
              <a
                href="/api/night-audit/export?format=csv"
                className="inline-flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 bg-white hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </a>
            </>
          )}
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value as "claude" | "openai")}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 bg-white"
            disabled={generating}
          >
            <option value="claude">Claude (Opus 4.7)</option>
            <option value="openai">GPT-4o</option>
          </select>
          <button
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-60"
          >
            {generating ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Generate Report
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {loading ? (
        <div className="card text-center py-16 text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-teal-600" />
          <div className="text-sm">Loading report...</div>
        </div>
      ) : !report ? (
        <div className="card text-center py-16">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <div className="text-slate-500 font-medium mb-2">No report yet</div>
          <p className="text-sm text-slate-400 mb-6 max-w-sm mx-auto">
            Generate your first AI night audit report for today's operations summary.
          </p>
          <button
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
          >
            {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Generate Tonight's Report
          </button>
        </div>
      ) : (
        <>
          {/* Branded report header (E-9) — carries the tenant brand on screen + print. */}
          <ReportBrandHeader title="Night Audit Report" subtitle={reportDate ?? undefined} />

          {/* Report metadata */}
          <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {generatedAt ? new Date(generatedAt).toLocaleString("en-IN") : "Unknown time"}
            </span>
            <span>Report date: {reportDate ?? "—"}</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium capitalize">
              {provider ?? "—"}
            </span>
          </div>

          {/* Headline + score */}
          <div className={`card mb-4 border ${scoreBg(report.operationalScore)}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Tonight's Headline</div>
                <div className="text-lg font-semibold text-slate-800 leading-snug">{report.headline}</div>
              </div>
              <div className="shrink-0 text-center">
                <div className={`text-4xl font-black ${scoreColor(report.operationalScore)}`}>{report.operationalScore}</div>
                <div className="text-xs text-slate-500 mt-0.5">/ 10</div>
                <div className="flex items-center justify-center gap-0.5 mt-1">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      className={`w-3 h-3 ${i < Math.round(report.operationalScore / 2) ? scoreColor(report.operationalScore) : "text-slate-200"}`}
                      fill="currentColor"
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Executive summary */}
          <div className="card mb-4">
            <h3 className="card-title mb-2">Executive Summary</h3>
            <p className="text-sm text-slate-600 leading-relaxed">{report.executiveSummary}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Highlights */}
            <div className="card">
              <h3 className="card-title mb-3 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-teal-600" />
                Highlights
              </h3>
              <ul className="space-y-2">
                {report.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    {h}
                  </li>
                ))}
              </ul>
            </div>

            {/* Concerns */}
            <div className="card">
              <h3 className="card-title mb-3 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Concerns
              </h3>
              {report.concerns.length === 0 ? (
                <div className="text-sm text-slate-400">No concerns flagged for today.</div>
              ) : (
                <ul className="space-y-2">
                  {report.concerns.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">!</span>
                      {c}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Tomorrow recommendations */}
          <div className="card">
            <h3 className="card-title mb-3 flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4 text-blue-600" />
              Tomorrow's Action Plan
            </h3>
            <div className="space-y-3">
              {report.tomorrowRecommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</div>
                  <div className="text-sm text-slate-700 leading-relaxed">{rec}</div>
                  <TrendingUp className="w-4 h-4 text-blue-400 shrink-0 mt-0.5 ml-auto" />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
