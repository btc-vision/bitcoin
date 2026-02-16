# Workers - Parallel Signing System

The workers module provides secure parallel signature computation for PSBT signing using platform-native threading. Private keys are isolated per-worker and zeroed immediately after signing. The system supports Node.js (`worker_threads`), browsers (Web Workers), React Native (parallel via `react-native-worklets` with sequential fallback), and automatic runtime detection.

## Overview

| Property | Value |
|----------|-------|
| Import path | `@btc-vision/bitcoin/workers` |
| Node.js backend | `worker_threads` (`NodeWorkerSigningPool`) |
| Browser backend | Web Workers via Blob URL (`WorkerSigningPool`) |
| React Native backend | Worklet runtimes (`WorkletSigningPool`) with sequential main-thread fallback (`SequentialSigningPool`) |
| Supported signatures | ECDSA (secp256k1), Schnorr (BIP340) |
| Singleton pattern | Yes (per pool class, via `getInstance()`) |
| Disposable support | `Symbol.dispose` and `Symbol.asyncDispose` |

### Key Security Properties

| Guarantee | Mechanism |
|-----------|-----------|
| Key isolation | Keys are cloned via `postMessage`, never shared via `SharedArrayBuffer` |
| Key zeroing (worker) | `secureZero()` double-writes zeros immediately after signing |
| Key zeroing (main thread) | `privateKey.fill(0)` in `finally` block after batch completes |
| Key hold timeout | Worker is terminated if signing exceeds `maxKeyHoldTimeMs` (default 5s) |
| No key persistence | Keys are not stored; obtained per-batch via `getPrivateKey()` |

---

## SignatureType Enum

Discriminates between the two signature algorithms supported by the signing workers.

```typescript
const SignatureType = {
    /** ECDSA signature (secp256k1) */
    ECDSA: 0,
    /** Schnorr signature (BIP340) */
    Schnorr: 1,
} as const;

type SignatureType = (typeof SignatureType)[keyof typeof SignatureType];
```

| Value | Numeric | Use case |
|-------|---------|----------|
| `SignatureType.ECDSA` | `0` | Legacy, SegWit (P2PKH, P2SH, P2WPKH, P2WSH) |
| `SignatureType.Schnorr` | `1` | Taproot key-path and script-path (P2TR) |

---

## SigningTask Interface

Represents a single signing operation to be dispatched to a worker.

```typescript
interface SigningTask {
    /** Unique task identifier */
    readonly taskId: string;
    /** PSBT input index this task corresponds to */
    readonly inputIndex: number;
    /** 32-byte hash to sign */
    readonly hash: Uint8Array;
    /** Signature algorithm to use */
    readonly signatureType: SignatureType;
    /** Grind for low R value (ECDSA only) */
    readonly lowR?: boolean | undefined;
    /** Sighash type for signature encoding */
    readonly sighashType: number;
    /** Leaf hash for Taproot script-path spending */
    readonly leafHash?: Uint8Array | undefined;
}
```

Tasks are created by `prepareSigningTasks()` when working with PSBTs, or constructed manually for lower-level usage with `signBatch()`.

---

## ParallelSignerKeyPair Interface

The key pair interface required by the signing pool. Exposes the public key and a method to retrieve the raw private key bytes.

```typescript
interface ParallelSignerKeyPair {
    /** Public key (compressed 33 bytes or uncompressed 65 bytes) */
    readonly publicKey: Uint8Array;

    /**
     * Get private key bytes (32 bytes).
     *
     * SECURITY WARNING: This exposes the raw private key.
     * Called only when dispatching to worker. Key is cloned
     * to worker via postMessage.
     */
    getPrivateKey(): Uint8Array;

    /** Optional: Sign ECDSA directly (fallback if workers unavailable) */
    sign?(hash: Uint8Array, lowR?: boolean): Uint8Array;

    /** Optional: Sign Schnorr directly (fallback if workers unavailable) */
    signSchnorr?(hash: Uint8Array): Uint8Array;
}
```

The `sign()` and `signSchnorr()` methods are optional fallback methods. When workers are available, the pool uses `getPrivateKey()` and delegates signing to the worker thread.

---

## ParallelSigningResult Interface

Returned by `signBatch()` and `signPsbtParallel()` after all tasks complete.

```typescript
interface ParallelSigningResult {
    /** Whether all signatures were created successfully */
    readonly success: boolean;
    /** Signatures indexed by input index */
    readonly signatures: ReadonlyMap<number, SigningResultMessage>;
    /** Errors indexed by input index */
    readonly errors: ReadonlyMap<number, string>;
    /** Total time taken in milliseconds */
    readonly durationMs: number;
}
```

The `success` field is `true` only when `errors.size === 0`. Each entry in `signatures` contains the full `SigningResultMessage` with the raw signature bytes, public key, signature type, and optional leaf hash.

---

## WorkerPoolConfig Interface

Configuration for any signing pool implementation.

```typescript
interface WorkerPoolConfig {
    /**
     * Number of workers to create.
     * Default: navigator.hardwareConcurrency (browser) or os.cpus().length (Node.js)
     */
    readonly workerCount?: number;

    /**
     * Timeout per signing operation in milliseconds.
     * Worker is terminated if exceeded (key safety measure).
     * Default: 30000 (30 seconds)
     */
    readonly taskTimeoutMs?: number;

    /**
     * Maximum time a worker can hold a private key in milliseconds.
     * Acts as a safety net - worker is terminated if signing takes too long.
     * Default: 5000 (5 seconds)
     */
    readonly maxKeyHoldTimeMs?: number;

    /**
     * Whether to verify signatures after signing.
     * Adds overhead but ensures correctness.
     * Default: true
     */
    readonly verifySignatures?: boolean;

    /**
     * Whether to preserve workers between signing batches.
     * true = workers stay alive (faster for multiple batches)
     * false = workers terminated after each batch (more secure)
     * Default: false
     */
    readonly preserveWorkers?: boolean;
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `workerCount` | CPU core count | Number of worker threads to spawn |
| `taskTimeoutMs` | `30000` | Maximum time for any single signing operation |
| `maxKeyHoldTimeMs` | `5000` | Safety limit on how long a worker may hold a private key |
| `verifySignatures` | `true` | Post-signing signature verification |
| `preserveWorkers` | `false` | Keep workers alive between batches |

The Node.js pool extends this with `NodeWorkerPoolConfig`:

```typescript
interface NodeWorkerPoolConfig extends WorkerPoolConfig {
    /**
     * ECC library type for signing.
     * Default: NodeEccLibrary.TinySecp256k1
     */
    readonly eccLibrary?: NodeEccLibrary;
}
```

| ECC Library | Value | Size | Notes |
|-------------|-------|------|-------|
| `NodeEccLibrary.Noble` | `'noble'` | ~12KB | Pure JS `@noble/secp256k1` |
| `NodeEccLibrary.TinySecp256k1` | `'tiny-secp256k1'` | ~1.2MB | WASM-based, faster for batch operations |

> **Note:** The `NodeEccLibrary` enum is **not** re-exported from any index entry point (`index.ts`, `index.node.ts`, `index.browser.ts`, or `index.react-native.ts`). When specifying the ECC library in a `NodeWorkerPoolConfig`, use the string literal values `'noble'` or `'tiny-secp256k1'` directly. If you need the enum itself, import it directly from the worker module:
>
> ```typescript
> import { NodeEccLibrary } from '@btc-vision/bitcoin/src/workers/WorkerSigningPool.node.js';
> ```

---

## WorkerSigningPool Class (Browser)

Manages a pool of Web Workers for parallel signature computation. Uses the singleton pattern.

```typescript
class WorkerSigningPool {
    // Singleton access
    static getInstance(config?: WorkerPoolConfig): WorkerSigningPool;
    static resetInstance(): void;

    // Properties
    get workerCount(): number;
    get idleWorkerCount(): number;
    get busyWorkerCount(): number;
    get isPreservingWorkers(): boolean;

    // Lifecycle
    initialize(): Promise<void>;
    shutdown(): Promise<void>;

    // Worker preservation
    preserveWorkers(): void;
    releaseWorkers(): void;

    // Signing
    signBatch(
        tasks: readonly SigningTask[],
        keyPair: ParallelSignerKeyPair,
    ): Promise<ParallelSigningResult>;

    // Disposable protocol
    [Symbol.dispose](): void;
    [Symbol.asyncDispose](): Promise<void>;
}
```

### getInstance()

Returns the singleton pool instance. Configuration is only applied on first call.

```typescript
const pool = WorkerSigningPool.getInstance({ workerCount: 4 });
```

### initialize()

Creates worker threads and waits for all to signal readiness. Called automatically on the first `signBatch()` if not called explicitly.

```typescript
await pool.initialize();
```

Internally, this creates a Blob URL from the generated worker code (which bundles the `@noble/secp256k1` ECC library inline), spawns the configured number of workers, and sends each an `init` message. Each worker responds with a `ready` message. Worker initialization times out after 10 seconds.

### signBatch()

Signs an array of tasks in parallel by distributing them across available workers using round-robin assignment. Returns a `ParallelSigningResult`.

```typescript
const result = await pool.signBatch(tasks, keyPair);

if (result.success) {
    for (const [inputIndex, sig] of result.signatures) {
        console.log(`Input ${inputIndex} signed in ${result.durationMs}ms`);
    }
}
```

Internally, `signBatch()`:
1. Calls `keyPair.getPrivateKey()` once to obtain the raw key.
2. Distributes tasks into sub-batches, one per worker (round-robin).
3. Sends each sub-batch as a `BatchSigningMessage` to its assigned worker via `postMessage` (the private key is cloned, not shared).
4. Awaits all `BatchSigningResultMessage` responses.
5. Zeros the private key in the main thread via `privateKey.fill(0)` in a `finally` block.
6. If `preserveWorkers` is `false`, terminates all idle workers after the batch completes.

### shutdown()

Terminates all workers by sending `shutdown` messages and awaiting acknowledgments. Falls back to forced `terminate()` after 1 second. Revokes the Blob URL.

```typescript
await pool.shutdown();
```

### preserveWorkers() / releaseWorkers()

Controls whether workers are kept alive between signing batches.

```typescript
pool.preserveWorkers();  // Workers stay alive after signBatch()
pool.releaseWorkers();   // Workers terminated after each signBatch()
```

Preserving workers is faster for applications that sign multiple transactions. Releasing workers is more secure since no threads persist with loaded ECC code.

---

## NodeWorkerSigningPool Class (Node.js)

Node.js-specific signing pool using `worker_threads`. Same public API as `WorkerSigningPool` but uses Node.js threading primitives.

```typescript
class NodeWorkerSigningPool {
    static getInstance(config?: NodeWorkerPoolConfig): NodeWorkerSigningPool;
    static resetInstance(): void;

    get workerCount(): number;
    get idleWorkerCount(): number;
    get busyWorkerCount(): number;
    get isPreservingWorkers(): boolean;

    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    preserveWorkers(): void;
    releaseWorkers(): void;

    signBatch(
        tasks: readonly SigningTask[],
        keyPair: ParallelSignerKeyPair,
    ): Promise<ParallelSigningResult>;
}
```

Key differences from the browser pool:
- Uses `new Worker(script, { eval: true })` with inline script code instead of Blob URLs.
- Supports choosing between `@noble/secp256k1` (pure JS) and `tiny-secp256k1` (WASM) via `NodeWorkerPoolConfig.eccLibrary`.
- Uses zero-copy `ArrayBuffer` transfer for private keys and hashes via the `transferList` parameter.
- Default `workerCount` is `os.cpus().length` instead of `navigator.hardwareConcurrency`.
- Can only be created in the main thread (throws if `isMainThread` is `false`).

```typescript
import { NodeWorkerSigningPool } from '@btc-vision/bitcoin/workers';

const pool = NodeWorkerSigningPool.getInstance({
    workerCount: 4,
    eccLibrary: 'tiny-secp256k1',
});

await pool.initialize();
pool.preserveWorkers();

const result = await pool.signBatch(tasks, keyPair);

await pool.shutdown();
```

---

## WorkletSigningPool Class (React Native)

React Native signing pool using `react-native-worklets` (Software Mansion v0.7+) for true parallel signing across multiple worklet runtimes. Each runtime gets its own ECC module instance via eval of the bundled `@noble/secp256k1` IIFE string. Uses the singleton pattern.

```typescript
class WorkletSigningPool {
    // Singleton access
    static getInstance(config?: WorkerPoolConfig): WorkletSigningPool;
    static resetInstance(): void;

    // Properties
    get workerCount(): number;       // Number of active runtimes
    get idleWorkerCount(): number;   // Non-tainted runtimes
    get busyWorkerCount(): number;   // Always 0 outside of signBatch
    get isPreservingWorkers(): boolean;

    // Lifecycle
    initialize(): Promise<void>;
    shutdown(): Promise<void>;

    // Worker preservation
    preserveWorkers(): void;
    releaseWorkers(): void;

    // Signing
    signBatch(
        tasks: readonly SigningTask[],
        keyPair: ParallelSignerKeyPair,
    ): Promise<ParallelSigningResult>;

    // Disposable protocol
    [Symbol.dispose](): void;
    [Symbol.asyncDispose](): Promise<void>;
}
```

### Security Architecture

- Private keys are cloned per-runtime (structuredClone semantics).
- Keys are zeroed inside the worklet AND in the main thread `finally` block.
- Tainted runtimes (those that exceeded the key hold timeout) are replaced, not reused.

### initialize()

Dynamically imports `react-native-worklets`, creates N runtimes (default 4), and injects the ECC bundle into each via `new Function()` eval. Also feature-detects whether `Uint8Array` survives the worklet boundary; if not, data is encoded as `number[]` for transfer.

```typescript
const pool = WorkletSigningPool.getInstance({ workerCount: 4 });
await pool.initialize();
```

Throws if `react-native-worklets` is not installed or ECC bundle injection fails.

### signBatch()

Signs an array of tasks in parallel by distributing them round-robin across available worklet runtimes. Uses `runOnRuntime()` to dispatch signing closures to each runtime, with a timeout guard (`maxKeyHoldTimeMs`) that taints and replaces runtimes that exceed the limit.

```typescript
const result = await pool.signBatch(tasks, keyPair);

if (result.success) {
    for (const [inputIndex, sig] of result.signatures) {
        console.log(`Input ${inputIndex} signed`);
    }
}
```

### shutdown()

Clears all runtime references for garbage collection. Worklet runtimes do not have an explicit `destroy()` API, so shutdown releases references and resets internal state.

```typescript
await pool.shutdown();
```

### Usage Example

```typescript
import { WorkletSigningPool } from '@btc-vision/bitcoin/workers';

const pool = WorkletSigningPool.getInstance({ workerCount: 4 });
await pool.initialize();
pool.preserveWorkers();

const result = await pool.signBatch(tasks, keyPair);
await pool.shutdown();
```

Key differences from the browser `WorkerSigningPool`:
- Uses `react-native-worklets` runtimes instead of Web Workers.
- Uses `runOnRuntime()` which returns a Promise directly -- no `postMessage` protocol.
- Data may be encoded as `number[]` instead of `Uint8Array` if the worklet boundary does not support typed arrays.
- Default `workerCount` is 4 (not tied to hardware concurrency detection).
- Only available in React Native environments with `react-native-worklets` installed.

---

## SequentialSigningPool Class (React Native / Fallback)

Sequential signing pool for environments without worker support. Signs inputs one-by-one on the main thread using the ECC library from `EccContext`. Same API shape as `WorkerSigningPool` for transparent swapping.

> **Note:** `SequentialSigningPool` is only exported from the React Native entry point (`index.react-native.ts`). It is **not** available from the generic (`index.ts`), browser (`index.browser.ts`), or Node.js (`index.node.ts`) entry points. To use it outside React Native, import it directly:
>
> ```typescript
> import { SequentialSigningPool } from '@btc-vision/bitcoin/src/workers/WorkerSigningPool.sequential.js';
> ```

```typescript
class SequentialSigningPool {
    static getInstance(config?: WorkerPoolConfig): SequentialSigningPool;
    static resetInstance(): void;

    get workerCount(): number;       // Always 0
    get idleWorkerCount(): number;   // Always 0
    get busyWorkerCount(): number;   // Always 0
    get isPreservingWorkers(): boolean; // Always false

    initialize(): Promise<void>;     // No-op
    shutdown(): Promise<void>;       // No-op
    preserveWorkers(): void;         // No-op
    releaseWorkers(): void;          // No-op

    signBatch(
        tasks: readonly SigningTask[],
        keyPair: ParallelSignerKeyPair,
    ): Promise<ParallelSigningResult>;
}
```

The `signBatch()` method iterates tasks sequentially, calling `EccContext.get().lib.sign()` or `EccContext.get().lib.signSchnorr()` for each task. Private keys are zeroed after the loop completes.

```typescript
import { SequentialSigningPool } from '@btc-vision/bitcoin/workers'; // React Native entry point only

const pool = SequentialSigningPool.getInstance();
const result = await pool.signBatch(tasks, keyPair);
```

---

## Platform Functions: createSigningPool() and detectRuntime()

### detectRuntime()

Detects the current runtime environment.

```typescript
function detectRuntime(): 'node' | 'browser' | 'react-native' | 'unknown';
```

Detection logic (in order):
1. `navigator.product === 'ReactNative'` returns `'react-native'`
2. `process.versions.node` exists returns `'node'`
3. `window` and `Worker` exist returns `'browser'`
4. Otherwise returns `'unknown'`

Platform-specific entry points (`index.node.ts`, `index.browser.ts`, `index.react-native.ts`) hardcode the return value to avoid detection overhead.

### createSigningPool()

Creates and initializes the appropriate signing pool for the current runtime.

```typescript
async function createSigningPool(config?: WorkerPoolConfig): Promise<SigningPoolLike>;
```

The behavior of `createSigningPool()` depends on which entry point is being used:

**Generic entry point (`index.ts`):**

| Runtime | Pool class created |
|---------|--------------------|
| `'node'` | `NodeWorkerSigningPool` |
| `'browser'` | `WorkerSigningPool` |
| `'react-native'` | `SequentialSigningPool` |
| `'unknown'` | Throws `Error('Unsupported runtime...')` |

**Platform-specific entry points:**

| Entry point | Pool class created |
|-------------|--------------------|
| `index.node.ts` | `NodeWorkerSigningPool` |
| `index.browser.ts` | `WorkerSigningPool` |
| `index.react-native.ts` | `WorkletSigningPool` (with fallback to `SequentialSigningPool` if `react-native-worklets` is not installed or initialization fails) |

> **Note:** Only the React Native platform-specific entry point (`index.react-native.ts`) attempts to use `WorkletSigningPool` for true parallel signing. The generic entry point (`index.ts`) always creates a `SequentialSigningPool` for React Native, since it does not attempt the worklet probe.

```typescript
import { createSigningPool } from '@btc-vision/bitcoin/workers';

const pool = await createSigningPool({ workerCount: 4 });
pool.preserveWorkers();

// Use pool for signing...

await pool.shutdown();
```

---

## getSigningPool() Helper

Convenience function that returns the browser `WorkerSigningPool` singleton without initialization.

```typescript
function getSigningPool(config?: WorkerPoolConfig): WorkerSigningPool;
```

```typescript
import { getSigningPool } from '@btc-vision/bitcoin/workers';

const pool = getSigningPool({ workerCount: 4 });
```

This is equivalent to calling `WorkerSigningPool.getInstance(config)`. The pool initializes lazily on the first `signBatch()` call.

---

## PSBT Parallel Signing

The `psbt-parallel.ts` module integrates the worker pool with the PSBT class for high-level parallel signing.

### PsbtParallelKeyPair Interface

Extends `ParallelSignerKeyPair` with optional network information.

```typescript
interface PsbtParallelKeyPair extends ParallelSignerKeyPair {
    /** Network (optional, for validation) */
    readonly network?: { messagePrefix: string };
}
```

### ParallelSignOptions Interface

Options for controlling parallel PSBT signing behavior.

```typescript
interface ParallelSignOptions {
    /** Sighash types allowed for signing.
     *  Default: [SIGHASH_ALL] for legacy, [SIGHASH_DEFAULT] for Taproot */
    readonly sighashTypes?: readonly number[];

    /** Tap leaf hash to sign (for Taproot script-path) */
    readonly tapLeafHash?: Uint8Array;

    /** Worker pool configuration (if pool not provided) */
    readonly poolConfig?: WorkerPoolConfig;

    /** Whether to use low-R signing for ECDSA. Default: false */
    readonly lowR?: boolean;
}
```

### signPsbtParallel()

Main entry point for parallel PSBT signing. Analyzes inputs, creates signing tasks, dispatches them to workers, and applies the resulting signatures back to the PSBT.

```typescript
async function signPsbtParallel(
    psbt: Psbt,
    keyPair: PsbtParallelKeyPair,
    poolOrConfig?: SigningPoolLike | WorkerPoolConfig,
    options?: ParallelSignOptions,
): Promise<ParallelSigningResult>;
```

The `poolOrConfig` parameter accepts either:
- An existing `SigningPoolLike` instance (recommended for multiple operations)
- A `WorkerPoolConfig` to create a temporary pool (pool is shut down after signing if not preserving workers)

> **WARNING: Browser-only pool creation when passing config.** When `poolOrConfig` is a `WorkerPoolConfig` (not a pool instance), `signPsbtParallel()` hardcodes `import('./WorkerSigningPool.js')` and always creates a browser `WorkerSigningPool`. This means:
>
> - **Node.js users MUST pass an already-created `NodeWorkerSigningPool` instance** as `poolOrConfig`. Passing a plain config object will fail or create the wrong pool type.
> - **React Native users MUST pass an already-created `WorkletSigningPool` or `SequentialSigningPool` instance.**
> - Only browser environments can safely pass a `WorkerPoolConfig` directly.
>
> ```typescript
> // CORRECT: Node.js usage -- pass a pool instance
> import { NodeWorkerSigningPool } from '@btc-vision/bitcoin/workers';
> const pool = NodeWorkerSigningPool.getInstance({ workerCount: 4 });
> const result = await signPsbtParallel(psbt, keyPair, pool);
>
> // CORRECT: React Native usage -- pass a pool instance
> import { WorkletSigningPool } from '@btc-vision/bitcoin/workers';
> const pool = WorkletSigningPool.getInstance({ workerCount: 4 });
> const result = await signPsbtParallel(psbt, keyPair, pool);
>
> // WRONG: Node.js usage -- passing config creates a browser pool!
> const result = await signPsbtParallel(psbt, keyPair, { workerCount: 4 }); // BUG
> ```

```typescript
import { Psbt } from '@btc-vision/bitcoin';
import { signPsbtParallel, WorkerSigningPool } from '@btc-vision/bitcoin/workers';

// With an existing pool (recommended)
const pool = WorkerSigningPool.getInstance();
pool.preserveWorkers();

const result = await signPsbtParallel(psbt, keyPair, pool);

if (result.success) {
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
}

// With inline configuration (browser only -- creates and destroys browser WorkerSigningPool)
const result = await signPsbtParallel(psbt, keyPair, { workerCount: 4 });
```

Internally, `signPsbtParallel()`:
1. If `poolOrConfig` is a `SigningPoolLike` instance (has `signBatch` method), uses it directly. Otherwise, imports `WorkerSigningPool` (browser) and creates a singleton instance with the provided config.
2. Calls `prepareSigningTasks()` to extract signable inputs.
3. Calls `pool.signBatch()` to sign all tasks in parallel.
4. Calls `applySignaturesToPsbt()` to write signatures back into the PSBT.
5. Shuts down the pool if it was created inline and not preserving workers.

### prepareSigningTasks()

Analyzes a PSBT and creates `SigningTask` entries for each input that can be signed with the provided key pair.

```typescript
function prepareSigningTasks(
    psbt: Psbt,
    keyPair: PsbtParallelKeyPair,
    options?: ParallelSignOptions,
): SigningTask[];
```

> **Important: Only Taproot inputs are supported for parallel signing.** The `prepareLegacyTask()` internal function is a placeholder that always returns `null`. Legacy and SegWit inputs (P2PKH, P2SH, P2WPKH, P2WSH) are silently skipped by `prepareSigningTasks()` and will not be included in the returned task array. For legacy/SegWit inputs, use the standard `psbt.signInput()` or `psbt.signAllInputs()` methods instead.

For each PSBT input:
1. Checks if the input contains the key pair's public key via `psbt.inputHasPubkey()`.
2. If the input is Taproot (`isTaprootInput()`), calls `psbt.checkTaprootHashesForSig()` and creates Schnorr signing tasks. Each task is tagged with `signatureType: SignatureType.Schnorr` and may include a `leafHash` for script-path spending.
3. If the input is legacy/SegWit, the implementation is a placeholder that returns `null` -- the input is skipped. Legacy/SegWit parallel signing is not yet implemented.

```typescript
import { prepareSigningTasks } from '@btc-vision/bitcoin/workers';

const tasks = prepareSigningTasks(psbt, keyPair, {
    sighashTypes: [Transaction.SIGHASH_ALL],
    lowR: true,
});

// NOTE: tasks will only contain Taproot inputs.
// Legacy/SegWit inputs must be signed separately via psbt.signInput().
console.log(`Found ${tasks.length} Taproot inputs to sign in parallel`);
```

### applySignaturesToPsbt()

Writes parallel signing results back into the PSBT data structure.

```typescript
function applySignaturesToPsbt(
    psbt: Psbt,
    result: ParallelSigningResult,
    keyPair: PsbtParallelKeyPair,
): void;
```

For each successful signature in `result.signatures`:

| Signature type | PSBT field updated | Details |
|----------------|-------------------|---------|
| Schnorr + leafHash | `tapScriptSig` | Script-path: `{ pubkey: xOnlyPubkey, signature: serialized, leafHash }` |
| Schnorr (no leafHash) | `tapKeySig` | Key-path: serialized Taproot signature |
| ECDSA | `partialSig` | `{ pubkey, signature: DER-encoded with sighash }` |

```typescript
import { applySignaturesToPsbt } from '@btc-vision/bitcoin/workers';

// After pool.signBatch() returns:
if (result.success) {
    applySignaturesToPsbt(psbt, result, keyPair);
    psbt.finalizeAllInputs();
}
```

---

## Worker Internals

### Worker Code Generation

The browser pool uses inline worker code generated at compile time. The `@noble/secp256k1` ECC library is bundled as a string constant (`ECC_BUNDLE`) and evaluated inside each worker via `new Function()`. No network requests are made.

```typescript
// Generate worker code as a string
function generateWorkerCode(): string;

// Create a Blob URL for use with new Worker()
function createWorkerBlobUrl(): string;

// Revoke a previously created Blob URL
function revokeWorkerBlobUrl(url: string): void;
```

### Worker Message Protocol

Workers communicate with the main thread via structured messages. All messages include a `type` discriminator field.

**Messages to worker:**

| Type | Interface | Description |
|------|-----------|-------------|
| `'init'` | `WorkerInitMessage` | Initialize the ECC library |
| `'sign'` | `SigningTaskMessage` | Sign a single hash |
| `'signBatch'` | `BatchSigningMessage` | Sign multiple hashes with one private key |
| `'shutdown'` | `WorkerShutdownMessage` | Terminate the worker |

**Messages from worker:**

| Type | Interface | Description |
|------|-----------|-------------|
| `'ready'` | `WorkerReadyMessage` | Worker initialized and ready |
| `'result'` | `SigningResultMessage` | Single signing result |
| `'batchResult'` | `BatchSigningResultMessage` | Batch of signing results |
| `'error'` | `SigningErrorMessage` | Signing error |
| `'shutdown-ack'` | `WorkerShutdownAckMessage` | Shutdown acknowledged |

Type guards are provided for response discrimination:

```typescript
function isSigningError(response: WorkerResponse): response is SigningErrorMessage;
function isSigningResult(response: WorkerResponse): response is SigningResultMessage;
function isBatchResult(response: WorkerResponse): response is BatchSigningResultMessage;
function isWorkerReady(response: WorkerResponse): response is WorkerReadyMessage;
```

### WorkerState Enum

Tracks the lifecycle of each pooled worker.

```typescript
const WorkerState = {
    Initializing: 0,  // Worker is loading ECC library
    Idle: 1,           // Ready and waiting for tasks
    Busy: 2,           // Currently processing a signing batch
    ShuttingDown: 3,   // Shutdown message sent, awaiting ack
    Terminated: 4,     // Worker has been terminated
} as const;
```

### SigningPoolLike Interface

The minimum contract shared by all pool implementations. Extends both `Disposable` and `AsyncDisposable`.

```typescript
interface SigningPoolLike extends Disposable, AsyncDisposable {
    signBatch(
        tasks: readonly SigningTask[],
        keyPair: ParallelSignerKeyPair,
    ): Promise<ParallelSigningResult>;
    preserveWorkers(): void;
    releaseWorkers(): void;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    readonly workerCount: number;
    readonly idleWorkerCount: number;
    readonly busyWorkerCount: number;
    readonly isPreservingWorkers: boolean;
}
```

---

## Platform Support

| Platform | Pool class | Threading | ECC library |
|----------|-----------|-----------|-------------|
| Node.js | `NodeWorkerSigningPool` | `worker_threads` (true parallelism) | `tiny-secp256k1` (WASM) or `@noble/secp256k1` (JS) |
| Browser | `WorkerSigningPool` | Web Workers via Blob URL | `@noble/secp256k1` bundled inline |
| React Native | `WorkletSigningPool` | `react-native-worklets` runtimes (true parallelism) | `@noble/secp256k1` bundled inline (eval'd per runtime) |
| React Native (fallback) | `SequentialSigningPool` | None (main thread) | `EccContext` library |

### Entry Points

The library provides platform-specific entry points that avoid importing unused platform modules:

| Entry point | File | `detectRuntime()` | `createSigningPool()` |
|-------------|------|-------------------|----------------------|
| Generic | `index.ts` | Auto-detects | Dynamic import based on runtime (uses `SequentialSigningPool` for React Native) |
| Node.js | `index.node.ts` | Always `'node'` | Creates `NodeWorkerSigningPool` |
| Browser | `index.browser.ts` | Always `'browser'` | Creates `WorkerSigningPool` |
| React Native | `index.react-native.ts` | Always `'react-native'` | Tries `WorkletSigningPool`, falls back to `SequentialSigningPool` |

The generic entry point uses dynamic `import()` to load only the platform-relevant pool class, preventing bundler issues (e.g., browser bundlers will not encounter `worker_threads` imports).

---

## Complete Workflow Example

A full example of parallel PSBT signing from pool creation to transaction extraction.

```typescript
import { Psbt, networks } from '@btc-vision/bitcoin';
import {
    signPsbtParallel,
    createSigningPool,
    SignatureType,
    type PsbtParallelKeyPair,
    type SigningPoolLike,
} from '@btc-vision/bitcoin/workers';

// 1. Create a key pair that implements PsbtParallelKeyPair
const keyPair: PsbtParallelKeyPair = {
    publicKey: myCompressedPublicKey, // Uint8Array, 33 bytes
    getPrivateKey(): Uint8Array {
        return myPrivateKeyBytes; // Uint8Array, 32 bytes
    },
};

// 2. Create and configure the signing pool (auto-detects runtime)
const pool: SigningPoolLike = await createSigningPool({ workerCount: 4 });
pool.preserveWorkers(); // Keep workers alive for multiple operations

// 3. Build a PSBT
const psbt = new Psbt({ network: networks.bitcoin });

psbt.addInput({
    hash: 'previous_txid...',
    index: 0,
    witnessUtxo: {
        script: outputScript,
        value: 100000n,
    },
});

psbt.addOutput({
    address: 'bc1q...',
    value: 90000n,
});

// 4. Sign all matching Taproot inputs in parallel
//    (Legacy/SegWit inputs are not supported -- sign those separately)
const result = await signPsbtParallel(psbt, keyPair, pool, {
    sighashTypes: [0x01], // SIGHASH_ALL
    lowR: true,
});

// 5. Check results
if (result.success) {
    console.log(`Signed ${result.signatures.size} inputs in ${result.durationMs}ms`);

    // 6. Finalize and extract
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    console.log('Transaction hex:', tx.toHex());
} else {
    for (const [inputIndex, error] of result.errors) {
        console.error(`Input ${inputIndex} failed: ${error}`);
    }
}

// 7. Shutdown pool when application is done
await pool.shutdown();
```

### Lower-Level Usage (Manual Tasks)

For more control, use `prepareSigningTasks()`, `signBatch()`, and `applySignaturesToPsbt()` individually.

```typescript
import {
    prepareSigningTasks,
    applySignaturesToPsbt,
    WorkerSigningPool,
} from '@btc-vision/bitcoin/workers';

const pool = WorkerSigningPool.getInstance({ workerCount: 8 });
await pool.initialize();
pool.preserveWorkers();

// Manually prepare tasks (only Taproot inputs will be included)
const tasks = prepareSigningTasks(psbt, keyPair, { lowR: true });
console.log(`Prepared ${tasks.length} signing tasks`);

// Sign in parallel
const result = await pool.signBatch(tasks, keyPair);

// Apply signatures manually
if (result.success) {
    applySignaturesToPsbt(psbt, result, keyPair);
}

await pool.shutdown();
```

### Using `await using` for Automatic Cleanup

All pool classes implement `AsyncDisposable`, enabling automatic cleanup.

```typescript
{
    await using pool = await createSigningPool({ workerCount: 4 });
    pool.preserveWorkers();

    const result = await signPsbtParallel(psbt, keyPair, pool);
    // Pool is automatically shut down when leaving the block
}
```

---

## Performance Considerations

### When Parallel Signing Helps

Parallel signing provides the most benefit when a PSBT has many inputs. The overhead of spawning workers and distributing tasks means that for a single input, sequential signing on the main thread is faster.

| Inputs | Recommended approach |
|--------|---------------------|
| 1-2 | Sequential signing (standard `psbt.signInput()`) |
| 3-10 | Parallel signing with 2-4 workers |
| 10-100+ | Parallel signing with workers equal to CPU core count |

### Worker Preservation

Creating and initializing workers has a measurable startup cost (ECC library loading, message round-trips). For applications that sign multiple transactions:

```typescript
// DO: Initialize once, sign many times
const pool = await createSigningPool();
pool.preserveWorkers();

for (const psbt of psbtsToSign) {
    await signPsbtParallel(psbt, keyPair, pool);
}

await pool.shutdown();

// DON'T: Create and destroy for each transaction
for (const psbt of psbtsToSign) {
    await signPsbtParallel(psbt, keyPair, { workerCount: 4 }); // Slow!
}
```

### Batch Signing Efficiency

The `signBatch` message type sends multiple tasks with a single private key to one worker. This is more efficient than sending individual `sign` messages because:
1. The private key is transferred once instead of per-task.
2. A single response message carries all results.
3. The private key is zeroed once after all tasks complete.

Tasks are distributed across workers using round-robin assignment: `taskBatches[i % workerCount]`.

### Node.js Zero-Copy Transfer

The `NodeWorkerSigningPool` uses `ArrayBuffer` transfer lists with `postMessage()` to avoid copying private keys and hashes between threads. The transferred buffers become detached in the main thread (inaccessible), which also serves as an additional security measure since the key bytes are no longer readable in the sending context.

### Key Hold Time Safety

The `maxKeyHoldTimeMs` configuration (default 5 seconds) acts as a safety net. If a worker takes longer than this to complete a signing batch, it is forcefully terminated and replaced with a new worker. This prevents a stalled or compromised worker from holding key material indefinitely.
