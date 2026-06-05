import { redirect } from "next/navigation";

// E-2: "Upsell Campaigns" merged into the single Campaigns surface under Marketing.
// The old route is kept as a permanent redirect so existing links keep working.
export default function UpsellCampaignsRedirect() {
  redirect("/campaigns");
}
