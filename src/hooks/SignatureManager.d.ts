/// <reference types="node" />
export interface CacheEntry {
    length: number;
    dataRef: WeakRef<Buffer>;
    signature: Buffer;
}
export declare class SignatureManager {
    /**
     * Map to index cache entries by buffer length.
     * Key: Buffer length
     * Value: Set of CacheEntries with that buffer length
     */
    private cacheByLength;
    /**
     * FinalizationRegistry to clean up cache entries when their data buffers are garbage collected.
     */
    private registry;
    constructor();
    /**
     * Adds (caches) the signature for the given data buffer.
     * @param data The data buffer.
     * @param signature The signature buffer.
     */
    addSignature(data: Buffer, signature: Buffer): Buffer;
    /**
     * Retrieves the signature for the given data buffer.
     * @param data The data buffer.
     * @returns The signature buffer if found; otherwise, undefined.
     */
    getSignature(data: Buffer): Buffer | undefined;
    /**
     * Use with caution as it removes all cached signatures.
     */
    clearCache(): void;
}
