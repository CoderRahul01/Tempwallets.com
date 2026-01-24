-- CreateTable
CREATE TABLE "blockchain_transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "value" TEXT NOT NULL,
    "tokenSymbol" TEXT,
    "tokenAddress" TEXT,
    "tokenDecimals" INTEGER NOT NULL DEFAULT 18,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "blockNumber" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'success',
    "type" TEXT NOT NULL DEFAULT 'transaction',
    "usdValue" DOUBLE PRECISION,
    "direction" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blockchain_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blockchain_transaction_userId_idx" ON "blockchain_transaction"("userId");

-- CreateIndex
CREATE INDEX "blockchain_transaction_userId_chain_idx" ON "blockchain_transaction"("userId", "chain");

-- CreateIndex
CREATE INDEX "blockchain_transaction_userId_timestamp_idx" ON "blockchain_transaction"("userId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_transaction_txHash_chain_key" ON "blockchain_transaction"("txHash", "chain");

-- AddForeignKey
ALTER TABLE "blockchain_transaction" ADD CONSTRAINT "blockchain_transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
