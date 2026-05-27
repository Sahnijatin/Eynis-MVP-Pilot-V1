"use client";

import { useClerk } from "@clerk/nextjs";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  const { signOut } = useClerk();

  return (
    <button
      onClick={() => signOut({ redirectUrl: "/sign-in" })}
      className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-100"
    >
      <LogOut className="w-3.5 h-3.5" />
      Sign out
    </button>
  );
}
