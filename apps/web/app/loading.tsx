// Streamed into the AppShell while any server component is loading. Without
// this file, slow data fetches would let Next.js render the layout with an
// empty children slot — that's the "blank screen after login" failure mode.
export default function Loading() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <div
          className="w-8 h-8 rounded-full border-2 border-slate-200 animate-spin"
          style={{ borderTopColor: "var(--color-primary, #0f766e)" }}
        />
        <span className="text-sm">Loading your workspace…</span>
      </div>
    </div>
  );
}
