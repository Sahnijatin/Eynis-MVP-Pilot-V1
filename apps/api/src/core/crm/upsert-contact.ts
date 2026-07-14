import { prisma } from "../../db/prisma";

// Find-or-create a Contact by phone within a tenant. The (tenantId, phoneE164)
// unique index (H7) makes the create race-safe at the DB level; callers pass an
// already-normalised E.164 phone. Extracted from server.ts (5.1) so the quotes
// router and the intake/webhook handlers share one implementation.
export const upsertContactByPhone = async (tenantId: string, fullName: string, phoneE164: string) => {
  const existing = await prisma.contact.findFirst({
    where: { tenantId, phoneE164 },
    select: { id: true }
  });
  if (existing) {
    return existing.id;
  }
  const guest = await prisma.contact.create({
    data: { tenantId, fullName, phoneE164 },
    select: { id: true }
  });
  return guest.id;
};
