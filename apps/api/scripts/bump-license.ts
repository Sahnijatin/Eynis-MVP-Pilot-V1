import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Idempotently set a tenant's license plan (e.g. bump the demo tenant to Growth so
 * the `advanced_analytics` / `ai_features` / `automations` / `night_audit` gated
 * pages are available). Safe to re-run.
 *
 * Usage:
 *   tsx scripts/bump-license.ts "<tenant id or name>" [plan] [maxSeats]
 *
 * Examples:
 *   tsx scripts/bump-license.ts "Crowne Plaza"          # → growth, 25 seats
 *   tsx scripts/bump-license.ts "Crowne Plaza" enterprise 100
 *   tsx scripts/bump-license.ts eynis-riviera-1 growth 25
 *
 * Tenant is resolved by exact id, then exact (case-insensitive) name, then a
 * unique partial name match. Defaults: tenant=$EYNIS_DEMO_HOTEL_ID, plan=growth.
 */
async function resolveTenant(target: string): Promise<{ id: string; name: string }> {
  const byId = await prisma.tenant.findUnique({ where: { id: target }, select: { id: true, name: true } });
  if (byId) return byId;

  const exact = await prisma.tenant.findMany({
    where: { name: { equals: target, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`Ambiguous name "${target}": ${exact.map((t) => `${t.name} (${t.id})`).join(", ")}`);

  const partial = await prisma.tenant.findMany({
    where: { name: { contains: target, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`Ambiguous "${target}": ${partial.map((t) => `${t.name} (${t.id})`).join(", ")}`);
  throw new Error(`No tenant found matching "${target}".`);
}

async function main() {
  const [targetArg, planArg, seatsArg] = process.argv.slice(2);
  const target = targetArg ?? process.env.EYNIS_DEMO_HOTEL_ID ?? "eynis-riviera-1";
  const plan = planArg ?? "growth";
  const maxSeats = seatsArg ? Number(seatsArg) : 25;

  const tenant = await resolveTenant(target);
  const license = await prisma.license.upsert({
    where: { tenantId: tenant.id },
    update: { plan, maxSeats },
    create: {
      tenantId: tenant.id,
      plan,
      maxSeats,
      renewsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  console.log(`✅ ${tenant.name} (${tenant.id}) → plan="${license.plan}", maxSeats=${license.maxSeats}`);
}

main()
  .catch((err) => {
    console.error("❌", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
