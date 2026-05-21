import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const hotelId = String(formData.get("hotelId") ?? "").trim();
  const guestName = String(formData.get("guestName") ?? "").trim();
  const guestPhone = String(formData.get("guestPhone") ?? "").trim();
  const category = String(formData.get("category") ?? "general").trim() || "general";
  const summary = String(formData.get("summary") ?? "").trim();
  const safeGuestName = guestName.slice(0, 40);
  const safeCategory = category.replace(/_/g, " ").slice(0, 30);

  if (!hotelId || !guestName || !guestPhone || !summary) {
    return NextResponse.redirect(
      new URL(
        "/request?hotelId=" +
          encodeURIComponent(hotelId) +
          "&result=error&msg=" +
          encodeURIComponent("All fields are required."),
        req.url
      )
    );
  }

  const response = await fetch(getApiBaseUrl() + "/public/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hotelId, guestName, guestPhone, category, summary })
  });
  if (!response.ok) {
    let errorMsg = "Could not submit request.";
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim().length > 0) {
        errorMsg = payload.error.trim();
      }
    } catch {
      // keep fallback message
    }
    return NextResponse.redirect(
      new URL(
        "/request?hotelId=" +
          encodeURIComponent(hotelId) +
          "&result=error&msg=" +
          encodeURIComponent(errorMsg),
        req.url
      )
    );
  }

  const ackText =
    "Thank you " +
    safeGuestName +
    ". Your " +
    safeCategory +
    " request has been received. Our team will get back to you shortly.";

  return NextResponse.redirect(
    new URL(
      "/request?hotelId=" +
        encodeURIComponent(hotelId) +
        "&result=ok&ack=" +
        encodeURIComponent(ackText),
      req.url
    )
  );
}

