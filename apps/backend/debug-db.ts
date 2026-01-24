
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Querying BlockchainTransaction table...');
    const txs = await prisma.blockchainTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10
    });

    if (txs.length === 0) {
        console.log('No transactions found in database.');
    } else {
        console.log(`Found ${txs.length} transactions:`);
        txs.forEach(tx => {
            console.log(`- [${tx.chain}] Hash: ${tx.txHash} | Status: ${tx.status} | Time: ${tx.timestamp}`);
        });
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
