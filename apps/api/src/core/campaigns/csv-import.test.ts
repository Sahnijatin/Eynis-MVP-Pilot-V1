import test from "node:test";
import assert from "node:assert/strict";
import { normalizeToE164, parseLeadsFromCsv, type EynisLeadField } from "./csv-import";

// ── E.164 normalisation ───────────────────────────────────────────────────────

test("normalizeToE164 handles +, 00, national, and trunk-zero forms", () => {
  assert.equal(normalizeToE164("+91 98765 43210", "+91"), "+919876543210");
  assert.equal(normalizeToE164("0098765432109", "+1"), "+98765432109");
  assert.equal(normalizeToE164("9876543210", "+91"), "+919876543210");
  assert.equal(normalizeToE164("098765 43210", "+91"), "+919876543210"); // drops trunk 0
  assert.equal(normalizeToE164("(415) 555-0100", "+1"), "+14155550100");
});

test("normalizeToE164 rejects junk and empties", () => {
  assert.equal(normalizeToE164("not-a-number", "+91"), null);
  assert.equal(normalizeToE164("12", "+91"), null); // too short
  assert.equal(normalizeToE164("", "+91"), null);
  assert.equal(normalizeToE164(null, "+91"), null);
});

// ── parseLeadsFromCsv ─────────────────────────────────────────────────────────

const columnMap: Record<string, EynisLeadField> = {
  "First Name": "firstName",
  "Mobile": "phone",
  "Company": "company",
  "Opted In": "consent",
};

test("parseLeadsFromCsv maps columns, normalises phone, and keeps custom fields in rawData", () => {
  const csv = [
    "First Name,Mobile,Company,Opted In,Tier",
    "Sarah,98765 43210,Acme,yes,gold",
  ].join("\n");
  const { leads, errors } = parseLeadsFromCsv(csv, { columnMap, defaultCountryCode: "+91" });
  assert.equal(errors.length, 0);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].firstName, "Sarah");
  assert.equal(leads[0].phone, "+919876543210");
  assert.equal(leads[0].company, "Acme");
  assert.equal(leads[0].consent.consent, true);
  // original columns (incl. unmapped "Tier") preserved for {lead.custom.*}
  assert.deepEqual(JSON.parse(leads[0].rawData).Tier, "gold");
});

test("parseLeadsFromCsv rejects non-consented rows", () => {
  const csv = ["First Name,Mobile,Opted In", "Sarah,9876543210,no"].join("\n");
  const { leads, errors } = parseLeadsFromCsv(csv, { columnMap, defaultCountryCode: "+91" });
  assert.equal(leads.length, 0);
  assert.equal(errors[0].reason, "no_consent");
});

test("parseLeadsFromCsv honours a file-level consent attestation when no consent column", () => {
  const map: Record<string, EynisLeadField> = { "First Name": "firstName", "Mobile": "phone" };
  const csv = ["First Name,Mobile", "Sarah,9876543210"].join("\n");
  const without = parseLeadsFromCsv(csv, { columnMap: map, defaultCountryCode: "+91" });
  assert.equal(without.leads.length, 0); // no consent => rejected
  assert.equal(without.errors[0].reason, "no_consent");

  const withAttestation = parseLeadsFromCsv(csv, { columnMap: map, defaultCountryCode: "+91", defaultConsent: true, consentSource: "verbal" });
  assert.equal(withAttestation.leads.length, 1);
  assert.equal(withAttestation.leads[0].consent.consentSource, "verbal");
});

test("parseLeadsFromCsv flags missing firstName and invalid phone", () => {
  const csv = [
    "First Name,Mobile,Opted In",
    ",9876543210,yes",      // missing firstName
    "Bob,xyz,yes",          // bad phone
  ].join("\n");
  const { leads, errors } = parseLeadsFromCsv(csv, { columnMap, defaultCountryCode: "+91" });
  assert.equal(leads.length, 0);
  assert.deepEqual(errors.map((e) => e.reason).sort(), ["missing firstName", "missing or invalid phone (need E.164)"].sort());
});
