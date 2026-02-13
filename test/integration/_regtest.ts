import { RegtestUtils } from 'regtest-client';

const APIPASS = process.env['APIPASS'] || 'satoshi';
const APIURL = process.env['APIURL'] || 'https://regtest.bitbank.cc/1';

export const regtestUtils = new RegtestUtils({ APIPASS, APIURL });

/**
 * Broadcast with retry logic.
 * The regtest node sometimes returns Bad Request when the faucet
 * transaction hasn't fully propagated yet (race with indexer).
 */
export async function broadcastAndVerify(
    txHex: string,
    verify: () => Promise<void>,
    maxRetries: number = 3,
): Promise<void> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            await regtestUtils.broadcast(txHex);
            await verify();
            return;
        } catch (err: unknown) {
            if (attempt === maxRetries - 1) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            if (msg !== 'Bad Request') throw err;
            console.log(`Bad Request, retry #${attempt + 1}`);
            await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }
    }
}
