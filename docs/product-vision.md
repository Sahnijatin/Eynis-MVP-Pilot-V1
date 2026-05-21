# Eynis — Hotel Intelligence OS

## The Problem

Hotels today run on 8–12 disconnected tools: a PMS, a POS, a WhatsApp inbox, a revenue management spreadsheet, a staff scheduling app, review monitoring software, and more. Data lives in silos. Managers make decisions from gut feel and yesterday's report. Insight is manual, reactive, and expensive.

No single platform unifies the signals. No AI brain interprets them.

## The Vision

Eynis is not another hotel management software. It is a **Hotel Intelligence OS** — a thin, connector-first layer that sits above every tool a hotel already uses, pulls their data into one unified stream, and uses Claude AI to turn raw events into proactive intelligence.

Hotels don't replace anything. They connect their existing systems to Eynis in minutes and immediately gain:

- A unified view of every guest interaction, request, and revenue signal
- AI-generated briefings, anomaly alerts, and upsell recommendations
- Automated workflows triggered by real-time data patterns

## Three Pillars

### 1. Connect Everything (Connectors)
Eynis supports pull-based and event-driven connectors for every major hotel system:

| Category | Examples |
|---|---|
| Messaging | WhatsApp (Twilio, Interakt), SMS |
| PMS | Cloudbeds, Opera, Mews |
| POS / F&B | Lightspeed, Oracle MICROS |
| Payments | Stripe, Razorpay |
| Reviews | TripAdvisor, Google, OTA feeds |

A continuous sync job normalizes events from each source into a shared schema (`ConnectorEvent`). New connectors can be added by the hotel team via the Settings UI — no engineering required.

### 2. One Unified Data Stream
All connector events flow into a single normalized store, indexed by hotel and guest. This creates:

- **Full guest history** across every touchpoint (messages, requests, stays, spend)
- **Operational live feed** showing what's happening right now across the property
- **Revenue signals** tracking every upsell attempt, outcome, and conversion

This data layer is what makes AI possible. Without it, an AI model has nothing meaningful to reason about.

### 3. Claude as the Intelligence Brain
Eynis uses Anthropic's Claude (`claude-opus-4-7` with adaptive thinking) as the reasoning layer over the unified data stream. Claude does not just answer questions — it proactively generates insights:

| Intelligence Feature | What Claude Does |
|---|---|
| Morning Briefing | Generates a daily executive summary: occupancy, open requests, high-value guests arriving, anomalies to watch |
| Inbound Classification | Classifies every WhatsApp/connector message into category, priority, sentiment, and routing decision |
| Guest Intelligence | Synthesizes a guest's full history into an arrival brief — preferences, flags, upsell opportunities |
| Revenue Insights | Analyzes occupancy, ADR, and conversion data to give specific, actionable revenue recommendations |
| Sentiment Analysis | Tracks guest satisfaction trends across interactions; alerts on deterioration patterns |

Every Claude call uses **prompt caching** on the stable system context (hotel profile, policies) to minimize cost across high-frequency calls.

## Business Model

Eynis sells to hotel operators (GMs, Revenue Managers, Owners) as a SaaS subscription:

- **Starter** — Single property, core connectors, AI briefings
- **Growth** — Multi-property, all connectors, full AI suite, automation builder
- **Enterprise** — White-label, custom connectors, dedicated onboarding

The moat is data network depth + AI reasoning quality. The longer a hotel uses Eynis, the smarter its recommendations become.

## What Eynis is NOT

- Not a PMS replacement — it reads PMS data, doesn't try to be one
- Not a chatbot — it reasons over hotel data, it doesn't just answer queries
- Not a BI tool — it generates decisions, not just dashboards

## Current State (May 2026)

The Eynis platform is production-ready for demo with:

- Full UI across 9 modules (Dashboard, Service Requests, Revenue Intelligence, Staff Performance, Guest Database, Automations, Sentiment Trends, Upsell Campaigns, Settings)
- Live API with 13 endpoints, JWT auth, multi-tenant isolation
- Seed demo hotel: "The Riviera" with full staff, guest, and operational data
- Connector registry with WhatsApp, PMS, POS, Payments support
- Persistent connector config per hotel

**In active development:** AI intelligence layer (Claude API integration, Day 19)
