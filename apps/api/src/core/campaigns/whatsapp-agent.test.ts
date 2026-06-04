import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { handleInboundWhatsApp, buildAgentSystemPrompt, type ReplyContext } from "./whatsapp-agent";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
let seq = 7000000000;
const phone = () => "+1" + String(seq++);

// Capture outbound sends + drive the reply text — no Twilio/Claude needed.
const out: Array<{ to: string; msg: string }> = [];
const deps = (replyText = "Sure, happy to help!") => ({
  generateReply: async (ctx: ReplyContext) => replyText + (ctx.vars["lead.firstName"] ? ` ${ctx.vars["lead.firstName"]}` : ""),
  sendMessage: async (_h: string, to: string, msg: string) => { out.push({ to, msg }); return { sent: true, id: "wamid_" + uid() }; },
});

async function setup(opts: { agentEnabled?: boolean; agentPrompt?: string | null; calendlyLink?: string | null } = {}) {
  const hotelId = "wa-" + uid();
  await prisma.hotel.create({ data: { id: hotelId, name: "WA " + hotelId.slice(-4), timezone: "Asia/Kolkata" } });
  const campaign = await prisma.voiceCampaign.create({
    data: {
      hotelId, name: "C", status: "active", channels: JSON.stringify(["whatsapp"]),
      whatsappContentSid: "HX1", whatsappAgentEnabled: opts.agentEnabled ?? true,
      whatsappAgentPrompt: opts.agentPrompt ?? "You are a warm concierge for {tenant.name}.",
      calendlyLink: opts.calendlyLink ?? null,
    },
  });
  const p = phone();
  const lead = await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "Sarah", phone: p, consent: true, consentSource: "csv_import" } });
  return { hotelId, campaignId: campaign.id, leadId: lead.id, phone: p };
}

after(async () => { await prisma.$disconnect(); });

test("buildAgentSystemPrompt uses the operator's configurable prompt + booking directive", () => {
  const p = buildAgentSystemPrompt({ agentPrompt: "Be {tenant.name}'s cheerful helper.", tenantName: "Riviera", calendlyLink: "https://cal.com/x", vars: { "tenant.name": "Riviera" } });
  assert.match(p, /cheerful helper/);
  assert.match(p, /Riviera/);
  assert.match(p, /https:\/\/cal\.com\/x/);
});

test("buildAgentSystemPrompt falls back to a sensible default when unset", () => {
  const p = buildAgentSystemPrompt({ agentPrompt: null, tenantName: "Riviera", calendlyLink: null, vars: {} });
  assert.match(p, /Riviera/);
});

test("inbound from an agent lead records the message, replies, and tracks sentiment", async () => {
  out.length = 0;
  const { hotelId, campaignId, phone: p } = await setup();
  const r = await handleInboundWhatsApp({ hotelId, fromPhone: `whatsapp:${p}`, body: "Hi, yes I'm interested!", providerMessageId: "m1" }, deps());
  assert.equal(r.handled, true);
  assert.equal(out.length, 1); // one reply sent
  const msgs = await prisma.whatsappMessage.findMany({ where: { conversation: { campaignId } }, orderBy: { createdAt: "asc" } });
  assert.equal(msgs.length, 2); // inbound + outbound
  assert.equal(msgs[0].direction, "in");
  assert.equal(msgs[0].sentiment, "positive");
  assert.equal(msgs[1].direction, "out");
});

test("non-agent senders are not handled (fall through to normal ingest)", async () => {
  const { hotelId } = await setup({ agentEnabled: false });
  const r = await handleInboundWhatsApp({ hotelId, fromPhone: phone(), body: "hello" }, deps());
  assert.equal(r.handled, false);
});

test("duplicate inbound (same providerMessageId) does not double-reply", async () => {
  out.length = 0;
  const { hotelId, phone: p } = await setup();
  await handleInboundWhatsApp({ hotelId, fromPhone: p, body: "hello", providerMessageId: "dup1" }, deps());
  const r2 = await handleInboundWhatsApp({ hotelId, fromPhone: p, body: "hello", providerMessageId: "dup1" }, deps());
  assert.equal(r2.reason, "duplicate");
  assert.equal(out.length, 1); // only the first replied
});

test("opt-out over WhatsApp suppresses tenant-wide and confirms", async () => {
  out.length = 0;
  const { hotelId, leadId, phone: p } = await setup();
  const r = await handleInboundWhatsApp({ hotelId, fromPhone: p, body: "STOP", providerMessageId: "s1" }, deps());
  assert.equal(r.reason, "opted_out");
  assert.equal(await prisma.doNotContact.count({ where: { hotelId, phone: p } }), 1);
  const lead = await prisma.campaignLead.findUnique({ where: { id: leadId } });
  assert.equal(lead?.optedOut, true);
});

test("booking intent appends the calendly link and sets state=booked", async () => {
  out.length = 0;
  const { hotelId, campaignId, phone: p } = await setup({ calendlyLink: "https://cal.com/riviera" });
  await handleInboundWhatsApp({ hotelId, fromPhone: p, body: "can you book me an appointment?", providerMessageId: "b1" }, deps("Of course!"));
  const lastOut = out[out.length - 1];
  assert.match(lastOut.msg, /cal\.com\/riviera/);
  const conv = await prisma.whatsappConversation.findFirst({ where: { campaignId } });
  assert.equal(conv?.state, "booked");
});
