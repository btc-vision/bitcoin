export interface CacheEntry {
    pubKey: string;
    dataRef: WeakRef<Buffer>;
    signature: Buffer;
}

export class AdvancedSignatureManager {
    private static instance: AdvancedSignatureManager;

    /**
     * Map to index cache entries by signer public key.
     * Key: Public Key (string)
     * Value: Set of CacheEntries
     */
    private cacheBySigner: Map<string, Set<CacheEntry>> = new Map();

    /**
     * FinalizationRegistry to clean up cache entries when their data buffers are garbage collected.
     */
    private registry: FinalizationRegistry<CacheEntry>;

    private constructor() {
        this.registry = new FinalizationRegistry((entry: CacheEntry) => {
            // Remove the entry directly using its pubKey
            const set = this.cacheBySigner.get(entry.pubKey);
            if (set) {
                set.delete(entry);

                // Clean up the set if it's empty
                if (set.size === 0) {
                    this.cacheBySigner.delete(entry.pubKey);
                }
            }
        });
    }

    // Singleton instance accessor
    public static getInstance(): AdvancedSignatureManager {
        if (!AdvancedSignatureManager.instance) {
            AdvancedSignatureManager.instance = new AdvancedSignatureManager();
        }
        return AdvancedSignatureManager.instance;
    }

    /**
     * Adds (caches) the signature for the given data buffer and signer public key.
     * @param pubKey The signer's public key.
     * @param data The data buffer.
     * @param signature The signature buffer.
     */
    public addSignature(
        pubKey: string,
        data: Buffer,
        signature: Buffer,
    ): Buffer {
        const entry: CacheEntry = {
            pubKey,
            dataRef: new WeakRef(data),
            signature,
        };

        if (!this.cacheBySigner.has(pubKey)) {
            this.cacheBySigner.set(pubKey, new Set<CacheEntry>());
        }

        const set = this.cacheBySigner.get(pubKey)!;
        set.add(entry);

        // Register the data buffer with the FinalizationRegistry.
        this.registry.register(data, entry);

        return signature;
    }

    /**
     * Retrieves the signature for the given data buffer and signer public key.
     * @param pubKey The signer's public key.
     * @param data The data buffer.
     * @returns The signature buffer if found; otherwise, undefined.
     */
    public getSignature(pubKey: string, data: Buffer): Buffer | undefined {
        const set = this.cacheBySigner.get(pubKey);
        if (!set) return undefined;

        for (const entry of set) {
            const cachedData = entry.dataRef.deref();
            if (cachedData && cachedData.equals(data)) {
                return entry.signature;
            }
        }
        return undefined;
    }

    /**
     * Use with caution as it removes all cached signatures for all signers.
     */
    public clearCache(): void {
        this.cacheBySigner.clear();
    }

    /**
     * Clears the cache for a specific signer.
     * @param pubKey The signer's public key.
     */
    public clearCacheForSigner(pubKey: string): void {
        this.cacheBySigner.delete(pubKey);
    }
}
