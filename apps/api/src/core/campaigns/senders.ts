// Channel sender registry (Phase 6.1).
//
// Each non-voice channel implements one small ChannelSender. The dispatcher is
// channel-agnostic: it resolves a sender by key and calls send(). Adding a new
// channel (e.g. SMS, push) is just registering another sender here — no changes
// to the worker. Variable rendering reuses the campaign {variable} system so
// templates behave identically across voice scripts, WhatsApp, and email.

import { renderTemplate, buildTemplateVars, resolveResendCredentials, sendFollowUpEmail } from "../email/resend";
import { sendWhatsAppTemplate } from "../connectors/whatsapp-outbound";

export interface SenderLead {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  jobTitle: string | null;
  rawData: string | null;
}

export interface SenderCampaign {
  name: string;
  calendlyLink: string | null;
  // whatsapp
  whatsappContentSid: string | null;
  whatsappTemplateBody: string | null;
  whatsappVariables: string[];
  // email
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
}

export interface SendContext {
  hotelId: string;
  campaign: SenderCampaign;
  lead: SenderLead;
  tenantName: string | null;
}

export interface SendResult {
  ok: boolean;
  providerId?: string;
  renderedSubject?: string;
  renderedBody?: string;
  error?: string;
}

export interface ChannelSender {
  channel: string;
  send(ctx: SendContext): Promise<SendResult>;
}

// Builds the dotted {variable} map for a lead in a campaign — shared by all senders.
export function contextVars(ctx: SendContext): Record<string, string> {
  return buildTemplateVars({
    lead: {
      firstName: ctx.lead.firstName, lastName: ctx.lead.lastName, company: ctx.lead.company,
      jobTitle: ctx.lead.jobTitle, email: ctx.lead.email, phone: ctx.lead.phone, rawData: ctx.lead.rawData,
    },
    campaign: { name: ctx.campaign.name, calendlyLink: ctx.campaign.calendlyLink },
    tenant: { name: ctx.tenantName },
    booking: { calendlyLink: ctx.campaign.calendlyLink },
  });
}

// Renders the ordered template variable expressions into Twilio ContentVariables
// ({ "1": "...", "2": "..." }). Pure + testable.
export function renderWhatsappContentVariables(
  variables: string[],
  vars: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  variables.forEach((expr, i) => { out[String(i + 1)] = renderTemplate(expr, vars); });
  return out;
}

const whatsappSender: ChannelSender = {
  channel: "whatsapp",
  async send(ctx) {
    if (!ctx.lead.phone) return { ok: false, error: "lead has no phone" };
    if (!ctx.campaign.whatsappContentSid) return { ok: false, error: "campaign has no whatsappContentSid" };
    const vars = contextVars(ctx);
    const contentVariables = renderWhatsappContentVariables(ctx.campaign.whatsappVariables, vars);
    const result = await sendWhatsAppTemplate(ctx.hotelId, ctx.lead.phone, ctx.campaign.whatsappContentSid, contentVariables);
    const renderedBody = ctx.campaign.whatsappTemplateBody ? renderTemplate(ctx.campaign.whatsappTemplateBody, vars) : JSON.stringify(contentVariables);
    return { ok: result.sent, providerId: result.id, renderedBody, error: result.error };
  },
};

const emailSender: ChannelSender = {
  channel: "email",
  async send(ctx) {
    if (!ctx.lead.email) return { ok: false, error: "lead has no email" };
    if (!ctx.campaign.emailSubjectTemplate || !ctx.campaign.emailBodyTemplate) {
      return { ok: false, error: "campaign has no email templates" };
    }
    const creds = await resolveResendCredentials(ctx.hotelId);
    const vars = contextVars(ctx);
    const result = await sendFollowUpEmail(creds, {
      to: ctx.lead.email,
      subjectTemplate: ctx.campaign.emailSubjectTemplate,
      htmlTemplate: ctx.campaign.emailBodyTemplate,
      vars,
    });
    return {
      ok: result.sent,
      providerId: result.id,
      renderedSubject: renderTemplate(ctx.campaign.emailSubjectTemplate, vars),
      renderedBody: renderTemplate(ctx.campaign.emailBodyTemplate, vars),
      error: result.error,
    };
  },
};

const REGISTRY: Record<string, ChannelSender> = {
  whatsapp: whatsappSender,
  email: emailSender,
};

export const MESSAGING_CHANNELS = Object.keys(REGISTRY);

export function getSender(channel: string): ChannelSender | null {
  return REGISTRY[channel] ?? null;
}
