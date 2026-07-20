import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { AppShell } from "../components/ui/app-shell";
import { ToastProvider } from "../components/ds";
import { cookies } from "next/headers";
import { resolveUserContext } from "../lib/user-context";
import { resolveHostTheme } from "../lib/host-theme";
import { platformBrand } from "../lib/platform";
import { THEME_COOKIE, resolveThemeMode, type ThemeChoice } from "../lib/theme-mode";
import type { Industry } from "../lib/industry-config";
import type { OrgRole } from "../lib/rbac";
import "./globals.css";

// Resolved per request so the shell can paint the tenant brand on first render.
export const dynamic = "force-dynamic";

// First-paint tab title resolves from the Host header (white-label): a tenant on
// their own domain never flashes the platform brand, even before hydration (the
// shell still swaps in the signed-in tenant's brand client-side on the shared
// host). Falls back to the platform brand on the default host or any error.
export async function generateMetadata(): Promise<Metadata> {
  const theme = await resolveHostTheme();
  return {
    title: theme.isTenant ? theme.brandName : `${platformBrand()} Platform`,
    description: "Intelligent operations platform for every industry"
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Resolve the tenant's identity + branding server-side so AppShell's first
  // paint already carries the tenant brand — eliminates the Eynis/industry
  // fallback flash that appeared before /api/me resolved client-side (E-12).
  // resolveUserContext never throws (it has its own timeouts/fallbacks), but we
  // guard anyway so a context failure can never blank the whole app.
  let ctx: Awaited<ReturnType<typeof resolveUserContext>> | null = null;
  try {
    ctx = await resolveUserContext();
  } catch { /* keep AppShell defaults */ }

  // Stamp the theme server-side from the cookie so there's no flash and no
  // hydration mismatch (Phase 2). No explicit choice → "system", which honours
  // the OS via the @media block in globals.css — see lib/theme-mode.ts.
  let themeMode: ThemeChoice = "system";
  try {
    themeMode = resolveThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  } catch { /* cookies unavailable — honour OS */ }

  return (
    <ClerkProvider>
      <html lang="en" data-theme={themeMode} suppressHydrationWarning>
        <body style={{ margin: 0, fontFamily: "var(--font-brand, Inter, system-ui, Segoe UI, Arial, sans-serif)", background: "var(--bg)" }}>
          <ToastProvider>
            <AppShell
              platformBrand={platformBrand()}
              initialOrgRole={ctx?.orgRole as OrgRole | undefined}
              initialIndustry={(ctx?.industry as Industry | null) ?? undefined}
              initialPropertyName={ctx?.propertyName ?? null}
              initialBranding={ctx?.branding ?? null}
              initialWhitelabelTier={ctx?.whitelabelTier ?? null}
            >
              {children}
            </AppShell>
          </ToastProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
