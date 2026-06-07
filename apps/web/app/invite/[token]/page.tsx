import { Building2 } from "lucide-react";
import InviteAcceptClient from "./invite-accept-client";
import { resolveHostTheme } from "../../../lib/host-theme";

interface InviteInfo {
  ok: boolean;
  email?: string;
  hotelName?: string;
  roleName?: string;
  roleKey?: string;
  expired?: boolean;
  accepted?: boolean;
  error?: string;
}

async function getInviteInfo(token: string): Promise<InviteInfo> {
  const apiBase = process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${apiBase}/team/invitations/${token}`, {
      cache: "no-store",
    });
    return (await res.json()) as InviteInfo;
  } catch {
    return { ok: false, error: "Could not load invitation" };
  }
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [invite, theme] = await Promise.all([getInviteInfo(token), resolveHostTheme()]);
  // Brand the invite with the tenant: logo/color from the host theme (custom
  // domain), wordmark from the host theme or the inviting workspace's name — never
  // a hardcoded platform brand (white-label, E-9).
  const brandLabel = theme.isTenant ? theme.brandName : invite.hotelName ?? theme.brandName;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden" style={{ background: theme.primaryColor }}>
            {theme.logoUrl
              ? <img src={theme.logoUrl} alt="" className="w-full h-full object-contain" />
              : <Building2 className="w-5 h-5 text-white" />}
          </div>
          <span className="text-xl font-bold text-gray-900">{brandLabel}</span>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {!invite.ok && (
            <div className="text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">✗</span>
              </div>
              <h1 className="text-xl font-semibold text-gray-900 mb-2">
                Invitation not found
              </h1>
              <p className="text-gray-500 text-sm">
                {invite.error ?? "This invitation link is invalid or has been removed."}
              </p>
            </div>
          )}

          {invite.ok && invite.accepted && (
            <div className="text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">✓</span>
              </div>
              <h1 className="text-xl font-semibold text-gray-900 mb-2">
                Already accepted
              </h1>
              <p className="text-gray-500 text-sm">
                This invitation has already been accepted. Sign in to continue.
              </p>
              <a
                href="/sign-in"
                className="mt-6 inline-block w-full text-center py-2.5 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Go to Sign In
              </a>
            </div>
          )}

          {invite.ok && invite.expired && !invite.accepted && (
            <div className="text-center">
              <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">⏰</span>
              </div>
              <h1 className="text-xl font-semibold text-gray-900 mb-2">
                Invitation expired
              </h1>
              <p className="text-gray-500 text-sm">
                This invitation link has expired. Ask your admin to send a new one.
              </p>
            </div>
          )}

          {invite.ok && !invite.expired && !invite.accepted && (
            <InviteAcceptClient
              token={token}
              email={invite.email!}
              hotelName={invite.hotelName!}
              roleName={invite.roleName!}
            />
          )}
        </div>
      </div>
    </div>
  );
}
