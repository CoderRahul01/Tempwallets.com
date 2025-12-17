-- Add invite-only + presence tracking to lightning_node_participant

ALTER TABLE "lightning_node_participant"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'invited',
  ADD COLUMN "lastSeenAt" TIMESTAMP(3),
  ALTER COLUMN "joinedAt" DROP NOT NULL,
  ALTER COLUMN "joinedAt" DROP DEFAULT;

-- Optional: index to query presence/online users efficiently
CREATE INDEX IF NOT EXISTS "lightning_node_participant_lastSeenAt_idx" ON "lightning_node_participant"("lastSeenAt");

-- Optional: index for filtering invited/joined
CREATE INDEX IF NOT EXISTS "lightning_node_participant_status_idx" ON "lightning_node_participant"("status");
