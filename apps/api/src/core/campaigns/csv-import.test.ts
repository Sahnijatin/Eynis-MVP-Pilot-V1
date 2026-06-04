import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { normalizeToE164, parseLeadsFromCsv, parseMultipart, type EynisLeadField } from "./csv-import";

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

test("normalizeToE164 rejects a leading zero after + (invalid country code, #4)", () => {
  assert.equal(normalizeToE164("+0123456789", "+91"), null);
  assert.equal(normalizeToE164("+09876543210", "+1"), null);
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

test("parseLeadsFromCsv tolerates space-padded headers + column-map keys (regression)", () => {
  // Exporters often emit ", Phone, " — the column map keys are padded but the
  // server must still match them after trimming (previously rejected as
  // 'missing or invalid phone').
  const csv = [
    "First Name, Mobile, Company, Opted In",
    "Sarah, 9876543210, Acme, yes",
  ].join("\n");
  const paddedMap: Record<string, EynisLeadField> = {
    "First Name": "firstName", " Mobile": "phone", " Company": "company", " Opted In": "consent",
  };
  const { leads, errors } = parseLeadsFromCsv(csv, { columnMap: paddedMap, defaultCountryCode: "+91" });
  assert.equal(errors.length, 0);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].phone, "+919876543210");
  assert.equal(leads[0].company, "Acme");
});

test("normalizeToE164 tolerates a space-padded country code", () => {
  assert.equal(normalizeToE164("9876543210", "+91 "), "+919876543210");
  assert.equal(normalizeToE164("9876543210", "91"), "+919876543210");
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

test("parseLeadsFromCsv: blank consent cell falls back to file-level defaultConsent (#6)", () => {
  const csv = ["First Name,Mobile,Opted In", "Sarah,9876543210,"].join("\n"); // blank consent cell
  const rejected = parseLeadsFromCsv(csv, { columnMap, defaultCountryCode: "+91" });
  assert.equal(rejected.leads.length, 0); // no attestation => rejected

  const accepted = parseLeadsFromCsv(csv, { columnMap, defaultCountryCode: "+91", defaultConsent: true, consentSource: "verbal" });
  assert.equal(accepted.leads.length, 1); // blank cell uses the file-level attestation
  assert.equal(accepted.leads[0].consent.consent, true);
});

// Build a minimal multipart/form-data request stream for parseMultipart.
function multipartRequest(fileContent: string): IncomingMessage {
  const boundary = "----testboundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="leads.csv"\r\n` +
    `Content-Type: text/csv\r\n\r\n` +
    `${fileContent}\r\n` +
    `--${boundary}--\r\n`;
  const req = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  return req;
}

test("parseMultipart rejects an oversized (truncated) upload instead of silently succeeding (#2)", async () => {
  const big = "x".repeat(5000);
  await assert.rejects(
    parseMultipart(multipartRequest(big), { maxFileBytes: 100 }),
    /exceeds.*limit/i,
  );
});

test("parseMultipart returns the file when within the size limit", async () => {
  const result = await parseMultipart(multipartRequest("a,b,c"), { maxFileBytes: 1000 });
  assert.equal(result.file?.content.toString(), "a,b,c");
});
