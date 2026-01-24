const ZERION_API_KEY = 'zk_prod_667044ac20124ee7a04b290f8651dcd5';
const ADDRESSES = [
    '0xD20816FD76e3de1f564418b0db7501BE75F4Ec9F', // From backend logs
    '0x34bDB3982002166F31f24dD38D92B980c6A2A04a'  // From browser subagent screenshot
];

async function checkZerion(address, chain = '') {
    const queryParams = new URLSearchParams({
        'filter[trash]': 'only_non_trash',
        'page[size]': '10',
    });
    if (chain) {
        queryParams.append('filter[chain_id]', chain);
    }
    const url = `https://api.zerion.io/v1/wallets/${address}/transactions/?${queryParams.toString()}`;
    console.log(`[Diagnostic] Fetching: ${url}`);

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            accept: 'application/json',
            authorization: `Basic ${Buffer.from(ZERION_API_KEY + ':').toString('base64')}`,
        },
    });

    if (!response.ok) {
        console.error(`[Diagnostic] Error ${response.status}: ${await response.text()}`);
        return null;
    }

    const json = await response.json();
    return json.data || [];
}

async function main() {
    for (const addr of ADDRESSES) {
        console.log(`\n--- Checking Address: ${addr} ---`);
        const txs = await checkZerion(addr);
        console.log(`[Diagnostic] Zerion returned ${txs?.length} transactions`);
        if (txs?.length > 0) {
            console.log('  -> [DEBUG] Full Attributes of first TX:');
            console.log(JSON.stringify(txs[0].attributes, null, 2));
            txs.forEach((tx, i) => {
                console.log(`  ${i + 1}. Hash: ${tx.attributes.hash}, Chain: ${tx.relationships.chain.data.id}, Value: ${tx.attributes.value}`);
            });
        } else {
            console.log('  -> No transactions found on any chain.');
        }
    }
}

main().catch(console.error);
