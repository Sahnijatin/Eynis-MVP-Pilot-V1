// Campaign demo seed (Phase 8, 8.4): a deterministic outbound campaign for the
// Tempus demo tenant so the campaign analytics surfaces (variants funnel, calls,
// deliveries, sentiment) demo well WITHOUT live provider keys. Idempotent: the
// campaign is rebuilt from scratch on every run. Run after seed-tempus:
//   npm run db:seed:campaign -w @eynis/api

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_ID = "eynis-tempus-1";
const CAMPAIGN_NAME = "Re-engage dormant clients (demo)";

const LEADS = [
  { firstName: "Ravi", lastName: "Kumar", phone: "+919812345001", email: "ravi@kapoorfurnishings.example", company: "Kapoor Furnishings", ab: "A", outcome: "meeting_booked", sentiment: "positive", duration: 212 },
  { firstName: "Meera", lastName: "Iyer", phone: "+919812345002", email: "meera@sharmainteriors.example", company: "Sharma Interiors", ab: "B", outcome: "interested", sentiment: "positive", duration: 187 },
  { firstName: "Arjun", lastName: "Mehta", phone: "+919812345003", email: "arjun@mehtaresidences.example", company: "Mehta Residences", ab: "A", outcome: "callback_requested", sentiment: "neutral", duration: 95 },
  { firstName: "Sunita", lastName: "Gupta", phone: "+919812345004", email: "sunita@guptahomes.example", company: "Gupta Homes", ab: "B", outcome: "not_interested", sentiment: "negative", duration: 64 },
  { firstName: "Vikram", lastName: "Joshi", phone: "+919812345005", email: "vikram@joshico.example", company: "Joshi & Co", ab: "A", outcome: "interested", sentiment: "positive", duration: 240 },
  { firstName: "Anita", lastName: "Rao", phone: "+919812345006", email: "anita@raoprojects.example", company: "Rao Projects", ab: "B", outcome: "meeting_booked", sentiment: "positive", duration: 198 },
  { firstName: "Karan", lastName: "Shah", phone: "+919812345007", email: "karan@shahestates.example", company: "Shah Estates", ab: "A", outcome: "no_answer", sentiment: null, duration: 0 },
  { firstName: "Priya", lastName: "Nair", phone: "+919812345008", email: "priya@nairdesign.example", company: "Nair Design", ab: "B", outcome: "interested", sentiment: "neutral", duration: 152 },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID }, select: { id: true } });
  if (!tenant) {
    console.error(`Tenant ${TENANT_ID} not found — run db:seed:tempus first.`);
    process.exit(1);
  }

  // Rebuild from scratch so the seed is repeatable.
  await prisma.voiceCampaign.deleteMany({ where: { tenantId: TENANT_ID, name: CAMPAIGN_NAME } });

  const campaign = await prisma.voiceCampaign.create({
    data: {
      tenantId: TENANT_ID,
      name: CAMPAIGN_NAME,
      status: "active",
      channels: JSON.stringify(["voice", "whatsapp", "email"]),
      scriptTemplate: "Hi {lead.firstName}, this is {campaign.agentName} from Tempus Furniture — we refreshed our modular range and thought of {lead.company}.",
      agentName: "Aisha",
      outcomeTypes: JSON.stringify(["meeting_booked", "interested", "callback_requested", "not_interested", "no_answer"]),
      followUpRules: JSON.stringify({ interested: "whatsapp", meeting_booked: "email" }),
      emailSubjectTemplate: "New modular range for {lead.company}",
      emailBodyTemplate: "Hi {lead.firstName},\n\nWe have launched a refreshed modular range — sharing the lookbook. Reply and we'll bring samples over.\n\n— Tempus Furniture",
      whatsappTemplateBody: "Hi {lead.firstName}! Tempus Furniture here — our new modular range just launched. Want the lookbook?",
      whatsappVariables: JSON.stringify(["lead.firstName"]),
      variants: {
        create: [
          { tenantId: TENANT_ID, key: "A", label: "Warm intro", voice: "aisha", persona: "Consultative", weight: 50, sortOrder: 0 },
          { tenantId: TENANT_ID, key: "B", label: "Offer-led", voice: "dev", persona: "Direct", weight: 50, sortOrder: 1 },
        ],
      },
    },
    include: { variants: true },
  });

  const dayMs = 24 * 3600_000;
  let i = 0;
  for (const l of LEADS) {
    i++;
    const createdAt = new Date(Date.now() - (10 - i) * dayMs);
    const lead = await prisma.campaignLead.create({
      data: {
        tenantId: TENANT_ID, campaignId: campaign.id,
        firstName: l.firstName, lastName: l.lastName, phone: l.phone, email: l.email, company: l.company,
        consent: true, consentSource: "existing_customer", consentAt: createdAt,
        abVariant: l.ab, status: l.outcome === "no_answer" ? "called" : "completed",
        callAttempts: 1, createdAt,
      },
    });

    const call = await prisma.callRecord.create({
      data: {
        tenantId: TENANT_ID, campaignId: campaign.id, leadId: lead.id,
        abVariant: l.ab, status: "ended", outcome: l.outcome,
        durationSeconds: l.duration,
        transcript: l.duration > 0 ? `Agent: Hi ${l.firstName}, this is Aisha from Tempus Furniture…\n${l.firstName}: ${l.outcome === "not_interested" ? "Not right now, thanks." : "Tell me more."}` : null,
        aiSummary: l.duration > 0 ? `${l.firstName} (${l.company}) — ${l.outcome.replace(/_/g, " ")}.` : null,
        keyPoints: JSON.stringify(l.duration > 0 ? [l.outcome.replace(/_/g, " "), `${l.company}`] : []),
        sentiment: l.sentiment,
        whatsappSent: l.outcome === "interested",
        emailSent: l.outcome === "meeting_booked",
        meetingBooked: l.outcome === "meeting_booked",
        startedAt: createdAt, endedAt: new Date(createdAt.getTime() + l.duration * 1000),
        createdAt,
      },
    });

    if (l.sentiment) {
      await prisma.sentimentEvent.create({
        data: {
          tenantId: TENANT_ID, callRecordId: call.id, speaker: "customer",
          text: l.outcome === "not_interested" ? "We're not looking at new vendors right now." : "That sounds interesting — send the details.",
          sentiment: l.sentiment, score: l.sentiment === "positive" ? 0.8 : l.sentiment === "negative" ? -0.6 : 0.1,
          createdAt,
        },
      });
    }

    if (l.outcome === "interested" || l.outcome === "meeting_booked") {
      const channel = l.outcome === "interested" ? "whatsapp" : "email";
      await prisma.messageDelivery.create({
        data: {
          tenantId: TENANT_ID, campaignId: campaign.id, leadId: lead.id, channel,
          status: "sent",
          renderedSubject: channel === "email" ? `New modular range for ${l.company}` : null,
          renderedBody: channel === "email"
            ? `Hi ${l.firstName},\n\nWe have launched a refreshed modular range — sharing the lookbook.`
            : `Hi ${l.firstName}! Tempus Furniture here — our new modular range just launched. Want the lookbook?`,
          sentAt: new Date(createdAt.getTime() + 3600_000), createdAt,
        },
      });
    }
  }

  console.log(`Seeded demo campaign "${CAMPAIGN_NAME}" for ${TENANT_ID}: ${LEADS.length} leads, calls, sentiment, deliveries.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
