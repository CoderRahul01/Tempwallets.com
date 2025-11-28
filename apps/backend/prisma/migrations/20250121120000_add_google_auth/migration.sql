-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "googleId" TEXT,
ADD COLUMN "fingerprint" TEXT,
ADD COLUMN "name" TEXT,
ADD COLUMN "picture" TEXT,
ADD COLUMN "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId") WHERE "googleId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_fingerprint_key" ON "User"("fingerprint") WHERE "fingerprint" IS NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_googleId_idx" ON "User"("googleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_fingerprint_idx" ON "User"("fingerprint");

