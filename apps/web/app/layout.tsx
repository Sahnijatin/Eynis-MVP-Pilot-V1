import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { AppShell } from "../components/ui/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eynis Platform",
  description: "Intelligent operations platform for every industry"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body style={{ margin: 0, fontFamily: "Inter, system-ui, Segoe UI, Arial, sans-serif", background: "var(--color-bg)" }}>
          <AppShell>
            {children}
          </AppShell>
        </body>
      </html>
    </ClerkProvider>
  );
}
