import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __eynisPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__eynisPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  global.__eynisPrisma = prisma;
}
