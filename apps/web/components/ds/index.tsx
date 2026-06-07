"use client";

// Shared design-system primitives (modern-SaaS look). Inline-styled off the
// design tokens so they're consistent everywhere with no global CSS coupling.

import React, { createContext, useCallback, useContext, useState } from "react";
import { tokens as t } from "./tokens";

// ── Button ──────────────────────────────────────────────────────────────────
type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
type BtnSize = "sm" | "md";
export function Button({
  variant = "primary", size = "md", style, disabled, className, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  const [hover, setHover] = useState(false);
  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    fontWeight: 600, fontSize: size === "sm" ? t.font.sm : t.font.base, lineHeight: 1,
    padding: size === "sm" ? "7px 12px" : "9px 16px", borderRadius: t.radius.md,
    border: "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1, transition: "background 120ms, border-color 120ms, box-shadow 120ms",
    textDecoration: "none", whiteSpace: "nowrap",
  };
  const variants: Record<BtnVariant, React.CSSProperties> = {
    primary: { background: hover && !disabled ? t.color.accentHover : t.color.accent, color: "#fff", boxShadow: t.shadow.sm },
    secondary: { background: hover && !disabled ? t.color.surfaceMuted : t.color.surface, color: t.color.text, borderColor: t.color.border },
    ghost: { background: hover && !disabled ? t.color.surfaceMuted : "transparent", color: t.color.textMuted },
    danger: { background: hover && !disabled ? t.color.dangerSoft : "transparent", color: t.color.danger, borderColor: hover ? t.color.danger : "transparent" },
  };
  return (
    <button {...rest} disabled={disabled}
      className={["ds-btn", className].filter(Boolean).join(" ")}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...base, ...variants[variant], ...style }} />
  );
}

// LinkButton — anchor styled as a button (for hrefs / downloads).
export function LinkButton({ variant = "secondary", size = "md", style, className, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: BtnVariant; size?: BtnSize }) {
  const map: Record<BtnVariant, React.CSSProperties> = {
    primary: { background: t.color.accent, color: "#fff" },
    secondary: { background: t.color.surface, color: t.color.text, border: `1px solid ${t.color.border}` },
    ghost: { background: "transparent", color: t.color.textMuted },
    danger: { background: "transparent", color: t.color.danger },
  };
  return (
    <a {...rest} className={["ds-btn", className].filter(Boolean).join(" ")} style={{
      display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, textDecoration: "none",
      fontSize: size === "sm" ? t.font.sm : t.font.base, padding: size === "sm" ? "7px 12px" : "9px 16px",
      borderRadius: t.radius.md, ...map[variant], ...style,
    }} />
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
export function Card({ style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} style={{ background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: t.radius.lg, boxShadow: t.shadow.sm, padding: 18, ...style }} />;
}
export function CardTitle({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontWeight: 600, fontSize: t.font.lg, color: t.color.text, marginBottom: 12, ...style }}>{children}</div>;
}

// ── PageHeader ────────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: t.font.xxl, fontWeight: 700, color: t.color.text, letterSpacing: -0.3 }}>{title}</h1>
        {subtitle && <p style={{ margin: "6px 0 0", color: t.color.textMuted, fontSize: t.font.base, maxWidth: 640 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}

// ── Form controls ─────────────────────────────────────────────────────────────
export function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <label style={{ display: "block", fontSize: t.font.sm, fontWeight: 600, color: t.color.text, marginBottom: 6, ...style }}>{children}</label>;
}
export function Field({ label, hint, children }: { label?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <Label>{label}</Label>}
      {children}
      {hint && <div style={{ color: t.color.textFaint, fontSize: t.font.xs, marginTop: 5 }}>{hint}</div>}
    </div>
  );
}
const controlStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: t.radius.md, border: `1px solid ${t.color.borderStrong}`,
  fontSize: t.font.base, color: t.color.text, background: t.color.surface, boxSizing: "border-box", fontFamily: "inherit", outline: "none",
};
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ style, className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={["ds-field", className].filter(Boolean).join(" ")} style={{ ...controlStyle, ...style }} />;
});
export function Select({ style, className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={["ds-field", className].filter(Boolean).join(" ")} style={{ ...controlStyle, ...style }}>{children}</select>;
}
export function Textarea({ style, className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={["ds-field", className].filter(Boolean).join(" ")} style={{ ...controlStyle, minHeight: 80, resize: "vertical", ...style }} />;
}

// ── Badge ───────────────────────────────────────────────────────────────────
type Tone = "neutral" | "success" | "warning" | "danger" | "accent";
export function Badge({ children, tone = "neutral", style }: { children: React.ReactNode; tone?: Tone; style?: React.CSSProperties }) {
  const map: Record<Tone, React.CSSProperties> = {
    neutral: { background: t.color.surfaceMuted, color: t.color.textMuted },
    success: { background: "#dcfce7", color: t.color.success },
    warning: { background: "#fef3c7", color: t.color.warning },
    danger: { background: t.color.dangerSoft, color: t.color.danger },
    accent: { background: t.color.accentSoft, color: t.color.accent },
  };
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: t.radius.pill, fontSize: t.font.xs, fontWeight: 600, ...map[tone], ...style }}>{children}</span>;
}

// ── EmptyState ────────────────────────────────────────────────────────────────
export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Card style={{ textAlign: "center", padding: "40px 24px" }}>
      {icon && <div style={{ fontSize: 28, marginBottom: 10 }}>{icon}</div>}
      <div style={{ fontWeight: 600, fontSize: t.font.lg, color: t.color.text }}>{title}</div>
      {description && <div style={{ color: t.color.textMuted, fontSize: t.font.base, margin: "6px auto 16px", maxWidth: 420 }}>{description}</div>}
      {action}
    </Card>
  );
}

// Friendly empty state for inside a <table> body — drop where rows would go.
// Keeps table empties consistent and on-brand instead of a bare centered <td>.
export function TableEmpty({ colSpan, title, description, icon = "📋" }: { colSpan: number; title: string; description?: string; icon?: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: "center", padding: "40px 16px" }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
        <div style={{ fontWeight: 600, color: t.color.text, fontSize: t.font.base }}>{title}</div>
        {description && <div style={{ color: t.color.textMuted, fontSize: t.font.sm, margin: "4px auto 0", maxWidth: 360 }}>{description}</div>}
      </td>
    </tr>
  );
}

// Progressive disclosure (E-13d) — tuck advanced/optional fields behind a
// click-to-expand summary so the common path stays uncluttered. Collapsed by
// default unless `defaultOpen`.
export function Disclosure({ summary, children, defaultOpen = false }: { summary: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: t.color.textMuted, fontSize: t.font.sm, fontWeight: 600, padding: "4px 0" }}
      >
        <span style={{ display: "inline-block", transition: "transform 120ms", transform: open ? "rotate(90deg)" : "none", fontSize: 10 }}>▶</span>
        {summary}
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span style={{ display: "inline-block", width: size, height: size, border: `2px solid ${t.color.border}`, borderTopColor: t.color.accent, borderRadius: "50%", animation: "ds-spin 0.7s linear infinite" }} />;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ title, children, onClose, footer, width = 460 }: { title: string; children: React.ReactNode; onClose: () => void; footer?: React.ReactNode; width?: number }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.color.surface, borderRadius: t.radius.lg, boxShadow: t.shadow.lg, width, maxWidth: "100%", maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px", borderBottom: `1px solid ${t.color.border}` }}>
          <div style={{ fontWeight: 600, fontSize: t.font.lg }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: t.color.textFaint, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
        {footer && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 18px", borderTop: `1px solid ${t.color.border}` }}>{footer}</div>}
      </div>
    </div>
  );
}

// ── Toasts ────────────────────────────────────────────────────────────────────
type Toast = { id: number; text: string; tone: "success" | "error" | "info" };
const ToastCtx = createContext<{ push: (text: string, tone?: Toast["tone"]) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text, tone }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div style={{ position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 8, zIndex: 1100 }}>
        {toasts.map((t2) => (
          <div key={t2.id} style={{
            background: t.color.text, color: "#fff", padding: "10px 14px", borderRadius: t.radius.md, boxShadow: t.shadow.lg,
            fontSize: t.font.sm, fontWeight: 500, minWidth: 220, borderLeft: `3px solid ${t2.tone === "success" ? "#22c55e" : t2.tone === "error" ? "#ef4444" : "#38bdf8"}`,
          }}>{t2.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const ctx = useContext(ToastCtx);
  return ctx ?? { push: () => { /* no provider mounted */ } };
}

export { t as tokens };
