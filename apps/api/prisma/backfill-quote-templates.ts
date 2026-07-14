import "dotenv/config";
import { backfillIndustryDefaults } from "../src/core/quotes/provision";
import { prisma } from "../src/db/prisma";

// One-shot backfill: provision the industry quote-template starter kit for every
// existing tenant that has none yet (created before auto-provisioning shipped). Safe
// to run against any environment — idempotent and non-destructive (tenants that
// already have templates are skipped). The API also runs this automatically on boot;
// use this script to populate a live DB immediately without waiting for a redeploy.
//
//   DATABASE_URL=... npm run db:backfill:quote-templates -w @eynis/api

async function main() {
  const n = await backfillIndustryDefaults();
  console.log(n ? `Provisioned quote templates for ${n} existing tenant(s).` : "All tenants already have quote templates — nothing to do.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
