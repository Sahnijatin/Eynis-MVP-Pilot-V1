import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        sidebar: "#142032",
        "sidebar-hover": "#1c2f47",
        "sidebar-active": "#0f766e",
        teal: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a"
        },

        // ── Design-system semantic palette (Phase 6) ─────────────────────────
        // Each key resolves to a CSS custom property from the token layer in
        // globals.css (docs/design-system/tokens.md), so utilities like
        // `bg-surface` / `text-fg-muted` / `bg-danger-bg` flip light↔dark and
        // adopt the tenant/personality theme automatically.
        //
        // Neutrals + status read the STATIC `:root` tokens (defined in
        // globals.css) → resolve at first paint on every page. The ACCENT family
        // is injected client-side from the tenant hue (app-shell.tsx), so each
        // accent key carries a hardcoded teal fallback equal to the exact shade
        // it replaces — first paint and out-of-shell public pages stay identical.
        canvas: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
          inset: "var(--surface-inset)"
        },
        line: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)"
        },
        fg: {
          DEFAULT: "var(--text)",
          muted: "var(--text-muted)",
          subtle: "var(--text-subtle)",
          faint: "var(--text-faint)"
        },
        accent: {
          DEFAULT: "var(--accent-solid, #0f766e)",
          hover: "var(--accent-solid-hover, #115e59)",
          text: "var(--accent-text, #0f766e)",
          bg: "var(--accent-bg, #f0fdfa)",
          line: "var(--accent-line, #99f6e4)",
          border: "var(--accent-border, #5eead4)",
          focus: "var(--accent-focus, #14b8a6)",
          contrast: "var(--accent-contrast, #ffffff)"
        },
        ok: {
          DEFAULT: "var(--ok-text)",
          bg: "var(--ok-bg)",
          border: "var(--ok-border)",
          solid: "var(--ok-solid)"
        },
        warn: {
          DEFAULT: "var(--warn-text)",
          bg: "var(--warn-bg)",
          border: "var(--warn-border)",
          solid: "var(--warn-solid)"
        },
        danger: {
          DEFAULT: "var(--danger-text)",
          bg: "var(--danger-bg)",
          border: "var(--danger-border)",
          solid: "var(--danger-solid)"
        },
        info: {
          DEFAULT: "var(--info-text)",
          bg: "var(--info-bg)",
          border: "var(--info-border)",
          solid: "var(--info-solid)"
        }
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
};

export default config;
