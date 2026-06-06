-- Multi-workspace membership: an email is unique within a tenant, not globally,
-- so one identity can belong to many workspaces (each with its own role).

-- DropIndex
DROP INDEX "User_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_hotelId_email_key" ON "User"("hotelId", "email");
