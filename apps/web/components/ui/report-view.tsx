"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Printer, Pencil, Trash2, Loader2, ArrowLeft, Share2 } from "lucide-react";
import { type RunResult } from "./report-result-table";
import { ReportResultView } from "./report-result-view";
import { ReportShareModal } from "./report-share-modal";

// Saved-report view (E-16): runs the report and shows the result, with branded
// CSV export and (for the creator) edit/delete.
interface ReportMeta { id: string; name: string; description: string | null; source: string; shared: boolean; isOwner: boolean }

export function ReportView({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [mRes, rRes] = await Promise.all([
          fetch(`/api/reports/${reportId}`, { cache: "no-store" }),
          fetch(`/api/reports/${reportId}/run`, { cache: "no-store" }),
        ]);
        const mData = (await mRes.json()) as { ok: boolean; report?: ReportMeta; error?: string };
        const rData = await rRes.json();
        if (!alive) return;
        if (mRes.ok && mData.ok && mData.report) setMeta(mData.report);
        else setError(mData.error ?? "Couldn't load this report's details.");
        if (rRes.ok && rData.ok) setResult(rData as RunResult);
        else setError(rData.error ?? "Couldn't run this report.");
      } catch {
        if (alive) setError("Couldn't load this report.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reportId]);

  async function onDelete() {
    if (!confirm("Delete this report? This can't be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Delete failed"); setDeleting(false); return; }
      router.push("/reports");
    } catch { setError("Delete failed"); setDeleting(false); }
  }

  return (
    <div>
      <a href="/reports" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg mb-3">
        <ArrowLeft className="w-4 h-4" /> Reports
      </a>
      <div className="page-header">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="page-title">{meta?.name ?? "Report"}</h1>
            {meta?.description && <p className="page-subtitle">{meta.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <a href={`/api/reports/${reportId}/export?format=pdf`} className="px-3 py-2 text-sm border border-line rounded-lg text-fg-muted bg-surface hover:bg-surface-inset inline-flex items-center gap-1.5">
              <Printer className="w-3.5 h-3.5" /> PDF
            </a>
            <a href={`/api/reports/${reportId}/export?format=csv`} className="px-3 py-2 text-sm border border-line rounded-lg text-fg-muted bg-surface hover:bg-surface-inset inline-flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> CSV
            </a>
            {meta?.isOwner && (
              <>
                <button onClick={() => setSharing(true)} className="px-3 py-2 text-sm border border-line rounded-lg text-fg-muted bg-surface hover:bg-surface-inset inline-flex items-center gap-1.5">
                  <Share2 className="w-3.5 h-3.5" /> Share
                </button>
                <a href={`/reports/${reportId}/edit`} className="px-3 py-2 text-sm border border-line rounded-lg text-fg-muted bg-surface hover:bg-surface-inset inline-flex items-center gap-1.5">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </a>
                <button onClick={onDelete} disabled={deleting} className="px-3 py-2 text-sm border border-line rounded-lg text-danger bg-surface hover:bg-danger-bg inline-flex items-center gap-1.5 disabled:opacity-50">
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-danger-bg border border-danger-border text-danger rounded-lg text-sm">{error}</div>}

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="card-title">Results</h3>
          {result && <span className="text-xs text-fg-muted">{result.grouped ? `${result.total} groups` : `${result.total} rows`}</span>}
        </div>
        {loading ? (
          <p className="text-sm text-fg-muted py-8 text-center">Running report…</p>
        ) : result ? (
          <ReportResultView result={result} />
        ) : (
          <p className="text-sm text-fg-muted py-8 text-center">No results.</p>
        )}
      </div>

      {sharing && meta?.isOwner && (
        <ReportShareModal reportId={reportId} onClose={() => setSharing(false)} />
      )}
    </div>
  );
}
