/**
 * Shared benchmark infrastructure for comparison benchmarks.
 * Provides consistent measurement (warmup + iterations), statistics,
 * and ASCII table formatting.
 */

/** Statistical results from a single benchmark measurement. */
export interface BenchResult {
    name: string;
    mean: number;
    median: number;
    min: number;
    max: number;
    p95: number;
    stddev: number;
    samples: number;
}

/** Options for controlling warmup and iteration counts. */
export interface MeasureOpts {
    warmup?: number;
    iterations?: number;
}

const DEFAULT_WARMUP = 5;
const DEFAULT_ITERATIONS = 50;

/** Forces garbage collection if `--expose-gc` is available. */
function tryGC(): void {
    if (typeof globalThis.gc === 'function') {
        globalThis.gc();
    }
}

/**
 * Runs a function with warmup + measurement iterations and returns statistical results.
 * @param name - Display name for the benchmark.
 * @param fn - The function to benchmark (sync or async).
 * @param opts - Optional warmup and iteration overrides.
 */
export async function measure(
    name: string,
    fn: () => void | Promise<void>,
    opts: MeasureOpts = {},
): Promise<BenchResult> {
    const warmup = opts.warmup ?? DEFAULT_WARMUP;
    const iterations = opts.iterations ?? DEFAULT_ITERATIONS;

    for (let i = 0; i < warmup; i++) {
        await fn();
    }

    tryGC();

    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        await fn();
        times.push(performance.now() - t0);
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

    return { name, mean, median, min, max, p95, stddev, samples: times.length };
}

/**
 * Measures a synchronous function. Convenience wrapper around {@link measure}.
 */
export async function measureSync(
    name: string,
    fn: () => void,
    opts: MeasureOpts = {},
): Promise<BenchResult> {
    return measure(name, fn, opts);
}

/** Formats milliseconds into a human-readable string (ns/us/ms/s). */
export function fmt(ms: number): string {
    if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)}ns`;
    if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

/** A row in the comparison table with results from all libraries. */
export interface ComparisonRow {
    scenario: string;
    detail: string;
    fork: BenchResult | null;
    forkNoble: BenchResult | null;
    scure: BenchResult | null;
    official: BenchResult | null;
}

/** Prints an aligned ASCII comparison table to stdout. */
export function printComparison(title: string, rows: ComparisonRow[]): void {
    const W = 130;
    console.log();
    console.log('='.repeat(W));
    console.log(`  ${title}`);
    console.log('='.repeat(W));

    const header = [
        pad('Scenario', 28),
        pad('Detail', 12),
        pad('Fork (Noble)', 14),
        pad('Fork (tiny)', 14),
        pad('Scure', 14),
        pad('Official', 14),
        pad('Improvement', 14),
    ].join(' | ');

    console.log(header);
    console.log('-'.repeat(W));

    for (const row of rows) {
        const forkNobleMs = row.forkNoble ? fmt(row.forkNoble.median) : '-';
        const forkMs = row.fork ? fmt(row.fork.median) : '-';
        const scureMs = row.scure ? fmt(row.scure.median) : '-';
        const officialMs = row.official ? fmt(row.official.median) : '-';

        let improvement = '-';
        const candidates = [row.forkNoble, row.fork].filter(Boolean) as BenchResult[];
        const bestFork = candidates.length > 0
            ? candidates.reduce((a, b) => a.median < b.median ? a : b)
            : null;
        if (bestFork && row.official) {
            const ratio = row.official.median / bestFork.median;
            if (ratio > 1.01) {
                improvement = `${ratio.toFixed(2)}x faster`;
            } else if (ratio < 0.99) {
                improvement = `${(1 / ratio).toFixed(2)}x slower`;
            } else {
                improvement = 'equal';
            }
        }

        const line = [
            pad(row.scenario, 28),
            pad(row.detail, 12),
            pad(forkNobleMs, 14),
            pad(forkMs, 14),
            pad(scureMs, 14),
            pad(officialMs, 14),
            pad(improvement, 14),
        ].join(' | ');

        console.log(line);
    }

    console.log('='.repeat(W));
    console.log();
}

function pad(s: string, n: number): string {
    return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

/** Prints a simple results table for fork-only scenarios (e.g., parallel signing). */
export function printForkOnly(title: string, rows: { scenario: string; detail: string; result: BenchResult }[]): void {
    console.log();
    console.log('='.repeat(80));
    console.log(`  ${title}`);
    console.log('='.repeat(80));

    const header = [
        pad('Scenario', 36),
        pad('Detail', 12),
        pad('Median', 14),
        pad('p95', 14),
    ].join(' | ');

    console.log(header);
    console.log('-'.repeat(80));

    for (const row of rows) {
        const line = [
            pad(row.scenario, 36),
            pad(row.detail, 12),
            pad(fmt(row.result.median), 14),
            pad(fmt(row.result.p95), 14),
        ].join(' | ');
        console.log(line);
    }

    console.log('='.repeat(80));
    console.log();
}

/** Machine-readable JSON summary of all benchmark results. */
export interface BenchSummary {
    timestamp: string;
    node: string;
    platform: string;
    arch: string;
    scenarios: Record<string, BenchResult>;
}

/** Builds a {@link BenchSummary} from collected results. */
export function buildSummary(results: Record<string, BenchResult>): BenchSummary {
    return {
        timestamp: new Date().toISOString(),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        scenarios: results,
    };
}
