import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { processCampaignChannel } from "./dispatch";
import type { ChannelSender } from "./senders";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

// Fake sender records every send and always succeeds — lets us exercise the
// dispatcher with no Twilio/Resend keys.
const sent: string[] = [];
const fakeSender = (channel: string): ChannelSender => ({
  channel,
  async send(ctx) { sent.push(ctx.lead.phone ?? ""); return { ok: true, providerId: "msg", renderedBody: "hi" }; },
});
const deps = { resolveSender: (c: string) => fakeSender(c), batchSize: 100 };

// Flaky sender whose outcome is flipped per-test via `sendOutcome` — lets us
// exercise the failed-send retry path deterministically with no provider keys.
let sendOutcome: "ok" | "fail" = "ok";
const flakySender = (channel: string): ChannelSender => ({
  channel,
  async send() {
    return sendOutcome === "ok" ? { ok: true, providerId: "msg", renderedBody: "hi" } : { ok: false, error: "provider_503" };
  },
});
const flakyDeps = { resolveSender: (c: string) => flakySender(c), batchSize: 100 };

// Backdate every delivery on a channel so its last attempt falls outside the
// retry backoff window (simulates the passage of retryDelayHours).
const ageOut = (campaignId: string, channel: string, hours = 48) =>
  prisma.messageDelivery.updateMany({ where: { campaignId, channel }, data: { createdAt: new Date(Date.now() - hours * 3_600_000) } });

async function makeCampaign(opts: { spendCapCalls?: number; maxRetries?: number; retryDelayHours?: number } = {}) {
  const hotelId = "disp-" + uid();
  await prisma.hotel.create({ data: { id: hotelId, name: "Disp " + hotelId.slice(-4), timezone: "Asia/Kolkata" } });
  const campaign = await prisma.voiceCampaign.create({
    data: {
      hotelId, name: "WA", status: "active", channels: JSON.stringify(["whatsapp"]),
      whatsappContentSid: "HXtest", whatsappVariables: JSON.stringify(["{lead.firstName}"]),
      spendCapCalls: opts.spendCapCalls ?? null,
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
      ...(opts.retryDelayHours !== undefined ? { retryDelayHours: opts.retryDelayHours } : {}),
    },
  });
  return { hotelId, campaignId: campaign.id };
}

const addLead = (campaignId: string, hotelId: string, phone: string, over: Record<string, unknown> = {}) =>
  prisma.campaignLead.create({
    data: { campaignId, hotelId, firstName: "L", phone, consent: true, consentSource: "csv_import", consentAt: new Date(), ...over },
  });

after(async () => { await prisma.$disconnect(); });

test("dispatch sends to consented leads and is idempotent across ticks", async () => {
  sent.length = 0;
  const { hotelId, campaignId } = await makeCampaign();
  await addLead(campaignId, hotelId, "+1415555" + uid().slice(0, 4));
  await addLead(campaignId, hotelId, "+1415556" + uid().slice(0, 4));

  const first = await processCampaignChannel(campaignId, "whatsapp", deps);
  assert.equal(first.sent, 2);
  assert.equal(await prisma.messageDelivery.count({ where: { campaignId, status: "sent" } }), 2);

  // Second tick: both leads already have a delivery row → nothing re-sent.
  const second = await processCampaignChannel(campaignId, "whatsapp", deps);
  assert.equal(second.sent, 0);
});

test("dispatch skips leads that fail the pre-send guard (no consent / suppressed)", async () => {
  const { hotelId, campaignId } = await makeCampaign();
  await addLead(campaignId, hotelId, "+1415557" + uid().slice(0, 4), { consent: false }); // no consent
  const suppPhone = "+1415558" + uid().slice(0, 4);
  await addLead(campaignId, hotelId, suppPhone, { consent: true });
  await prisma.doNotContact.create({ data: { hotelId, phone: suppPhone, reason: "opt_out" } });

  const r = await processCampaignChannel(campaignId, "whatsapp", deps);
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 2);
  const reasons = (await prisma.messageDelivery.findMany({ where: { campaignId }, select: { error: true } })).map((d) => d.error).sort();
  assert.deepEqual(reasons, ["no_consent", "suppressed"]);
});

test("dispatch enforces the spend cap and auto-pauses the campaign", async () => {
  const { hotelId, campaignId } = await makeCampaign({ spendCapCalls: 1 });
  await addLead(campaignId, hotelId, "+1415559" + uid().slice(0, 4));
  await addLead(campaignId, hotelId, "+1415560" + uid().slice(0, 4));

  const r1 = await processCampaignChannel(campaignId, "whatsapp", deps);
  assert.equal(r1.sent, 1); // capped to remaining budget

  const r2 = await processCampaignChannel(campaignId, "whatsapp", deps);
  assert.equal(r2.sent, 0); // cap reached → no more
  const after = await prisma.voiceCampaign.findUnique({ where: { id: campaignId }, select: { status: true } });
  assert.equal(after?.status, "paused");
});

test("dispatch retries a failed send only after the backoff window, then stops once sent", async () => {
  const { hotelId, campaignId } = await makeCampaign({ maxRetries: 2, retryDelayHours: 24 });
  const lead = await addLead(campaignId, hotelId, "+1415561" + uid().slice(0, 4));

  // Attempt 1 fails → one "failed" delivery, no success.
  sendOutcome = "fail";
  const r1 = await processCampaignChannel(campaignId, "whatsapp", flakyDeps);
  assert.equal(r1.failed, 1);
  assert.equal(await prisma.messageDelivery.count({ where: { leadId: lead.id, status: "failed" } }), 1);

  // Still inside the backoff window → not retried even though the sender now succeeds.
  sendOutcome = "ok";
  const within = await processCampaignChannel(campaignId, "whatsapp", flakyDeps);
  assert.equal(within.sent, 0);

  // Age the failure past retryDelayHours → now due → retried and succeeds.
  await ageOut(campaignId, "whatsapp");
  const retried = await processCampaignChannel(campaignId, "whatsapp", flakyDeps);
  assert.equal(retried.sent, 1);
  assert.equal(await prisma.messageDelivery.count({ where: { leadId: lead.id, status: "sent" } }), 1);

  // A successful delivery is terminal → no further attempts, even after ageing.
  await ageOut(campaignId, "whatsapp");
  const done = await processCampaignChannel(campaignId, "whatsapp", flakyDeps);
  assert.equal(done.sent + done.failed, 0);
});

test("dispatch bounds retries by the campaign's maxRetries", async () => {
  const { hotelId, campaignId } = await makeCampaign({ maxRetries: 1, retryDelayHours: 24 });
  const lead = await addLead(campaignId, hotelId, "+1415562" + uid().slice(0, 4));
  sendOutcome = "fail";

  // Initial attempt (1 failure).
  await processCampaignChannel(campaignId, "whatsapp", flakyDeps);
  await ageOut(campaignId, "whatsapp");
  // Retry #1 allowed (failedCount 1 ≤ maxRetries 1) → 2 failures total.
  const retry = await processCampaignChannel(campaignId, "whatsapp", flakyDeps);
  assert.equal(retry.failed, 1);
  assert.equal(await prisma.messageDelivery.count({ where: { leadId: lead.id, status: "failed" } }), 2);

  // No more retries (failedCount 2 > maxRetries 1), even after ageing.
  await ageOut(campaignId, "whatsapp");
  const exhausted = await processCampaignChannel(campaignId, "whatsapp", flakyDeps);
  assert.equal(exhausted.sent + exhausted.failed, 0);
});

test("dispatch never retries a compliance 'skipped' delivery", async () => {
  const { hotelId, campaignId } = await makeCampaign({ maxRetries: 3, retryDelayHours: 1 });
  await addLead(campaignId, hotelId, "+1415563" + uid().slice(0, 4), { consent: false }); // guard will skip

  const r1 = await processCampaignChannel(campaignId, "whatsapp", flakyDeps);
  assert.equal(r1.skipped, 1);

  // Even aged well past the window, a skip is permanent — not retried, not re-skipped.
  await ageOut(campaignId, "whatsapp");
  const r2 = await processCampaignChannel(campaignId, "whatsapp", flakyDeps);
  assert.equal(r2.sent + r2.failed + r2.skipped, 0);
  assert.equal(await prisma.messageDelivery.count({ where: { campaignId } }), 1);
});
