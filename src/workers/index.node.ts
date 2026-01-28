/**
 * Node.js worker pool entry point.
 *
 * This module provides direct access to Node.js-specific worker functionality.
 * It re-exports everything from the base index plus Node.js specific exports.
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

// Re-export everything from browser-safe index
export * from './index.js';

// Node.js specific exports
export { NodeWorkerSigningPool, type NodeWorkerPoolConfig } from './WorkerSigningPool.node.js';