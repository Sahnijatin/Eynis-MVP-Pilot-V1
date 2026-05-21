import { NextRequest, NextResponse } from "next/server";
import { extractApiErrorMessage } from "../../../../../lib/flash-message";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";
import { buildActionRedirectUrl } from "../../../../../lib/redirect-queue";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const formData = await req.formData();
  const assigneeEmail = String(formData.get("assigneeEmail") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "/queue").trim() || "/queue";
  const returnSearch = String(formData.get("returnSearch") ?? "");
  if (!assigneeEmail) {
    return NextResponse.redirect(
      buildActionRedirectUrl(req.url, returnTo, returnSearch, "assign", "error", "Choose someone to assign.")
    );
  }

  const token = await getApiToken();
  const response = await fetch(getApiBaseUrl() + "/service-requests/" + id + "/assign", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + token
    },
    body: JSON.stringify({ assigneeEmail })
  });

  if (response.ok) {
    return NextResponse.redirect(buildActionRedirectUrl(req.url, returnTo, returnSearch, "assign", "ok"));
  }
  const apiMsg = await extractApiErrorMessage(response);
  return NextResponse.redirect(buildActionRedirectUrl(req.url, returnTo, returnSearch, "assign", "error", apiMsg));
}
