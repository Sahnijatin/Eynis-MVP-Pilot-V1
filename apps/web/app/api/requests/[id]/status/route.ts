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
  const status = String(formData.get("status") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "/queue").trim() || "/queue";
  const returnSearch = String(formData.get("returnSearch") ?? "");
  if (!status) {
    return NextResponse.redirect(
      buildActionRedirectUrl(req.url, returnTo, returnSearch, "status", "error", "Choose a status before updating.")
    );
  }

  const token = await getApiToken();
  const response = await fetch(getApiBaseUrl() + "/service-requests/" + id + "/status", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + token
    },
    body: JSON.stringify({ status })
  });

  if (response.ok) {
    return NextResponse.redirect(buildActionRedirectUrl(req.url, returnTo, returnSearch, "status", "ok"));
  }
  const apiMsg = await extractApiErrorMessage(response);
  return NextResponse.redirect(buildActionRedirectUrl(req.url, returnTo, returnSearch, "status", "error", apiMsg));
}
