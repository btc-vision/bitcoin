/**
 * Browser worker pool entry point.
 *
 * Uses Web Workers for parallel signing. Never references Node.js modules
 * (worker_threads, os, etc.), so it is safe for browser bundlers.
 *
 * @packageDocumentation
 */

import type { WorkerPoolConfig, SigningPoolLike } from './types.js';

export * from './index.shared.js';

/**
 * Detects the runtime environment.
 *
 * @returns Always 'browser' in this entry point.
 */
export function detectRuntime(): 'node' | 'browser' | 'react-native' | 'unknown' {
    return 'browser';
}

/**
 * Creates a signing pool for the browser runtime using Web Workers.
 *
 * @param config - Optional pool configuration
 * @returns A promise resolving to the initialized signing pool
 */
export async function createSigningPool(config?: WorkerPoolConfig): Promise<SigningPoolLike> {
    const { WorkerSigningPool } = await import('./WorkerSigningPool.js');
    const pool = WorkerSigningPool.getInstance(config);
    await pool.initialize();
    return pool;
}
