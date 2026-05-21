import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "../components/ui/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eynis Platform",
  description: "Hospitality intelligence and automation platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Inter, system-ui, Segoe UI, Arial, sans-serif", background: "var(--color-bg)" }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
