-- CreateTable
CREATE TABLE "payment_channel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "payment_channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lightning_node" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appSessionId" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 10,
    "quorum" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'NitroRPC/0.4',
    "challenge" INTEGER NOT NULL DEFAULT 3600,
    "sessionData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "lightning_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lightning_node_participant" (
    "id" TEXT NOT NULL,
    "lightningNodeId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "balance" TEXT NOT NULL DEFAULT '0',
    "asset" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "lightning_node_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lightning_node_transaction" (
    "id" TEXT NOT NULL,
    "lightningNodeId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "intent" TEXT,
    "txHash" TEXT,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lightning_node_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_channel_channelId_key" ON "payment_channel"("channelId");

-- CreateIndex
CREATE INDEX "payment_channel_userId_idx" ON "payment_channel"("userId");

-- CreateIndex
CREATE INDEX "payment_channel_channelId_idx" ON "payment_channel"("channelId");

-- CreateIndex
CREATE INDEX "payment_channel_status_idx" ON "payment_channel"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_channel_userId_chainId_key" ON "payment_channel"("userId", "chainId");

-- CreateIndex
CREATE UNIQUE INDEX "lightning_node_appSessionId_key" ON "lightning_node"("appSessionId");

-- CreateIndex
CREATE INDEX "lightning_node_userId_idx" ON "lightning_node"("userId");

-- CreateIndex
CREATE INDEX "lightning_node_appSessionId_idx" ON "lightning_node"("appSessionId");

-- CreateIndex
CREATE INDEX "lightning_node_status_idx" ON "lightning_node"("status");

-- CreateIndex
CREATE INDEX "lightning_node_createdAt_idx" ON "lightning_node"("createdAt");

-- CreateIndex
CREATE INDEX "lightning_node_participant_lightningNodeId_idx" ON "lightning_node_participant"("lightningNodeId");

-- CreateIndex
CREATE INDEX "lightning_node_participant_address_idx" ON "lightning_node_participant"("address");

-- CreateIndex
CREATE UNIQUE INDEX "lightning_node_participant_lightningNodeId_address_asset_key" ON "lightning_node_participant"("lightningNodeId", "address", "asset");

-- CreateIndex
CREATE INDEX "lightning_node_transaction_lightningNodeId_idx" ON "lightning_node_transaction"("lightningNodeId");

-- CreateIndex
CREATE INDEX "lightning_node_transaction_from_idx" ON "lightning_node_transaction"("from");

-- CreateIndex
CREATE INDEX "lightning_node_transaction_to_idx" ON "lightning_node_transaction"("to");

-- CreateIndex
CREATE INDEX "lightning_node_transaction_type_idx" ON "lightning_node_transaction"("type");

-- CreateIndex
CREATE INDEX "lightning_node_transaction_status_idx" ON "lightning_node_transaction"("status");

-- CreateIndex
CREATE INDEX "lightning_node_transaction_createdAt_idx" ON "lightning_node_transaction"("createdAt");

-- AddForeignKey
ALTER TABLE "payment_channel" ADD CONSTRAINT "payment_channel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lightning_node" ADD CONSTRAINT "lightning_node_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lightning_node_participant" ADD CONSTRAINT "lightning_node_participant_lightningNodeId_fkey" FOREIGN KEY ("lightningNodeId") REFERENCES "lightning_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lightning_node_transaction" ADD CONSTRAINT "lightning_node_transaction_lightningNodeId_fkey" FOREIGN KEY ("lightningNodeId") REFERENCES "lightning_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
