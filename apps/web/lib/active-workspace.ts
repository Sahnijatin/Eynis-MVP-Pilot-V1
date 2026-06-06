import { cookies } from "next/headers";

// Active-workspace selection (multi-workspace membership). One identity can
// belong to many workspaces; this cookie records which one the user is currently
// acting in. It is only ever *honoured* when it matches one of the user's real
// memberships (validated in resolveUserContext), so it carries no privilege on
// its own — a tampered value simply falls back to the first workspace.

export const WORKSPACE_COOKIE = "eynis_workspace";

export async function readActiveWorkspace(): Promise<string | null> {
  try {
    return (await cookies()).get(WORKSPACE_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}
