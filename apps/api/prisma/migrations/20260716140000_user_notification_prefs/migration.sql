-- Per-user notification preferences (JSON) governing which alert categories show
-- in the top-bar bell. NULL = all enabled.
ALTER TABLE "User" ADD COLUMN "notificationPrefs" TEXT;
