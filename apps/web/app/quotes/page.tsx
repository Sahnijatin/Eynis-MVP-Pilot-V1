import { fetchQuotes, fetchQuoteTemplates, fetchInventory } from "../../lib/data";
import { QuotesClient } from "../../components/ui/quotes-client";

export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  const [quotes, templates, inventory] = await Promise.all([
    fetchQuotes(),
    fetchQuoteTemplates(),
    fetchInventory().catch(() => ({ ok: false, items: [] })),
  ]);
  return (
    <QuotesClient
      initialQuotes={quotes.items ?? []}
      templates={templates.items ?? []}
      inventory={inventory.items ?? []}
    />
  );
}
