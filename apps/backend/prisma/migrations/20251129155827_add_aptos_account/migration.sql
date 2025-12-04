-- CreateTable
CREATE TABLE "aptos_account" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 0,
    "network" TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet', 'devnet')),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aptos_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aptos_account_walletId_network_key" ON "aptos_account"("walletId", "network");

-- CreateIndex
CREATE UNIQUE INDEX "aptos_account_address_network_key" ON "aptos_account"("address", "network");

-- CreateIndex
CREATE INDEX "aptos_account_walletId_idx" ON "aptos_account"("walletId");

-- CreateIndex
CREATE INDEX "aptos_account_address_idx" ON "aptos_account"("address");

-- AddForeignKey
ALTER TABLE "aptos_account" ADD CONSTRAINT "aptos_account_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

