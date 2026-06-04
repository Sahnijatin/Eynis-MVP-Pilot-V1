// Conversational two-way WhatsApp agent (Phase 8).
//
// When an inbound WhatsApp message maps to a lead in a campaign with
// whatsappAgentEnabled, this module holds a stateful conversation: it records
// the message + per-message sentiment, detects opt-out, generates a reply, and
// sends it back. **Configurable:** each campaign carries `whatsappAgentPrompt`
// — the operator's own instructions for how the bot should respond — which is
// used as the LLM system prompt. Reply generation is dependency-injected and
// degrades to a safe templated fallback when no AI key is set (keys-last).

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../db/prisma";
import { broadcastSSEEvent } from "../../sse/clients";
import { classifySentiment } from "./sentiment";
import { detectOptOut } from "./compliance";
import { suppressContact } from "./csv-import";
import { renderTemplate, buildTemplateVars } from "../email/resend";
import { sendWhatsAppReply } from "../connectors/whatsapp-outbound";

const AGENT_MODEL = "claude-haiku-4-5-20251001";
const THREAD_WINDOW = 10; // recent messages given to the model for context

export interface InboundWhatsApp {
  tenantId: string;
  fromPhone: string;
  body: string;
  providerMessageId?: string | null;
}

export interface ReplyContext {
  systemPrompt: string;          // resolved from campaign.whatsappAgentPrompt (+ booking link)
  vars: Record<string, string>;  // {variable} map for the lead
  thread: Array<{ role: "customer" | "agent"; text: string }>;
  inbound: string;
}

export interface AgentDeps {
  generateReply?: (ctx: ReplyContext) => Promise<string>;
  sendMessage?: (tenantId: string, toPhone: string, message: string) => Promise<{ sent: boolean; id?: string; error?: string }>;
}

const normalizePhone = (raw: string): string => raw.replace(/^whatsapp:/i, "").replace(/\s+/g, "").trim();

const BOOKING_INTENT = ["book", "booking", "schedule", "appointment", "available", "when can", "call me", "interested", "yes please", "sign me up", "demo"];
const detectBookingIntent = (text: string): boolean => {
  const t = text.toLowerCase();
  return BOOKING_INTENT.some((k) => t.includes(k));
};

// Default reply generator: uses the operator's configured prompt via Claude when
// a key is set; otherwise a safe, on-brand fallback that never invents details.
async function defaultGenerateReply(ctx: ReplyContext): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    const name = ctx.vars["lead.firstName"] ? `, ${ctx.vars["lead.firstName"]}` : "";
    const link = ctx.vars["booking.calendlyLink"];
    return `Thanks for your message${name}! A team member will follow up shortly.` + (link ? ` You can also book a time here: ${link}` : "");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = [
    ...ctx.thread.map((m) => ({ role: m.role === "customer" ? "user" as const : "assistant" as const, content: m.text })),
    { role: "user" as const, content: ctx.inbound },
  ];
  const res = await client.messages.create({
    model: AGENT_MODEL,
    max_tokens: 300,
    system: ctx.systemPrompt,
    messages,
  });
  const block = res.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text.trim() : "Thanks for your message! A team member will follow up shortly.";
}

// Builds the system prompt from the operator's configurable instructions, with a
// sensible default, and appends the booking link directive when available.
export function buildAgentSystemPrompt(opts: { agentPrompt: string | null; tenantName: string | null; calendlyLink: string | null; vars: Record<string, string> }): string {
  const base = opts.agentPrompt?.trim()
    || `You are a helpful, concise WhatsApp assistant for ${opts.tenantName ?? "our team"}. Be friendly and professional, keep replies short (1-3 sentences), and only state facts you are given.`;
  const resolved = renderTemplate(base, opts.vars);
  const booking = opts.calendlyLink ? `\n\nIf the customer wants to book or shows interest, share this scheduling link: ${opts.calendlyLink}` : "";
  return resolved + booking;
}

export async function handleInboundWhatsApp(input: InboundWhatsApp, deps: AgentDeps = {}): Promise<{ handled: boolean; reason?: string }> {
  const phone = normalizePhone(input.fromPhone);
  const body = (input.body ?? "").trim();
  if (!phone || !body) return { handled: false, reason: "empty" };

  // Find a lead on a WhatsApp-agent campaign for this tenant (most recent first).
  const lead = await prisma.campaignLead.findFirst({
    where: { tenantId: input.tenantId, phone, campaign: { whatsappAgentEnabled: true, status: { not: "draft" } } },
    include: { campaign: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!lead) return { handled: false, reason: "no_agent_lead" };
  const campaign = lead.campaign;

  // Resolve/create the conversation.
  let conversation = await prisma.whatsappConversation.findFirst({ where: { campaignId: campaign.id, leadId: lead.id } });
  if (!conversation) {
    conversation = await prisma.whatsappConversation.create({ data: { tenantId: input.tenantId, campaignId: campaign.id, leadId: lead.id, state: "open" } });
  }

  // Idempotency: a re-delivered inbound webhook must not double-reply.
  if (input.providerMessageId) {
    const dupe = await prisma.whatsappMessage.findFirst({ where: { conversationId: conversation.id, direction: "in", providerId: input.providerMessageId } });
    if (dupe) return { handled: true, reason: "duplicate" };
  }

  // Record inbound message + sentiment.
  const inboundSentiment = classifySentiment(body);
  await prisma.whatsappMessage.create({
    data: { tenantId: input.tenantId, conversationId: conversation.id, direction: "in", body, providerId: input.providerMessageId ?? null, sentiment: inboundSentiment.sentiment, score: inboundSentiment.score },
  });
  await prisma.whatsappConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
  broadcastSSEEvent({ type: "whatsapp_message", tenantId: input.tenantId, campaignId: campaign.id, conversationId: conversation.id, direction: "in", sentiment: inboundSentiment.sentiment });

  const sendMessage = deps.sendMessage ?? ((h: string, to: string, msg: string) => sendWhatsAppReply(h, to, msg).then((r) => ({ sent: r.sent, id: r.id, error: r.error })));

  // Opt-out: suppress tenant-wide, close the conversation, send a confirmation.
  if (detectOptOut(body)) {
    await suppressContact(input.tenantId, phone, "opt_out");
    await prisma.whatsappConversation.update({ where: { id: conversation.id }, data: { state: "opted_out" } });
    const confirm = "You've been unsubscribed and won't receive further messages. Thank you.";
    const sent = await sendMessage(input.tenantId, phone, confirm);
    await prisma.whatsappMessage.create({ data: { tenantId: input.tenantId, conversationId: conversation.id, direction: "out", body: confirm, providerId: sent.id ?? null, sentiment: "neutral", score: 0 } });
    return { handled: true, reason: "opted_out" };
  }

  // Build context + generate the reply (operator-configured behaviour).
  const vars = buildTemplateVars({
    lead: { firstName: lead.firstName, lastName: lead.lastName, company: lead.company, jobTitle: lead.jobTitle, email: lead.email, phone: lead.phone, rawData: lead.rawData },
    campaign: { name: campaign.name, calendlyLink: campaign.calendlyLink },
    tenant: { name: null },
    booking: { calendlyLink: campaign.calendlyLink },
  });
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { name: true } });
  if (tenant?.name) vars["tenant.name"] = tenant.name;

  const recent = await prisma.whatsappMessage.findMany({
    where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: THREAD_WINDOW,
    select: { direction: true, body: true },
  });
  const thread = recent.reverse().slice(0, -1).map((m) => ({ role: m.direction === "in" ? "customer" as const : "agent" as const, text: m.body }));

  const systemPrompt = buildAgentSystemPrompt({ agentPrompt: campaign.whatsappAgentPrompt, tenantName: tenant?.name ?? null, calendlyLink: campaign.calendlyLink, vars });
  const generateReply = deps.generateReply ?? defaultGenerateReply;
  let reply = await generateReply({ systemPrompt, vars, thread, inbound: body });

  // Booking intent: make sure the scheduling link is present when relevant.
  const booked = detectBookingIntent(body);
  if (booked && campaign.calendlyLink && !reply.includes(campaign.calendlyLink)) {
    reply = `${reply}\n\nBook a time here: ${campaign.calendlyLink}`;
  }

  const sent = await sendMessage(input.tenantId, phone, reply);
  await prisma.whatsappMessage.create({
    data: { tenantId: input.tenantId, conversationId: conversation.id, direction: "out", body: reply, providerId: sent.id ?? null, sentiment: "neutral", score: 0 },
  });
  await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: { state: booked ? "booked" : "awaiting_reply", lastMessageAt: new Date(), threadSummary: body.slice(0, 200) },
  });
  broadcastSSEEvent({ type: "whatsapp_message", tenantId: input.tenantId, campaignId: campaign.id, conversationId: conversation.id, direction: "out" });

  return { handled: true, reason: sent.sent ? "replied" : "reply_failed" };
}
