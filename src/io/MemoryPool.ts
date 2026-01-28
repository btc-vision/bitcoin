/**
 * Memory pool using SharedArrayBuffer for zero-allocation operations.
 *
 * Provides thread-safe memory allocation using Atomics for concurrent access.
 * Ideal for parsing operations where temporary buffers are needed.
 *
 * @packageDocumentation
 */

/**
 * Thread-safe memory pool using SharedArrayBuffer.
 *
 * Allocates memory from a pre-allocated SharedArrayBuffer pool,
 * eliminating garbage collection pressure from repeated allocations.
 *
 * Uses Atomics for thread-safe allocation when used with Workers.
 *
 * @example
 * ```typescript
 * import { MemoryPool } from '@btc-vision/bitcoin';
 *
 * // Create a 1MB pool
 * const pool = new MemoryPool(1024 * 1024);
 *
 * // Allocate memory for transaction parsing
 * const txBuffer = pool.alloc(500);
 * // ... use txBuffer ...
 *
 * // Reset pool when done (all allocations become invalid)
 * pool.reset();
 * ```
 */
export class MemoryPool {
    /**
     * The underlying SharedArrayBuffer.
     */
    readonly #buffer: SharedArrayBuffer;

    /**
     * View for data allocations.
     */
    readonly #data: Uint8Array;

    /**
     * Control array for atomic offset management.
     * Located at the end of the buffer.
     */
    readonly #control: Int32Array;

    /**
     * Maximum allocatable size (buffer size minus control bytes).
     */
    readonly #maxSize: number;

    /**
     * Creates a new MemoryPool.
     *
     * @param size - Size of the pool in bytes (default 4MB)
     *
     * @example
     * ```typescript
     * import { MemoryPool } from '@btc-vision/bitcoin';
     *
     * // 4MB pool (default)
     * const pool = new MemoryPool();
     *
     * // 16MB pool
     * const largePool = new MemoryPool(16 * 1024 * 1024);
     * ```
     */
    public constructor(size: number = 4 * 1024 * 1024) {
        // Add 4 bytes for atomic control (current offset)
        const totalSize = size + 4;
        this.#buffer = new SharedArrayBuffer(totalSize);
        this.#data = new Uint8Array(this.#buffer, 0, size);
        this.#control = new Int32Array(this.#buffer, size, 1);
        this.#maxSize = size;
    }

    /**
     * Creates a MemoryPool from an existing SharedArrayBuffer.
     *
     * Useful for sharing a pool between Workers.
     *
     * @param buffer - Existing SharedArrayBuffer
     * @returns A new MemoryPool instance wrapping the buffer
     *
     * @example
     * ```typescript
     * // Main thread
     * const pool = new MemoryPool(1024 * 1024);
     * worker.postMessage({ buffer: pool.sharedBuffer });
     *
     * // Worker thread
     * self.onmessage = (e) => {
     *     const pool = MemoryPool.fromSharedBuffer(e.data.buffer);
     *     const mem = pool.alloc(100);
     * };
     * ```
     */
    public static fromSharedBuffer(buffer: SharedArrayBuffer): MemoryPool {
        const pool = Object.create(MemoryPool.prototype) as MemoryPool;
        const size = buffer.byteLength - 4;

        // Use Object.defineProperty to set private fields on the created object
        Object.defineProperty(pool, '#buffer', { value: buffer });
        Object.defineProperty(pool, '#data', { value: new Uint8Array(buffer, 0, size) });
        Object.defineProperty(pool, '#control', { value: new Int32Array(buffer, size, 1) });
        Object.defineProperty(pool, '#maxSize', { value: size });

        return pool;
    }

    /**
     * Total capacity of the pool in bytes.
     */
    public get capacity(): number {
        return this.#maxSize;
    }

    /**
     * Current allocation offset (bytes used).
     *
     * Uses Atomics for thread-safe reading.
     */
    public get used(): number {
        return Atomics.load(this.#control, 0);
    }

    /**
     * Remaining available bytes.
     */
    public get available(): number {
        return this.#maxSize - this.used;
    }

    /**
     * The underlying SharedArrayBuffer.
     *
     * Can be transferred to Workers for shared memory access.
     */
    public get sharedBuffer(): SharedArrayBuffer {
        return this.#buffer;
    }

    /**
     * Allocates memory from the pool.
     *
     * Thread-safe using Atomics.add for concurrent access.
     *
     * @param size - Number of bytes to allocate
     * @returns Uint8Array view into the pool
     * @throws RangeError if pool is exhausted
     *
     * @example
     * ```typescript
     * const pool = new MemoryPool(1024);
     * const buf1 = pool.alloc(100); // First 100 bytes
     * const buf2 = pool.alloc(200); // Next 200 bytes
     * ```
     */
    public alloc(size: number): Uint8Array {
        if (size <= 0) {
            throw new RangeError('Allocation size must be positive');
        }

        // Atomically reserve space
        const oldOffset = Atomics.add(this.#control, 0, size);

        if (oldOffset + size > this.#maxSize) {
            // Undo the allocation
            Atomics.sub(this.#control, 0, size);
            throw new RangeError(
                `MemoryPool exhausted: requested ${size} bytes, only ${this.#maxSize - oldOffset} available`,
            );
        }

        return this.#data.subarray(oldOffset, oldOffset + size);
    }

    /**
     * Allocates memory and fills it with zeros.
     *
     * @param size - Number of bytes to allocate
     * @returns Uint8Array view into the pool, filled with zeros
     * @throws RangeError if pool is exhausted
     */
    public allocZeroed(size: number): Uint8Array {
        const mem = this.alloc(size);
        mem.fill(0);
        return mem;
    }

    /**
     * Allocates memory for a specific typed array.
     *
     * @param length - Number of elements
     * @param bytesPerElement - Size of each element in bytes
     * @returns Uint8Array view (use constructor of target type on underlying buffer)
     * @throws RangeError if pool is exhausted
     *
     * @example
     * ```typescript
     * const pool = new MemoryPool(1024);
     * const bytes = pool.allocTyped(10, 4); // 40 bytes for 10 Uint32
     * const u32View = new Uint32Array(bytes.buffer, bytes.byteOffset, 10);
     * ```
     */
    public allocTyped(length: number, bytesPerElement: number): Uint8Array {
        return this.alloc(length * bytesPerElement);
    }

    /**
     * Resets the pool, making all memory available again.
     *
     * WARNING: All previously allocated views become invalid.
     * Only call when you're sure no references are held.
     *
     * Thread-safe using Atomics.store.
     *
     * @example
     * ```typescript
     * const pool = new MemoryPool(1024);
     * const buf = pool.alloc(100);
     * // ... use buf ...
     * pool.reset(); // buf is now invalid!
     * ```
     */
    public reset(): void {
        Atomics.store(this.#control, 0, 0);
    }

    /**
     * Checks if the pool can accommodate an allocation.
     *
     * @param size - Number of bytes needed
     * @returns True if allocation would succeed
     */
    public canAlloc(size: number): boolean {
        return this.available >= size;
    }
}

/**
 * Non-shared memory pool using regular ArrayBuffer.
 *
 * Use when SharedArrayBuffer is not available (e.g., browsers without
 * proper COOP/COEP headers) or when thread-safety is not needed.
 *
 * @example
 * ```typescript
 * import { SimpleMemoryPool } from '@btc-vision/bitcoin';
 *
 * const pool = new SimpleMemoryPool(1024 * 1024);
 * const buf = pool.alloc(100);
 * ```
 */
export class SimpleMemoryPool {
    readonly #data: Uint8Array;
    #offset: number = 0;

    /**
     * Creates a new SimpleMemoryPool.
     *
     * @param size - Size of the pool in bytes
     */
    public constructor(size: number) {
        this.#data = new Uint8Array(size);
    }

    /**
     * Total capacity of the pool in bytes.
     */
    public get capacity(): number {
        return this.#data.length;
    }

    /**
     * Current allocation offset (bytes used).
     */
    public get used(): number {
        return this.#offset;
    }

    /**
     * Remaining available bytes.
     */
    public get available(): number {
        return this.#data.length - this.#offset;
    }

    /**
     * Allocates memory from the pool.
     *
     * @param size - Number of bytes to allocate
     * @returns Uint8Array view into the pool
     * @throws RangeError if pool is exhausted
     */
    public alloc(size: number): Uint8Array {
        if (size <= 0) {
            throw new RangeError('Allocation size must be positive');
        }

        if (this.#offset + size > this.#data.length) {
            throw new RangeError(
                `SimpleMemoryPool exhausted: requested ${size} bytes, only ${this.available} available`,
            );
        }

        const start = this.#offset;
        this.#offset += size;
        return this.#data.subarray(start, this.#offset);
    }

    /**
     * Allocates memory and fills it with zeros.
     *
     * @param size - Number of bytes to allocate
     * @returns Uint8Array view into the pool, filled with zeros
     */
    public allocZeroed(size: number): Uint8Array {
        const mem = this.alloc(size);
        mem.fill(0);
        return mem;
    }

    /**
     * Resets the pool, making all memory available again.
     */
    public reset(): void {
        this.#offset = 0;
    }

    /**
     * Checks if the pool can accommodate an allocation.
     *
     * @param size - Number of bytes needed
     * @returns True if allocation would succeed
     */
    public canAlloc(size: number): boolean {
        return this.available >= size;
    }
}
