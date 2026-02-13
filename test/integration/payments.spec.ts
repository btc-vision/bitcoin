import { ECPairSigner, createNobleBackend } from '@btc-vision/ecpair';
import { describe, it } from 'vitest';
import type { Satoshi } from '../../src/index.js';
import * as bitcoin from '../../src/index.js';
import { fromHex } from '../../src/index.js';
import { regtestUtils } from './_regtest.js';
import * as fs from 'node:fs';
import type { Network } from '../../src/networks.js';

const backend = createNobleBackend();
const ECPair = {
    makeRandom: (opts?: { network?: Network }) =>
        ECPairSigner.makeRandom(backend, opts?.network ?? bitcoin.networks.bitcoin),
};
const NETWORK = regtestUtils.network;
const keyPairs = [ECPair.makeRandom({ network: NETWORK }), ECPair.makeRandom({ network: NETWORK })];

async function buildAndSign(
    depends: any,
    prevOutput: any,
    redeemScript: any,
    witnessScript: any,
): Promise<null> {
    const unspent = await regtestUtils.faucetComplex(Buffer.from(prevOutput), 5e4);
    const utx = await regtestUtils.fetch(unspent.txId);

    const psbt = new bitcoin.Psbt({ network: NETWORK })
        .addInput({
            hash: unspent.txId,
            index: unspent.vout,
            nonWitnessUtxo: fromHex(utx.txHex),
            ...(redeemScript ? { redeemScript } : {}),
            ...(witnessScript ? { witnessScript } : {}),
        })
        .addOutput({
            address: regtestUtils.RANDOM_ADDRESS,
            value: 20000n as Satoshi,
        });

    if (depends.signatures) {
        keyPairs.forEach((keyPair) => {
            psbt.signInput(0, keyPair);
        });
    } else if (depends.signature) {
        psbt.signInput(0, keyPairs[0]!);
    }

    return regtestUtils.broadcast(psbt.finalizeAllInputs().extractTransaction().toHex());
}

['p2ms', 'p2pk', 'p2pkh', 'p2wpkh'].forEach((k) => {
    const fixtures = JSON.parse(fs.readFileSync('test/fixtures/' + k + '.json', 'utf8'));
    const { depends } = fixtures.dynamic;
    const fn: any = (bitcoin.payments as any)[k];

    const base: any = {};
    if (depends.pubkey) base.pubkey = keyPairs[0]!.publicKey;
    if (depends.pubkeys) base.pubkeys = keyPairs.map((x) => x.publicKey);
    if (depends.m) base.m = base.pubkeys.length;

    const { output } = fn(base);
    if (!output) throw new TypeError('Missing output');

    describe('bitcoinjs-lib (payments - ' + k + ')', () => {
        it('can broadcast as an output, and be spent as an input', async () => {
            Object.assign(depends, { prevOutScriptType: k });
            await buildAndSign(depends, output, undefined, undefined);
        });

        it(
            'can (as P2SH(' + k + ')) broadcast as an output, and be spent as an input',
            async () => {
                const p2sh = bitcoin.payments.p2sh({
                    redeem: { output },
                    network: NETWORK,
                });
                Object.assign(depends, { prevOutScriptType: 'p2sh-' + k });
                await buildAndSign(depends, p2sh.output, p2sh.redeem!.output, undefined);
            },
        );

        // NOTE: P2WPKH cannot be wrapped in P2WSH, consensus fail
        if (k === 'p2wpkh') return;

        it(
            'can (as P2WSH(' + k + ')) broadcast as an output, and be spent as an input',
            async () => {
                const p2wsh = bitcoin.payments.p2wsh({
                    redeem: { output },
                    network: NETWORK,
                });
                Object.assign(depends, { prevOutScriptType: 'p2wsh-' + k });
                await buildAndSign(depends, p2wsh.output, undefined, p2wsh.redeem!.output);
            },
        );

        it(
            'can (as P2SH(P2WSH(' + k + '))) broadcast as an output, and be spent as an input',
            async () => {
                const p2wsh = bitcoin.payments.p2wsh({
                    redeem: { output },
                    network: NETWORK,
                });
                const p2sh = bitcoin.payments.p2sh({
                    redeem: { output: p2wsh.output },
                    network: NETWORK,
                });

                Object.assign(depends, {
                    prevOutScriptType: 'p2sh-p2wsh-' + k,
                });
                await buildAndSign(depends, p2sh.output, p2sh.redeem!.output, p2wsh.redeem!.output);
            },
        );
    });
});
