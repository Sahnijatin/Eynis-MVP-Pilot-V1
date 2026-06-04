type UnknownRecord = Record<string, unknown>;

export type NormalizedWhatsappInbound = {
  provider: "interakt" | "twilio" | "generic";
  tenantId: string;
  fromPhone: string;
  message: string;
  guestName: string;
};

const asTrimmedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const normalizePhone = (value: string) => value.replace(/\s+/g, "");

function normalizeGeneric(body: UnknownRecord): NormalizedWhatsappInbound | null {
  const tenantId = asTrimmedString(body.tenantId) ?? asTrimmedString(body.hotelId); // accept legacy hotelId
  const fromPhone = asTrimmedString(body.fromPhone);
  const message = asTrimmedString(body.message);
  const guestName = asTrimmedString(body.guestName) ?? "WhatsApp Guest";
  if (!tenantId || !fromPhone || !message) return null;
  return {
    provider: "generic",
    tenantId,
    fromPhone: normalizePhone(fromPhone),
    message,
    guestName
  };
}

function normalizeTwilio(body: UnknownRecord): NormalizedWhatsappInbound | null {
  const tenantId = asTrimmedString(body.tenantId) ?? asTrimmedString(body.hotelId); // accept legacy hotelId
  const from = asTrimmedString(body.From);
  const message = asTrimmedString(body.Body);
  const profileName = asTrimmedString(body.ProfileName) ?? "WhatsApp Guest";
  if (!tenantId || !from || !message) return null;
  const fromPhone = from.replace(/^whatsapp:/, "");
  return {
    provider: "twilio",
    tenantId,
    fromPhone: normalizePhone(fromPhone),
    message,
    guestName: profileName
  };
}

function normalizeInterakt(body: UnknownRecord): NormalizedWhatsappInbound | null {
  const data = (body.data ?? body.payload) as UnknownRecord | undefined;
  const tenantId = asTrimmedString(body.tenantId) ?? asTrimmedString(body.hotelId) ?? asTrimmedString(data?.tenantId) ?? asTrimmedString(data?.hotelId); // accept legacy hotelId
  const fromPhone =
    asTrimmedString(body.phone_number) ??
    asTrimmedString(data?.phone_number) ??
    asTrimmedString(data?.from);
  const message =
    asTrimmedString(body.message) ??
    asTrimmedString(data?.message) ??
    asTrimmedString(data?.text);
  const guestName =
    asTrimmedString(body.customer_name) ??
    asTrimmedString(data?.customer_name) ??
    asTrimmedString(data?.name) ??
    "WhatsApp Guest";
  if (!tenantId || !fromPhone || !message) return null;
  return {
    provider: "interakt",
    tenantId,
    fromPhone: normalizePhone(fromPhone),
    message,
    guestName
  };
}

export function normalizeWhatsappInbound(body: UnknownRecord): NormalizedWhatsappInbound | null {
  const provider = asTrimmedString(body.provider)?.toLowerCase();
  if (provider === "twilio") return normalizeTwilio(body);
  if (provider === "interakt") return normalizeInterakt(body);

  // Auto-detect when provider isn't explicitly sent.
  if (typeof body.From === "string" || typeof body.Body === "string") {
    return normalizeTwilio(body);
  }
  if (
    typeof body.phone_number === "string" ||
    typeof (body.data as UnknownRecord | undefined)?.phone_number === "string"
  ) {
    return normalizeInterakt(body);
  }
  return normalizeGeneric(body);
}

