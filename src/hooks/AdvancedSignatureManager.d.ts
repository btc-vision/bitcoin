/// <reference types="node" />
export interface CacheEntry {
    pubKey: string;
    dataRef: WeakRef<Buffer>;
    signature: Buffer;
}
export declare class AdvancedSignatureManager {
    private static instance;
    /**
     * Map to index cache entries by signer public key.
     * Key: Public Key (string)
     * Value: Set of CacheEntries
     */
    private cacheBySigner;
    /**
     * FinalizationRegistry to clean up cache entries when their data buffers are garbage collected.
     */
    private registry;
    private constructor();
    static getInstance(): AdvancedSignatureManager;
    /**
     * Adds (caches) the signature for the given data buffer and signer public key.
     * @param pubKey The signer's public key.
     * @param data The data buffer.
     * @param signature The signature buffer.
     */
    addSignature(pubKey: string, data: Buffer, signature: Buffer): Buffer;
    /**
     * Retrieves the signature for the given data buffer and signer public key.
     * @param pubKey The signer's public key.
     * @param data The data buffer.
     * @returns The signature buffer if found; otherwise, undefined.
     */
    getSignature(pubKey: string, data: Buffer): Buffer | undefined;
    /**
     * Use with caution as it removes all cached signatures for all signers.
     */
    clearCache(): void;
    /**
     * Clears the cache for a specific signer.
     * @param pubKey The signer's public key.
     */
    clearCacheForSigner(pubKey: string): void;
}
