import { fetchTemplates } from "../../lib/data";
import { TemplatesClient } from "../../components/ui/templates-client";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  let templates: Awaited<ReturnType<typeof fetchTemplates>>["items"] = [];
  try {
    const r = await fetchTemplates();
    if (r.ok) templates = r.items;
  } catch { /* render empty state */ }
  return <TemplatesClient initialTemplates={templates} />;
}
