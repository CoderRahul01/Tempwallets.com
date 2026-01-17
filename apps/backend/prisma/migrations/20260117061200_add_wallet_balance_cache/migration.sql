-- CreateTable
CREATE TABLE "wallet_balance_cache" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "cachedBalances" JSONB NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_balance_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_balance_cache_fingerprint_idx" ON "wallet_balance_cache"("fingerprint");

-- CreateIndex
CREATE INDEX "wallet_balance_cache_chain_idx" ON "wallet_balance_cache"("chain");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_balance_cache_fingerprint_chain_key" ON "wallet_balance_cache"("fingerprint", "chain");
