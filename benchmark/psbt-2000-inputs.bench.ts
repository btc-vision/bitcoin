/**
 * PSBT 2000 Input Benchmark - Tests Taproot signing performance
 *
 * This benchmark measures the O(n^2) -> O(n) optimization for Taproot signing.
 *
 * Run with: npx tsx benchmark/psbt-2000-inputs.bench.ts
 */

import * as ecc from 'tiny-secp256k1';
import { randomBytes } from 'crypto';
import { BIP32Factory } from '@btc-vision/bip32';
import { initEccLib, Psbt, payments, crypto, Transaction } from '../src/index.js';
import { toXOnly } from '../src/pubkey.js';

// Initialize ECC library
initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

// Generate a test keypair for taproot key-path spending
function generateTaprootKeyPair() {
    const node = bip32.fromSeed(randomBytes(64));
    const xOnlyPubkey = toXOnly(node.publicKey);

    // Create tweaked signer for taproot key-path spending
    const tweakedNode = node.tweak(crypto.taggedHash('TapTweak', xOnlyPubkey));

    return {
        xOnlyPubkey,
        signer: tweakedNode,
    };
}

// Create a fake previous transaction for nonWitnessUtxo
function createFakePrevTx(outputScript: Uint8Array, value: bigint, index: number): Buffer {
    const tx = new Transaction();
    tx.version = 2;
    const inputHash = Buffer.alloc(32);
    inputHash.writeUInt32LE(index, 0);
    tx.addInput(inputHash, 0);
    tx.addOutput(outputScript, value);
    return tx.toBuffer();
}

async function runBenchmark(inputCount: number, iterations: number = 5) {
    console.log(`\n--- Benchmarking ${inputCount} P2TR inputs ---`);

    const keyPair = generateTaprootKeyPair();

    const { output } = payments.p2tr({
        internalPubkey: keyPair.xOnlyPubkey,
    });
    if (!output) throw new Error('Failed to create P2TR output');

    const inputValue = 10000n;
    const totalInput = inputValue * BigInt(inputCount);
    const fee = 1000n;
    const outputValue = (totalInput - fee) / 5n;

    console.log(`  Generating ${inputCount} fake previous transactions...`);
    const setupStart = performance.now();

    const prevTxs: Buffer[] = [];
    const txIds: Buffer[] = [];
    for (let i = 0; i < inputCount; i++) {
        const prevTx = createFakePrevTx(output, inputValue, i);
        prevTxs.push(prevTx);
        const hash1 = crypto.sha256(prevTx);
        const hash2 = crypto.sha256(hash1);
        const txId = Buffer.from(hash2).reverse();
        txIds.push(txId);
    }

    console.log(`  Setup done in ${((performance.now() - setupStart) / 1000).toFixed(2)}s`);

    // Warmup
    console.log('  Warming up...');
    {
        const psbt = new Psbt();
        for (let i = 0; i < Math.min(100, inputCount); i++) {
            psbt.addInput({
                hash: txIds[i],
                index: 0,
                nonWitnessUtxo: prevTxs[i],
                tapInternalKey: keyPair.xOnlyPubkey,
            });
        }
        for (let i = 0; i < 5; i++) {
            psbt.addOutput({ script: output, value: outputValue });
        }
        psbt.signAllInputs(keyPair.signer);
    }

    const times: number[] = [];

    for (let iter = 0; iter < iterations; iter++) {
        const psbt = new Psbt();

        for (let i = 0; i < inputCount; i++) {
            psbt.addInput({
                hash: txIds[i],
                index: 0,
                nonWitnessUtxo: prevTxs[i],
                tapInternalKey: keyPair.xOnlyPubkey,
            });
        }

        for (let i = 0; i < 5; i++) {
            psbt.addOutput({ script: output, value: outputValue });
        }

        const start = performance.now();
        psbt.signAllInputs(keyPair.signer);
        const elapsed = performance.now() - start;
        times.push(elapsed);

        console.log(`  Iteration ${iter + 1}: ${elapsed.toFixed(2)}ms`);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    console.log(`\n  Results for ${inputCount} inputs:`);
    console.log(`    Average: ${avg.toFixed(2)}ms`);
    console.log(`    Min: ${min.toFixed(2)}ms`);
    console.log(`    Max: ${max.toFixed(2)}ms`);
    console.log(`    Per-input: ${(avg / inputCount).toFixed(4)}ms`);

    return { inputCount, avg, min, max };
}

async function main() {
    console.log('='.repeat(70));
    console.log('  PSBT Taproot Signing Benchmark (prevOuts caching optimization)');
    console.log('='.repeat(70));

    const inputCounts = [100, 500, 1000, 2000];
    const results: Array<{ inputCount: number; avg: number; min: number; max: number }> = [];

    for (const count of inputCounts) {
        const result = await runBenchmark(count, 3);
        results.push(result);
    }

    console.log('\n' + '='.repeat(70));
    console.log('  SUMMARY');
    console.log('='.repeat(70));
    console.log('\n  Inputs | Avg (ms) | Min (ms) | Max (ms) | Per-input (ms)');
    console.log('  -------|----------|----------|----------|---------------');
    for (const r of results) {
        console.log(
            `  ${String(r.inputCount).padStart(6)} | ${r.avg.toFixed(2).padStart(8)} | ${r.min.toFixed(2).padStart(8)} | ${r.max.toFixed(2).padStart(8)} | ${(r.avg / r.inputCount).toFixed(4).padStart(13)}`,
        );
    }

    console.log('\n  Scaling Analysis:');
    if (results.length >= 2) {
        const first = results[0];
        const last = results[results.length - 1];
        const perInputFirst = first.avg / first.inputCount;
        const perInputLast = last.avg / last.inputCount;
        const ratio = perInputLast / perInputFirst;

        console.log(`    Per-input time at ${first.inputCount} inputs: ${perInputFirst.toFixed(4)}ms`);
        console.log(`    Per-input time at ${last.inputCount} inputs: ${perInputLast.toFixed(4)}ms`);
        console.log(`    Ratio: ${ratio.toFixed(2)}x`);

        if (ratio < 2) {
            console.log('    Result: O(n) scaling achieved!');
        } else {
            console.log('    Result: Scaling is worse than O(n).');
        }
    }

    console.log();
}

main().catch(console.error);
