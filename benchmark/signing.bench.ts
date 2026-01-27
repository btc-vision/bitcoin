/**
 * Standalone Worker Signing Benchmark
 *
 * Run with: npx tsx benchmark/signing.bench.ts
 */

import * as ecc from 'tiny-secp256k1';
import { randomBytes } from 'crypto';
import { initEccLib } from '../src/ecc/context.js';
import { SignatureType, type SigningTask } from '../src/workers/types.js';

// Initialize ECC
initEccLib(ecc);

// Test key pair
const TEST_PRIVATE_KEY = randomBytes(32);
const TEST_PUBLIC_KEY = ecc.pointFromScalar(TEST_PRIVATE_KEY, true)!;

const signer = {
    publicKey: TEST_PUBLIC_KEY,
    sign: (hash: Uint8Array) => ecc.sign(hash, TEST_PRIVATE_KEY),
    getPrivateKey: () => new Uint8Array(TEST_PRIVATE_KEY),
};

async function main() {
    console.log('='.repeat(70));
    console.log('  WORKER SIGNING BENCHMARK');
    console.log('='.repeat(70));
    console.log();

    const inputCounts = [4, 8, 16, 32, 64, 100, 200, 2000];
    const iterations = 50;

    // Pre-generate ALL hashes upfront (just random 32-byte arrays)
    console.log('Generating test hashes...');
    const setupStart = performance.now();

    const allTasks: Map<number, SigningTask[][]> = new Map();
    for (const inputCount of inputCounts) {
        const iters = inputCount >= 2000 ? 10 : iterations;
        const tasksForCount: SigningTask[][] = [];

        for (let i = 0; i < iters + 5; i++) {
            const tasks: SigningTask[] = [];
            for (let j = 0; j < inputCount; j++) {
                tasks.push({
                    taskId: `task-${i}-${j}`,
                    inputIndex: j,
                    hash: randomBytes(32),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                });
            }
            tasksForCount.push(tasks);
        }
        allTasks.set(inputCount, tasksForCount);
    }

    console.log(`Setup done in ${((performance.now() - setupStart) / 1000).toFixed(2)}s`);
    console.log();

    // Initialize worker pool
    const { NodeWorkerSigningPool } = await import('../src/workers/WorkerSigningPool.node.js');
    NodeWorkerSigningPool.resetInstance();
    const pool = NodeWorkerSigningPool.getInstance({ workerCount: 4 });
    await pool.initialize();
    pool.preserveWorkers();

    console.log(`Worker pool: ${pool.workerCount} workers`);
    console.log(`Iterations: ${iterations} (10 for 2000 inputs)`);
    console.log();

    const results: Array<{
        inputs: number;
        seqAvg: number;
        parAvg: number;
        speedup: number;
    }> = [];

    for (const inputCount of inputCounts) {
        console.log(`--- ${inputCount} Inputs ---`);

        const testIterations = inputCount >= 2000 ? 10 : iterations;
        const tasks = allTasks.get(inputCount)!;

        // Warmup sequential
        for (let i = 0; i < 5; i++) {
            for (const task of tasks[i]) {
                signer.sign(task.hash);
            }
        }

        // Benchmark sequential
        const seqTimes: number[] = [];
        for (let i = 5; i < testIterations + 5; i++) {
            const start = performance.now();
            for (const task of tasks[i]) {
                signer.sign(task.hash);
            }
            seqTimes.push(performance.now() - start);
        }

        // Warmup parallel
        for (let i = 0; i < 5; i++) {
            await pool.signBatch(tasks[i], signer);
        }

        // Benchmark parallel
        const parTimes: number[] = [];
        for (let i = 5; i < testIterations + 5; i++) {
            const start = performance.now();
            await pool.signBatch(tasks[i], signer);
            parTimes.push(performance.now() - start);
        }

        const seqTotal = seqTimes.reduce((a, b) => a + b, 0);
        const seqAvg = seqTotal / seqTimes.length;
        const parTotal = parTimes.reduce((a, b) => a + b, 0);
        const parAvg = parTotal / parTimes.length;
        const speedup = seqAvg / parAvg;

        console.log(`  Sequential: ${seqAvg.toFixed(2)}ms avg (total: ${(seqTotal / 1000).toFixed(2)}s)`);
        console.log(`  Parallel:   ${parAvg.toFixed(2)}ms avg (total: ${(parTotal / 1000).toFixed(2)}s)`);
        console.log(`  Speedup:    ${speedup.toFixed(2)}x`);
        console.log();

        results.push({ inputs: inputCount, seqAvg, parAvg, speedup });
    }

    await pool.shutdown();

    // Summary
    console.log('='.repeat(70));
    console.log('  SUMMARY');
    console.log('='.repeat(70));
    console.log();
    console.log('  Inputs | Sequential (avg) | Parallel (avg) | Speedup');
    console.log('  -------|------------------|----------------|--------');
    for (const r of results) {
        console.log(
            `  ${String(r.inputs).padStart(6)} | ${r.seqAvg.toFixed(2).padStart(14)}ms | ${r.parAvg.toFixed(2).padStart(12)}ms | ${r.speedup.toFixed(2).padStart(6)}x`,
        );
    }
    console.log();
}

main().catch(console.error);
