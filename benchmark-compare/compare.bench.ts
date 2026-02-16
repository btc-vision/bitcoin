/**
 * Comprehensive benchmark comparing three Bitcoin transaction libraries:
 * - `@btc-vision/bitcoin` (this fork) with Noble and tiny-secp256k1 backends
 * - `bitcoinjs-lib` v7.0.1 (official)
 * - `@scure/btc-signer` (scure)
 *
 * @example
 * ```bash
 * cd benchmark-compare && npm run bench
 * cd benchmark-compare && npm run bench:gc    # with GC control
 * ```
 *
 * @remarks
 * Scenarios:
 * 1. Library Initialization (cold-start)
 * 2. PSBT Creation (varying input counts)
 * 3. P2WPKH Signing
 * 4. P2TR Taproot Signing
 * 5. End-to-End Lifecycle
 * 6. Parallel Signing (fork-only)
 */

import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    type BenchResult,
    type ComparisonRow,
    buildSummary,
    fmt,
    measure,
    printComparison,
    printForkOnly,
} from './harness.js';

import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import * as tinysecp from 'tiny-secp256k1';

import * as scureBtc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import {
    Psbt as ForkPsbt,
    initEccLib,
    payments as forkPayments,
    networks as forkNetworks,
    toXOnly,
    crypto as forkCrypto,
} from '../build/index.js';
import type { Satoshi, Script as ForkScript } from '../build/index.js';
import {
    createNobleBackend,
    createLegacyBackend,
    ECPairSigner,
} from '@btc-vision/ecpair';

/** Initializes the official bitcoinjs-lib ECC backend. */
function initOfficial(): void {
    bitcoin.initEccLib(tinysecp);
}

/** Initializes the fork ECC backend with Noble (pure JS). */
function initForkNoble(): void {
    initEccLib(createNobleBackend());
}

/** Initializes the fork ECC backend with tiny-secp256k1 (WASM). */
function initForkTiny(): void {
    initEccLib(createLegacyBackend(tinysecp));
}

/**
 * Deterministic seed shared across all libraries for fair comparison.
 * All key pairs are derived from this same 32-byte seed.
 */
const SEED = Buffer.from(
    'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35',
    'hex',
);

const officialECPair = ECPairFactory(tinysecp);
const officialKeyPair = officialECPair.fromPrivateKey(SEED);

const nobleBackend = createNobleBackend();
const forkNobleKeyPair = ECPairSigner.fromPrivateKey(nobleBackend, SEED);

const tinyBackend = createLegacyBackend(tinysecp);
const forkTinyKeyPair = ECPairSigner.fromPrivateKey(tinyBackend, SEED);

const scurePrivKey = new Uint8Array(SEED);
const scurePubKey = secp256k1.getPublicKey(scurePrivKey, true);
const scureXOnlyPubKey = scurePubKey.slice(1);

/**
 * Lazily-initialized tweaked signers for P2TR key-path spends.
 * Must be created after ECC init, so they're built on first access.
 */
let _forkNobleTweaked: ReturnType<typeof forkNobleKeyPair.tweak> | null = null;
let _forkTinyTweaked: ReturnType<typeof forkTinyKeyPair.tweak> | null = null;
let _officialTweaked: ReturnType<typeof officialKeyPair.tweak> | null = null;

/** @returns The fork Noble tweaked signer for Taproot key-path spends. */
function getForkNobleTweakedSigner() {
    if (!_forkNobleTweaked) {
        const xonly = toXOnly(forkNobleKeyPair.publicKey);
        _forkNobleTweaked = forkNobleKeyPair.tweak(forkCrypto.taggedHash('TapTweak', xonly));
    }
    return _forkNobleTweaked;
}

/** @returns The fork tiny-secp256k1 tweaked signer for Taproot key-path spends. */
function getForkTinyTweakedSigner() {
    if (!_forkTinyTweaked) {
        const xonly = toXOnly(forkTinyKeyPair.publicKey);
        _forkTinyTweaked = forkTinyKeyPair.tweak(forkCrypto.taggedHash('TapTweak', xonly));
    }
    return _forkTinyTweaked;
}

/** @returns The official tweaked signer for Taproot key-path spends. */
function getOfficialTweakedSigner() {
    if (!_officialTweaked) {
        const xonly = bitcoin.toXOnly(officialKeyPair.publicKey);
        _officialTweaked = officialKeyPair.tweak(bitcoin.crypto.taggedHash('TapTweak', xonly));
    }
    return _officialTweaked;
}

/** Builds a P2WPKH witness UTXO for the official library. */
function makeWitnessUtxoOfficial(pubkey: Uint8Array): { script: Uint8Array; value: bigint } {
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey });
    return {
        script: p2wpkh.output!,
        value: 100_000n,
    };
}

/** Builds a P2WPKH witness UTXO for the fork library. */
function makeWitnessUtxoFork(pubkey: Uint8Array): { script: Uint8Array; value: bigint } {
    const p2wpkh = forkPayments.p2wpkh({ pubkey });
    return {
        script: p2wpkh.output!,
        value: 100_000n,
    };
}

/** Builds a P2WPKH witness UTXO for `@scure/btc-signer`. */
function makeWitnessUtxoScure(pubkey: Uint8Array): { script: Uint8Array; amount: bigint } {
    const p2wpkh = scureBtc.p2wpkh(pubkey);
    return { script: p2wpkh.script, amount: 100_000n };
}

/** Builds a P2TR (Taproot) witness UTXO for the official library. */
function makeTaprootWitnessUtxoOfficial(pubkey: Uint8Array): { script: Uint8Array; value: bigint } {
    const xonly = bitcoin.toXOnly(pubkey);
    const p2tr = bitcoin.payments.p2tr({ internalPubkey: xonly });
    return {
        script: p2tr.output!,
        value: 100_000n,
    };
}

/** Builds a P2TR (Taproot) witness UTXO for the fork library. */
function makeTaprootWitnessUtxoFork(pubkey: Uint8Array): { script: Uint8Array; value: bigint } {
    const xonly = toXOnly(pubkey);
    const p2tr = forkPayments.p2tr({ internalPubkey: xonly });
    return {
        script: p2tr.output!,
        value: 100_000n,
    };
}

/** Builds a P2TR (Taproot) witness UTXO for `@scure/btc-signer`. */
function makeTaprootWitnessUtxoScure(xOnlyPubkey: Uint8Array): { script: Uint8Array; amount: bigint } {
    const p2tr = scureBtc.p2tr(xOnlyPubkey);
    return { script: p2tr.script, amount: 100_000n };
}

/** @returns A random 32-byte transaction hash for benchmark inputs. */
function randomTxHash(): Buffer {
    return randomBytes(32);
}

/**
 * Scenario 1: Measures cold-start initialization time for each library
 * by spawning isolated Node.js subprocesses per iteration.
 */
async function scenarioInit(): Promise<ComparisonRow[]> {
    console.log('\n--- Scenario 1: Library Initialization (cold-start) ---\n');

    const iterations = 5;

    /**
     * Spawns a subprocess to measure cold-start import + init time.
     * @param label - Display name for the result.
     * @param scriptBody - ESM script body to execute in a child process.
     */
    function measureColdStart(label: string, scriptBody: string): BenchResult {
        const scriptPath = join(__dirname, `_bench_init_${Date.now()}.mjs`);
        writeFileSync(scriptPath, scriptBody, 'utf-8');

        const times: number[] = [];
        for (let i = 0; i < iterations; i++) {
            try {
                const output = execSync(`node ${scriptPath}`, {
                    cwd: __dirname,
                    encoding: 'utf-8',
                    timeout: 15000,
                });
                const ms = parseFloat(output.trim().split('\n').pop()!);
                if (!isNaN(ms)) times.push(ms);
            } catch {
                // skip failed iterations
            }
        }

        try { unlinkSync(scriptPath); } catch { /* ignore */ }

        if (times.length === 0) {
            return { name: label, mean: NaN, median: NaN, min: NaN, max: NaN, p95: NaN, stddev: NaN, samples: 0 };
        }

        times.sort((a, b) => a - b);
        const sum = times.reduce((a, b) => a + b, 0);
        const mean = sum / times.length;
        const median = times[Math.floor(times.length / 2)]!;
        const min = times[0]!;
        const max = times[times.length - 1]!;
        const p95 = times[Math.floor(times.length * 0.95)]!;
        const variance = times.reduce((acc, t) => acc + (t - mean) ** 2, 0) / times.length;
        const stddev = Math.sqrt(variance);

        return { name: label, mean, median, min, max, p95, stddev, samples: times.length };
    }

    const forkNobleInit = measureColdStart(
        'Fork (Noble)',
        `const t0 = performance.now();
import { initEccLib } from '../build/index.js';
import { createNobleBackend } from '@btc-vision/ecpair';
initEccLib(createNobleBackend());
console.log((performance.now() - t0).toFixed(4));`,
    );
    console.log(`  Fork (Noble):          ${fmt(forkNobleInit.median)}`);

    const forkTinyInit = measureColdStart(
        'Fork (tiny-secp256k1)',
        `const t0 = performance.now();
import { initEccLib } from '../build/index.js';
import { createLegacyBackend } from '@btc-vision/ecpair';
import * as tinysecp from 'tiny-secp256k1';
initEccLib(createLegacyBackend(tinysecp));
console.log((performance.now() - t0).toFixed(4));`,
    );
    console.log(`  Fork (tiny-secp256k1): ${fmt(forkTinyInit.median)}`);

    const scureInit = measureColdStart(
        'Scure (btc-signer)',
        `const t0 = performance.now();
import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
const privKey = new Uint8Array(32).fill(1);
const pubKey = secp256k1.getPublicKey(privKey, true);
btc.p2wpkh(pubKey);
console.log((performance.now() - t0).toFixed(4));`,
    );
    console.log(`  Scure (btc-signer):   ${fmt(scureInit.median)}`);

    const officialInit = measureColdStart(
        'Official (tiny-secp256k1)',
        `const t0 = performance.now();
import * as bitcoin from 'bitcoinjs-lib';
import * as tinysecp from 'tiny-secp256k1';
import ECPairFactory from 'ecpair';
bitcoin.initEccLib(tinysecp);
ECPairFactory(tinysecp);
console.log((performance.now() - t0).toFixed(4));`,
    );
    console.log(`  Official (tiny-secp):  ${fmt(officialInit.median)}`);

    return [{
        scenario: 'Library Init',
        detail: 'cold-start',
        forkNoble: forkNobleInit,
        fork: forkTinyInit,
        scure: scureInit,
        official: officialInit,
    }];
}

/**
 * Scenario 2: Measures PSBT/transaction creation time (addInput + addOutput)
 * without signing, across varying input counts (10-500).
 */
async function scenarioPsbtCreation(): Promise<ComparisonRow[]> {
    console.log('\n--- Scenario 2: PSBT Creation ---\n');

    initOfficial();
    initForkNoble();

    const inputCounts = [10, 50, 100, 250, 500];
    const rows: ComparisonRow[] = [];

    for (const numInputs of inputCounts) {
        const iters = numInputs >= 500 ? 5 : numInputs >= 250 ? 10 : 30;
        const hashes = Array.from({ length: numInputs }, () => randomTxHash());

        const forkResult = await measure(
            `Fork PSBT ${numInputs}in`,
            () => {
                const witnessUtxo = makeWitnessUtxoFork(forkNobleKeyPair.publicKey);
                const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo: {
                            script: witnessUtxo.script as ForkScript,
                            value: witnessUtxo.value as Satoshi,
                        },
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script as ForkScript,
                        value: 10_000n as Satoshi,
                    });
                }
            },
            { iterations: iters },
        );

        const scureResult = await measure(
            `Scure Tx ${numInputs}in`,
            () => {
                const witnessUtxo = makeWitnessUtxoScure(scurePubKey);
                const tx = new scureBtc.Transaction();
                for (let i = 0; i < numInputs; i++) {
                    tx.addInput({
                        txid: hashes[i]!,
                        index: 0,
                        witnessUtxo: {
                            script: witnessUtxo.script,
                            amount: witnessUtxo.amount,
                        },
                    });
                }
                for (let j = 0; j < 5; j++) {
                    tx.addOutput({
                        script: witnessUtxo.script,
                        amount: 10_000n,
                    });
                }
            },
            { iterations: iters },
        );

        const officialResult = await measure(
            `Official PSBT ${numInputs}in`,
            () => {
                const witnessUtxo = makeWitnessUtxoOfficial(officialKeyPair.publicKey);
                const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo,
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script,
                        value: 10_000n,
                    });
                }
            },
            { iterations: iters },
        );

        console.log(
            `  ${String(numInputs).padStart(4)} inputs: Fork=${fmt(forkResult.median)}, Scure=${fmt(scureResult.median)}, Official=${fmt(officialResult.median)}`,
        );

        rows.push({
            scenario: 'PSBT Creation',
            detail: `${numInputs} inputs`,
            forkNoble: forkResult,
            fork: null,
            scure: scureResult,
            official: officialResult,
        });
    }

    return rows;
}

/**
 * Scenario 3: Measures P2WPKH (SegWit v0) transaction creation + signing
 * across varying input counts (10-500).
 */
async function scenarioP2wpkhSigning(): Promise<ComparisonRow[]> {
    console.log('\n--- Scenario 3: P2WPKH Signing ---\n');

    initOfficial();

    const inputCounts = [10, 50, 100, 250, 500];
    const rows: ComparisonRow[] = [];

    for (const numInputs of inputCounts) {
        const iters = numInputs >= 500 ? 5 : numInputs >= 250 ? 10 : 30;
        const hashes = Array.from({ length: numInputs }, () => randomTxHash());

        initForkNoble();
        const forkNobleResult = await measure(
            `Fork Noble P2WPKH ${numInputs}`,
            () => {
                const witnessUtxo = makeWitnessUtxoFork(forkNobleKeyPair.publicKey);
                const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo: {
                            script: witnessUtxo.script as ForkScript,
                            value: witnessUtxo.value as Satoshi,
                        },
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script as ForkScript,
                        value: 10_000n as Satoshi,
                    });
                }
                psbt.signAllInputs(forkNobleKeyPair);
            },
            { iterations: iters },
        );

        initForkTiny();
        const forkTinyResult = await measure(
            `Fork tiny P2WPKH ${numInputs}`,
            () => {
                const witnessUtxo = makeWitnessUtxoFork(forkTinyKeyPair.publicKey);
                const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo: {
                            script: witnessUtxo.script as ForkScript,
                            value: witnessUtxo.value as Satoshi,
                        },
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script as ForkScript,
                        value: 10_000n as Satoshi,
                    });
                }
                psbt.signAllInputs(forkTinyKeyPair);
            },
            { iterations: iters },
        );

        const scureResult = await measure(
            `Scure P2WPKH ${numInputs}`,
            () => {
                const witnessUtxo = makeWitnessUtxoScure(scurePubKey);
                const tx = new scureBtc.Transaction();
                for (let i = 0; i < numInputs; i++) {
                    tx.addInput({
                        txid: hashes[i]!,
                        index: 0,
                        witnessUtxo: {
                            script: witnessUtxo.script,
                            amount: witnessUtxo.amount,
                        },
                    });
                }
                for (let j = 0; j < 5; j++) {
                    tx.addOutput({
                        script: witnessUtxo.script,
                        amount: 10_000n,
                    });
                }
                tx.sign(scurePrivKey);
            },
            { iterations: iters },
        );

        initOfficial();
        const officialResult = await measure(
            `Official P2WPKH ${numInputs}`,
            () => {
                const witnessUtxo = makeWitnessUtxoOfficial(officialKeyPair.publicKey);
                const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo,
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script,
                        value: 10_000n,
                    });
                }
                psbt.signAllInputs(officialKeyPair);
            },
            { iterations: iters },
        );

        console.log(
            `  ${String(numInputs).padStart(4)} inputs: Noble=${fmt(forkNobleResult.median)}, tiny=${fmt(forkTinyResult.median)}, Scure=${fmt(scureResult.median)}, Official=${fmt(officialResult.median)}`,
        );

        rows.push({
            scenario: 'P2WPKH Signing',
            detail: `${numInputs} inputs`,
            forkNoble: forkNobleResult,
            fork: forkTinyResult,
            scure: scureResult,
            official: officialResult,
        });
    }

    return rows;
}

/**
 * Scenario 4: Measures P2TR Taproot (Schnorr, SegWit v1) transaction creation + signing
 * across varying input counts (10-500).
 */
async function scenarioP2trSigning(): Promise<ComparisonRow[]> {
    console.log('\n--- Scenario 4: P2TR Taproot Signing ---\n');

    const inputCounts = [10, 50, 100, 250, 500];
    const rows: ComparisonRow[] = [];

    for (const numInputs of inputCounts) {
        const iters = numInputs >= 500 ? 5 : numInputs >= 250 ? 10 : 30;
        const hashes = Array.from({ length: numInputs }, () => randomTxHash());

        initForkNoble();
        const nobleTweaked = getForkNobleTweakedSigner();
        const forkNobleXOnly = toXOnly(forkNobleKeyPair.publicKey);
        const forkNobleResult = await measure(
            `Fork Noble P2TR ${numInputs}`,
            () => {
                const witnessUtxo = makeTaprootWitnessUtxoFork(forkNobleKeyPair.publicKey);
                const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo: {
                            script: witnessUtxo.script as ForkScript,
                            value: witnessUtxo.value as Satoshi,
                        },
                        tapInternalKey: forkNobleXOnly,
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script as ForkScript,
                        value: 10_000n as Satoshi,
                    });
                }
                psbt.signAllInputs(nobleTweaked);
            },
            { iterations: iters },
        );

        initForkTiny();
        const tinyTweaked = getForkTinyTweakedSigner();
        const forkTinyXOnly = toXOnly(forkTinyKeyPair.publicKey);
        const forkTinyResult = await measure(
            `Fork tiny P2TR ${numInputs}`,
            () => {
                const witnessUtxo = makeTaprootWitnessUtxoFork(forkTinyKeyPair.publicKey);
                const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo: {
                            script: witnessUtxo.script as ForkScript,
                            value: witnessUtxo.value as Satoshi,
                        },
                        tapInternalKey: forkTinyXOnly,
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script as ForkScript,
                        value: 10_000n as Satoshi,
                    });
                }
                psbt.signAllInputs(tinyTweaked);
            },
            { iterations: iters },
        );

        const scureResult = await measure(
            `Scure P2TR ${numInputs}`,
            () => {
                const witnessUtxo = makeTaprootWitnessUtxoScure(scureXOnlyPubKey);
                const tx = new scureBtc.Transaction();
                for (let i = 0; i < numInputs; i++) {
                    tx.addInput({
                        txid: hashes[i]!,
                        index: 0,
                        witnessUtxo: {
                            script: witnessUtxo.script,
                            amount: witnessUtxo.amount,
                        },
                        tapInternalKey: scureXOnlyPubKey,
                    });
                }
                for (let j = 0; j < 5; j++) {
                    tx.addOutput({
                        script: witnessUtxo.script,
                        amount: 10_000n,
                    });
                }
                tx.sign(scurePrivKey);
            },
            { iterations: iters },
        );

        initOfficial();
        const officialTweaked = getOfficialTweakedSigner();
        const xonlyOfficial = bitcoin.toXOnly(officialKeyPair.publicKey);
        const officialResult = await measure(
            `Official P2TR ${numInputs}`,
            () => {
                const witnessUtxo = makeTaprootWitnessUtxoOfficial(officialKeyPair.publicKey);
                const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo,
                        tapInternalKey: xonlyOfficial,
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script,
                        value: 10_000n,
                    });
                }
                psbt.signAllInputs(officialTweaked);
            },
            { iterations: iters },
        );

        console.log(
            `  ${String(numInputs).padStart(4)} inputs: Noble=${fmt(forkNobleResult.median)}, tiny=${fmt(forkTinyResult.median)}, Scure=${fmt(scureResult.median)}, Official=${fmt(officialResult.median)}`,
        );

        rows.push({
            scenario: 'P2TR Signing',
            detail: `${numInputs} inputs`,
            forkNoble: forkNobleResult,
            fork: forkTinyResult,
            scure: scureResult,
            official: officialResult,
        });
    }

    return rows;
}

/**
 * Scenario 5: Measures the full end-to-end lifecycle with 100 inputs:
 * create PSBT/tx, add inputs/outputs, sign, finalize, extract, serialize to hex.
 * Tests both P2WPKH and P2TR for all libraries.
 */
async function scenarioEndToEnd(): Promise<ComparisonRow[]> {
    console.log('\n--- Scenario 5: End-to-End Lifecycle (100 inputs) ---\n');

    const numInputs = 100;
    const iters = 20;
    const hashes = Array.from({ length: numInputs }, () => randomTxHash());

    initForkNoble();
    const forkNobleE2E = await measure(
        'Fork Noble E2E P2WPKH',
        () => {
            const witnessUtxo = makeWitnessUtxoFork(forkNobleKeyPair.publicKey);
            const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
            for (let i = 0; i < numInputs; i++) {
                psbt.addInput({
                    hash: hashes[i]!,
                    index: 0,
                    witnessUtxo: {
                        script: witnessUtxo.script as ForkScript,
                        value: witnessUtxo.value as Satoshi,
                    },
                });
            }
            for (let j = 0; j < 5; j++) {
                psbt.addOutput({
                    script: witnessUtxo.script as ForkScript,
                    value: 10_000n as Satoshi,
                });
            }
            psbt.signAllInputs(forkNobleKeyPair);
            psbt.finalizeAllInputs();
            const tx = psbt.extractTransaction();
            tx.toHex();
        },
        { iterations: iters },
    );

    initForkTiny();
    const forkTinyE2E = await measure(
        'Fork tiny E2E P2WPKH',
        () => {
            const witnessUtxo = makeWitnessUtxoFork(forkTinyKeyPair.publicKey);
            const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
            for (let i = 0; i < numInputs; i++) {
                psbt.addInput({
                    hash: hashes[i]!,
                    index: 0,
                    witnessUtxo: {
                        script: witnessUtxo.script as ForkScript,
                        value: witnessUtxo.value as Satoshi,
                    },
                });
            }
            for (let j = 0; j < 5; j++) {
                psbt.addOutput({
                    script: witnessUtxo.script as ForkScript,
                    value: 10_000n as Satoshi,
                });
            }
            psbt.signAllInputs(forkTinyKeyPair);
            psbt.finalizeAllInputs();
            const tx = psbt.extractTransaction();
            tx.toHex();
        },
        { iterations: iters },
    );

    const scureE2E = await measure(
        'Scure E2E P2WPKH',
        () => {
            const witnessUtxo = makeWitnessUtxoScure(scurePubKey);
            const tx = new scureBtc.Transaction();
            for (let i = 0; i < numInputs; i++) {
                tx.addInput({
                    txid: hashes[i]!,
                    index: 0,
                    witnessUtxo: {
                        script: witnessUtxo.script,
                        amount: witnessUtxo.amount,
                    },
                });
            }
            for (let j = 0; j < 5; j++) {
                tx.addOutput({
                    script: witnessUtxo.script,
                    amount: 10_000n,
                });
            }
            tx.sign(scurePrivKey);
            tx.finalize();
            tx.hex;
        },
        { iterations: iters },
    );

    initOfficial();
    const officialE2E = await measure(
        'Official E2E P2WPKH',
        () => {
            const witnessUtxo = makeWitnessUtxoOfficial(officialKeyPair.publicKey);
            const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
            for (let i = 0; i < numInputs; i++) {
                psbt.addInput({
                    hash: hashes[i]!,
                    index: 0,
                    witnessUtxo,
                });
            }
            for (let j = 0; j < 5; j++) {
                psbt.addOutput({
                    script: witnessUtxo.script,
                    value: 10_000n,
                });
            }
            psbt.signAllInputs(officialKeyPair);
            psbt.finalizeAllInputs();
            const tx = psbt.extractTransaction();
            tx.toHex();
        },
        { iterations: iters },
    );

    console.log(`  P2WPKH 100in: Noble=${fmt(forkNobleE2E.median)}, tiny=${fmt(forkTinyE2E.median)}, Scure=${fmt(scureE2E.median)}, Official=${fmt(officialE2E.median)}`);

    initForkNoble();
    const e2eNobleTweaked = getForkNobleTweakedSigner();
    const e2eNobleXOnly = toXOnly(forkNobleKeyPair.publicKey);
    const forkNobleE2ETr = await measure(
        'Fork Noble E2E P2TR',
        () => {
            const witnessUtxo = makeTaprootWitnessUtxoFork(forkNobleKeyPair.publicKey);
            const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
            for (let i = 0; i < numInputs; i++) {
                psbt.addInput({
                    hash: hashes[i]!,
                    index: 0,
                    witnessUtxo: {
                        script: witnessUtxo.script as ForkScript,
                        value: witnessUtxo.value as Satoshi,
                    },
                    tapInternalKey: e2eNobleXOnly,
                });
            }
            for (let j = 0; j < 5; j++) {
                psbt.addOutput({
                    script: witnessUtxo.script as ForkScript,
                    value: 10_000n as Satoshi,
                });
            }
            psbt.signAllInputs(e2eNobleTweaked);
            psbt.finalizeAllInputs();
            const tx = psbt.extractTransaction();
            tx.toHex();
        },
        { iterations: iters },
    );

    initForkTiny();
    const e2eTinyTweaked = getForkTinyTweakedSigner();
    const e2eTinyXOnly = toXOnly(forkTinyKeyPair.publicKey);
    const forkTinyE2ETr = await measure(
        'Fork tiny E2E P2TR',
        () => {
            const witnessUtxo = makeTaprootWitnessUtxoFork(forkTinyKeyPair.publicKey);
            const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
            for (let i = 0; i < numInputs; i++) {
                psbt.addInput({
                    hash: hashes[i]!,
                    index: 0,
                    witnessUtxo: {
                        script: witnessUtxo.script as ForkScript,
                        value: witnessUtxo.value as Satoshi,
                    },
                    tapInternalKey: e2eTinyXOnly,
                });
            }
            for (let j = 0; j < 5; j++) {
                psbt.addOutput({
                    script: witnessUtxo.script as ForkScript,
                    value: 10_000n as Satoshi,
                });
            }
            psbt.signAllInputs(e2eTinyTweaked);
            psbt.finalizeAllInputs();
            const tx = psbt.extractTransaction();
            tx.toHex();
        },
        { iterations: iters },
    );

    const scureE2ETr = await measure(
        'Scure E2E P2TR',
        () => {
            const witnessUtxo = makeTaprootWitnessUtxoScure(scureXOnlyPubKey);
            const tx = new scureBtc.Transaction();
            for (let i = 0; i < numInputs; i++) {
                tx.addInput({
                    txid: hashes[i]!,
                    index: 0,
                    witnessUtxo: {
                        script: witnessUtxo.script,
                        amount: witnessUtxo.amount,
                    },
                    tapInternalKey: scureXOnlyPubKey,
                });
            }
            for (let j = 0; j < 5; j++) {
                tx.addOutput({
                    script: witnessUtxo.script,
                    amount: 10_000n,
                });
            }
            tx.sign(scurePrivKey);
            tx.finalize();
            tx.hex;
        },
        { iterations: iters },
    );

    initOfficial();
    const e2eOfficialTweaked = getOfficialTweakedSigner();
    const xonly = bitcoin.toXOnly(officialKeyPair.publicKey);
    const officialE2ETr = await measure(
        'Official E2E P2TR',
        () => {
            const witnessUtxo = makeTaprootWitnessUtxoOfficial(officialKeyPair.publicKey);
            const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
            for (let i = 0; i < numInputs; i++) {
                psbt.addInput({
                    hash: hashes[i]!,
                    index: 0,
                    witnessUtxo,
                    tapInternalKey: xonly,
                });
            }
            for (let j = 0; j < 5; j++) {
                psbt.addOutput({
                    script: witnessUtxo.script,
                    value: 10_000n,
                });
            }
            psbt.signAllInputs(e2eOfficialTweaked);
            psbt.finalizeAllInputs();
            const tx = psbt.extractTransaction();
            tx.toHex();
        },
        { iterations: iters },
    );

    console.log(`  P2TR   100in: Noble=${fmt(forkNobleE2ETr.median)}, tiny=${fmt(forkTinyE2ETr.median)}, Scure=${fmt(scureE2ETr.median)}, Official=${fmt(officialE2ETr.median)}`);

    return [
        {
            scenario: 'E2E P2WPKH',
            detail: '100 inputs',
            forkNoble: forkNobleE2E,
            fork: forkTinyE2E,
            scure: scureE2E,
            official: officialE2E,
        },
        {
            scenario: 'E2E P2TR',
            detail: '100 inputs',
            forkNoble: forkNobleE2ETr,
            fork: forkTinyE2ETr,
            scure: scureE2ETr,
            official: officialE2ETr,
        },
    ];
}

/**
 * Scenario 6: Measures fork-exclusive parallel signing using `NodeWorkerSigningPool`
 * with 4 worker threads. Compares sequential fork, parallel fork, and official sequential.
 */
async function scenarioParallelSigning(): Promise<{
    rows: { scenario: string; detail: string; result: BenchResult }[];
    results: Record<string, BenchResult>;
}> {
    console.log('\n--- Scenario 6: Parallel Signing (fork-only) ---\n');

    const { NodeWorkerSigningPool } = await import('../build/workers/WorkerSigningPool.node.js');
    const { signPsbtParallel } = await import('../build/workers/psbt-parallel.js');

    initForkNoble();

    const inputCounts = [100, 500];
    const rows: { scenario: string; detail: string; result: BenchResult }[] = [];
    const results: Record<string, BenchResult> = {};

    for (const numInputs of inputCounts) {
        const iters = numInputs >= 500 ? 5 : 10;
        const hashes = Array.from({ length: numInputs }, () => randomTxHash());

        initForkNoble();
        const seqResult = await measure(
            `Fork Sequential ${numInputs}`,
            () => {
                const witnessUtxo = makeWitnessUtxoFork(forkNobleKeyPair.publicKey);
                const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo: {
                            script: witnessUtxo.script as ForkScript,
                            value: witnessUtxo.value as Satoshi,
                        },
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script as ForkScript,
                        value: 10_000n as Satoshi,
                    });
                }
                psbt.signAllInputs(forkNobleKeyPair);
            },
            { iterations: iters, warmup: 2 },
        );

        NodeWorkerSigningPool.resetInstance();
        const pool = NodeWorkerSigningPool.getInstance({ workerCount: 4 });
        await pool.initialize();
        pool.preserveWorkers();

        {
            const warmupPsbt = new ForkPsbt({ network: forkNetworks.bitcoin });
            const witnessUtxo = makeWitnessUtxoFork(forkNobleKeyPair.publicKey);
            for (let i = 0; i < 10; i++) {
                warmupPsbt.addInput({
                    hash: randomTxHash(),
                    index: 0,
                    witnessUtxo: {
                        script: witnessUtxo.script as ForkScript,
                        value: witnessUtxo.value as Satoshi,
                    },
                });
            }
            warmupPsbt.addOutput({
                script: witnessUtxo.script as ForkScript,
                value: 10_000n as Satoshi,
            });
            await signPsbtParallel(warmupPsbt, forkNobleKeyPair, pool);
        }

        const parResult = await measure(
            `Fork Parallel(4) ${numInputs}`,
            async () => {
                const witnessUtxo = makeWitnessUtxoFork(forkNobleKeyPair.publicKey);
                const psbt = new ForkPsbt({ network: forkNetworks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo: {
                            script: witnessUtxo.script as ForkScript,
                            value: witnessUtxo.value as Satoshi,
                        },
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script as ForkScript,
                        value: 10_000n as Satoshi,
                    });
                }
                await signPsbtParallel(psbt, forkNobleKeyPair, pool);
            },
            { iterations: iters, warmup: 2 },
        );

        await pool.shutdown();

        initOfficial();
        const officialSeqResult = await measure(
            `Official Sequential ${numInputs}`,
            () => {
                const witnessUtxo = makeWitnessUtxoOfficial(officialKeyPair.publicKey);
                const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
                for (let i = 0; i < numInputs; i++) {
                    psbt.addInput({
                        hash: hashes[i]!,
                        index: 0,
                        witnessUtxo,
                    });
                }
                for (let j = 0; j < 5; j++) {
                    psbt.addOutput({
                        script: witnessUtxo.script,
                        value: 10_000n,
                    });
                }
                psbt.signAllInputs(officialKeyPair);
            },
            { iterations: iters, warmup: 2 },
        );

        const speedup = seqResult.median / parResult.median;

        console.log(
            `  ${String(numInputs).padStart(4)} inputs: Sequential=${fmt(seqResult.median)}, Parallel(4)=${fmt(parResult.median)}, Official=${fmt(officialSeqResult.median)}, Speedup=${speedup.toFixed(2)}x`,
        );

        rows.push(
            { scenario: 'Fork Sequential', detail: `${numInputs} inputs`, result: seqResult },
            { scenario: 'Fork Parallel (4 workers)', detail: `${numInputs} inputs`, result: parResult },
            { scenario: 'Official Sequential', detail: `${numInputs} inputs`, result: officialSeqResult },
        );

        results[`parallel_seq_${numInputs}`] = seqResult;
        results[`parallel_par4_${numInputs}`] = parResult;
        results[`parallel_official_${numInputs}`] = officialSeqResult;
    }

    return { rows, results };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Runs all benchmark scenarios and prints comparison tables + JSON summary. */
async function main(): Promise<void> {
    console.log('='.repeat(80));
    console.log('  @btc-vision/bitcoin vs bitcoinjs-lib vs @scure/btc-signer — Benchmark Comparison');
    console.log(`  Node ${process.version} | ${process.platform} ${process.arch}`);
    console.log(`  GC control: ${typeof globalThis.gc === 'function' ? 'YES' : 'NO (run with --expose-gc for best results)'}`);
    console.log('='.repeat(80));

    const allRows: ComparisonRow[] = [];
    const allResults: Record<string, BenchResult> = {};

    const initRows = await scenarioInit();
    allRows.push(...initRows);
    for (const r of initRows) {
        if (r.forkNoble) allResults[`init_fork_noble`] = r.forkNoble;
        if (r.fork) allResults[`init_fork_tiny`] = r.fork;
        if (r.scure) allResults[`init_scure`] = r.scure;
        if (r.official) allResults[`init_official`] = r.official;
    }

    const createRows = await scenarioPsbtCreation();
    allRows.push(...createRows);
    for (const r of createRows) {
        if (r.forkNoble) allResults[`create_fork_${r.detail}`] = r.forkNoble;
        if (r.scure) allResults[`create_scure_${r.detail}`] = r.scure;
        if (r.official) allResults[`create_official_${r.detail}`] = r.official;
    }

    const wpkhRows = await scenarioP2wpkhSigning();
    allRows.push(...wpkhRows);
    for (const r of wpkhRows) {
        if (r.forkNoble) allResults[`wpkh_noble_${r.detail}`] = r.forkNoble;
        if (r.fork) allResults[`wpkh_tiny_${r.detail}`] = r.fork;
        if (r.scure) allResults[`wpkh_scure_${r.detail}`] = r.scure;
        if (r.official) allResults[`wpkh_official_${r.detail}`] = r.official;
    }

    const trRows = await scenarioP2trSigning();
    allRows.push(...trRows);
    for (const r of trRows) {
        if (r.forkNoble) allResults[`tr_noble_${r.detail}`] = r.forkNoble;
        if (r.fork) allResults[`tr_tiny_${r.detail}`] = r.fork;
        if (r.scure) allResults[`tr_scure_${r.detail}`] = r.scure;
        if (r.official) allResults[`tr_official_${r.detail}`] = r.official;
    }

    const e2eRows = await scenarioEndToEnd();
    allRows.push(...e2eRows);
    for (const r of e2eRows) {
        if (r.forkNoble) allResults[`e2e_noble_${r.detail}_${r.scenario}`] = r.forkNoble;
        if (r.fork) allResults[`e2e_tiny_${r.detail}_${r.scenario}`] = r.fork;
        if (r.scure) allResults[`e2e_scure_${r.detail}_${r.scenario}`] = r.scure;
        if (r.official) allResults[`e2e_official_${r.detail}_${r.scenario}`] = r.official;
    }

    const parallelData = await scenarioParallelSigning();
    Object.assign(allResults, parallelData.results);

    printComparison('Summary: @btc-vision/bitcoin vs bitcoinjs-lib vs @scure/btc-signer', allRows);
    printForkOnly('Parallel Signing (fork-exclusive)', parallelData.rows);

    const summary = buildSummary(allResults);
    console.log('\n--- JSON Summary ---');
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
