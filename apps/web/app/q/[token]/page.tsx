import { getApiBaseUrl } from "../../../lib/api";
import { QuoteDecision } from "../../../components/ui/public-quote-decision";

export const dynamic = "force-dynamic";

interface PublicQuoteItem { piece: string; spec: string; amountPaise: number }
interface PublicQuote {
  number: string; title: string; status: string; validUntil: string | null;
  items: PublicQuoteItem[]; totalPaise: number; gstPercent: number; gstPaise: number;
  grandTotalPaise: number; terms: string | null; contactName: string | null;
}
interface PublicBrand { name: string; logoUrl: string | null; primaryColor: string; showPoweredBy: boolean; platformName: string }

const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: Math.round(paise) % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

// Public customer quote page (Phase 6): pre-auth, tenant-branded, reachable only
// via the unguessable link the tenant shared. Shows the customer-safe view and
// (while the quote is sent) Accept / Decline actions.
export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data: { ok: boolean; quote?: PublicQuote; brand?: PublicBrand } = { ok: false };
  try {
    const res = await fetch(`${getApiBaseUrl()}/public/quotes/${encodeURIComponent(token)}`, { cache: "no-store" });
    data = (await res.json()) as typeof data;
  } catch { /* fall through to not-found */ }

  if (!data.ok || !data.quote || !data.brand) {
    return (
      <main style={{ maxWidth: 640, margin: "48px auto", padding: 16, textAlign: "center" }}>
        <h1 style={{ fontSize: 22 }}>Quote not found</h1>
        <p style={{ color: "var(--text-muted)" }}>This link is invalid or no longer active. Please contact the sender for a fresh link.</p>
      </main>
    );
  }
  const { quote, brand } = data;

  return (
    <main style={{ maxWidth: 720, margin: "32px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: brand.primaryColor, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
          {brand.logoUrl
            ? <img src={brand.logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            : <span style={{ color: "#fff", fontWeight: 700 }}>{brand.name.charAt(0).toUpperCase()}</span>}
        </div>
        <span style={{ fontWeight: 700, fontSize: 20 }}>{brand.name}</span>
      </div>

      <section style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: 13 }}>{quote.number}</div>
            <h1 style={{ fontSize: 22, margin: "4px 0" }}>{quote.title}</h1>
            {quote.contactName && <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Prepared for {quote.contactName}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "var(--text-subtle)", textTransform: "uppercase" }}>Grand total</div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{rupees(quote.grandTotalPaise)}</div>
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
              <th style={{ padding: "8px 6px" }}>Item</th>
              <th style={{ padding: "8px 6px" }}>Specification</th>
              <th style={{ padding: "8px 6px", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((it, i) => (
              <tr key={i} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: "8px 6px", fontWeight: 500 }}>{it.piece}</td>
                <td style={{ padding: "8px 6px", color: "var(--text-muted)" }}>{it.spec}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{rupees(it.amountPaise)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid #cbd5e1" }}>
              <td colSpan={2} style={{ padding: "8px 6px", color: "var(--text-muted)" }}>Subtotal</td>
              <td style={{ padding: "8px 6px", textAlign: "right" }}>{rupees(quote.totalPaise)}</td>
            </tr>
            {quote.gstPercent > 0 && (
              <tr>
                <td colSpan={2} style={{ padding: "8px 6px", color: "var(--text-muted)" }}>GST @ {quote.gstPercent}%</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{rupees(quote.gstPaise)}</td>
              </tr>
            )}
            <tr style={{ borderTop: "1px solid #cbd5e1", fontWeight: 700 }}>
              <td colSpan={2} style={{ padding: "8px 6px" }}>Grand total</td>
              <td style={{ padding: "8px 6px", textAlign: "right" }}>{rupees(quote.grandTotalPaise)}</td>
            </tr>
          </tbody>
        </table>

        {quote.terms && <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12 }}><strong>Terms:</strong> {quote.terms}</p>}
        {quote.validUntil && quote.status === "sent" && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Valid until {new Date(quote.validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
        )}

        <QuoteDecision token={token} status={quote.status} primaryColor={brand.primaryColor} />
      </section>

      {brand.showPoweredBy && (
        <p style={{ textAlign: "center", color: "var(--text-subtle)", fontSize: 12, marginTop: 16 }}>Powered by {brand.platformName}</p>
      )}
    </main>
  );
}
