// WhatsApp template enforcement.
//
// Meta only permits business-initiated WhatsApp messages via a *pre-approved*
// template. These helpers resolve a library template to its approved provider
// Content SID and refuse anything that isn't approved — the single chokepoint
// the dispatcher and sequence runner go through before any WhatsApp send.

import { prisma } from "../../db/prisma";

export interface ResolvedWhatsappTemplate {
  contentSid: string;
  body: string | null;
  variables: string[];
}

// Pure gate: is this template row sendable as a business-initiated WhatsApp msg?
export function isApprovedWhatsappTemplate(
  t: { channel: string; status: string; providerTemplateId: string | null } | null | undefined,
): boolean {
  return !!t && t.channel === "whatsapp" && t.status === "approved" && !!t.providerTemplateId;
}

// Resolve an approved WhatsApp template by id. Returns null when the template is
// missing / not whatsapp / not approved / has no provider id — callers MUST NOT
// send in that case.
export async function resolveApprovedWhatsappTemplate(templateId: string): Promise<ResolvedWhatsappTemplate | null> {
  const t = await prisma.messageTemplate.findUnique({ where: { id: templateId } });
  if (!isApprovedWhatsappTemplate(t)) return null;
  let variables: string[] = [];
  try { const v = JSON.parse(t!.variables); if (Array.isArray(v)) variables = v; } catch { /* ignore */ }
  return { contentSid: t!.providerTemplateId!, body: t!.body, variables };
}
