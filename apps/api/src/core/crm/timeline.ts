// CRM unified timeline (Increment C) — read-time projection.
//
// The "conversational CRM" view: one chronological stream per contact, stitched
// from manual activities + channel events (calls, WhatsApp, email sends, service
// requests) + deal stage changes. Channel events are projected at read time (not
// duplicated into the Activity table) so there is one source of truth per event.

import { prisma } from "../../db/prisma";

export interface TimelineItem {
  id: string;
  kind: string; // note|task|meeting|call|whatsapp|email|message|service_request|stage_change|ai_score|ai_suggestion
  title: string;
  body: string | null;
  direction: string | null; // inbound | outbound | null
  sentiment: string | null;
  status: string | null;
  at: string; // ISO
  meta?: Record<string, unknown>;
}

export async function buildContactTimeline(tenantId: string, contactId: string): Promise<TimelineItem[]> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId }, select: { id: true } });
  if (!contact) return [];

  const [leads, deals] = await Promise.all([
    prisma.campaignLead.findMany({ where: { tenantId, contactId }, select: { id: true } }),
    prisma.deal.findMany({ where: { tenantId, contactId }, select: { id: true } }),
  ]);
  const leadIds = leads.map((l) => l.id);
  const dealIds = deals.map((d) => d.id);

  const [activities, calls, convos, deliveries, srs, transitions] = await Promise.all([
    prisma.activity.findMany({ where: { tenantId, contactId }, include: { user: { select: { fullName: true } } } }),
    leadIds.length ? prisma.callRecord.findMany({ where: { tenantId, leadId: { in: leadIds } } }) : Promise.resolve([]),
    leadIds.length ? prisma.whatsappConversation.findMany({ where: { tenantId, leadId: { in: leadIds } }, select: { id: true } }) : Promise.resolve([]),
    leadIds.length ? prisma.messageDelivery.findMany({ where: { tenantId, leadId: { in: leadIds } } }) : Promise.resolve([]),
    prisma.serviceRequest.findMany({ where: { tenantId, guestId: contactId } }),
    dealIds.length ? prisma.dealTransition.findMany({ where: { tenantId, dealId: { in: dealIds } } }) : Promise.resolve([]),
  ]);

  const convoIds = (convos as Array<{ id: string }>).map((c) => c.id);
  const messages = convoIds.length
    ? await prisma.whatsappMessage.findMany({ where: { tenantId, conversationId: { in: convoIds } } })
    : [];

  const items: TimelineItem[] = [];

  for (const a of activities) {
    items.push({
      id: a.id, kind: a.type, title: a.title, body: a.body, direction: a.direction,
      sentiment: null, status: a.status, at: a.createdAt.toISOString(),
      meta: { userName: a.user?.fullName ?? null, dueAt: a.dueAt?.toISOString() ?? null, completedAt: a.completedAt?.toISOString() ?? null },
    });
  }
  for (const c of calls as Array<{ id: string; status: string; outcome: string | null; aiSummary: string | null; transcript: string | null; sentiment: string | null; endedAt: Date | null; createdAt: Date }>) {
    items.push({
      id: c.id, kind: "call", title: c.outcome ? `Call — ${c.outcome}` : `Call (${c.status})`,
      body: c.aiSummary ?? c.transcript ?? null, direction: "outbound", sentiment: c.sentiment, status: c.status,
      at: (c.endedAt ?? c.createdAt).toISOString(), meta: { outcome: c.outcome },
    });
  }
  for (const m of messages as Array<{ id: string; direction: string; body: string; sentiment: string | null; createdAt: Date }>) {
    items.push({
      id: m.id, kind: "whatsapp", title: m.direction === "in" ? "WhatsApp received" : "WhatsApp sent",
      body: m.body, direction: m.direction === "in" ? "inbound" : "outbound", sentiment: m.sentiment, status: null,
      at: m.createdAt.toISOString(),
    });
  }
  for (const d of deliveries as Array<{ id: string; channel: string; status: string; renderedSubject: string | null; sentAt: Date | null; createdAt: Date }>) {
    items.push({
      id: d.id, kind: d.channel === "email" ? "email" : "message", title: `${d.channel} ${d.status}`,
      body: d.renderedSubject ?? null, direction: "outbound", sentiment: null, status: d.status,
      at: (d.sentAt ?? d.createdAt).toISOString(),
    });
  }
  for (const s of srs) {
    items.push({
      id: s.id, kind: "service_request", title: `Request: ${s.category}`, body: s.summary,
      direction: "inbound", sentiment: null, status: s.status, at: s.createdAt.toISOString(),
    });
  }
  for (const tr of transitions as Array<{ id: string; note: string | null; createdAt: Date }>) {
    items.push({ id: tr.id, kind: "stage_change", title: "Deal stage changed", body: tr.note ?? null, direction: null, sentiment: null, status: null, at: tr.createdAt.toISOString() });
  }

  items.sort((a, b) => b.at.localeCompare(a.at)); // newest first
  return items;
}

// A compact text digest of a contact's recent conversation (call summaries +
// WhatsApp message bodies + service requests), newest first — the signal the AI
// reasons over for scoring and next-best-action.
export async function recentConversationText(tenantId: string, contactId: string, max = 12): Promise<string> {
  const items = await buildContactTimeline(tenantId, contactId);
  const convo = items
    .filter((i) => ["call", "whatsapp", "service_request", "note"].includes(i.kind) && (i.body || i.title))
    .slice(0, max)
    .map((i) => {
      const who = i.direction === "inbound" ? "Customer" : i.direction === "outbound" ? "Us" : "Event";
      const s = i.sentiment ? ` [${i.sentiment}]` : "";
      return `- (${i.kind}${s}) ${who}: ${i.body ?? i.title}`;
    });
  return convo.join("\n");
}
