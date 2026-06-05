import { redirect } from "next/navigation";

// CRM is a single module with sub-tabs (E-4). The module entry point opens the
// default tab; the four surfaces (Contacts, Companies, Deals, Tasks) share the
// CrmTabs header and keep their own deep-link routes.
export default function CrmIndexPage() {
  redirect("/contacts");
}
