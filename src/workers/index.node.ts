/**
 * Node.js worker pool entry point.
 *
 * Uses worker_threads for parallel signing. Provides direct access to
 * NodeWorkerSigningPool without runtime detection overhead.
 *
 * @example
 * ```typescript
 * import { NodeWorkerSigningPool } from '@btc-vision/bitcoin/workers';
 *
 * const pool = NodeWorkerSigningPool.getInstance({ workerCount: 4 });
 * await pool.initialize();
 * pool.preserveWorkers();
 *
 * const result = await pool.signBatch(tasks, keyPair);
 *
 * await pool.shutdown();
 * ```
 *
 * @packageDocumentation
 */

import type { WorkerPoolConfig, SigningPoolLike } from './types.js';

export * from './index.shared.js';

// Node.js specific exports
export { NodeWorkerSigningPool, type NodeWorkerPoolConfig } from './WorkerSigningPool.node.js';

/**
 * Detects the runtime environment.
 *
 * @returns Always 'node' in this entry point.
 */
export function detectRuntime(): 'node' | 'browser' | 'react-native' | 'unknown' {
    return 'node';
}

/**
 * Creates a signing pool for the Node.js runtime using worker_threads.
 *
 * @param config - Optional pool configuration
 * @returns A promise resolving to the initialized signing pool
 */
export async function createSigningPool(config?: WorkerPoolConfig): Promise<SigningPoolLike> {
    const { NodeWorkerSigningPool } = await import('./WorkerSigningPool.node.js');
    const pool = NodeWorkerSigningPool.getInstance(config);
    await pool.initialize();
    return pool;
}
