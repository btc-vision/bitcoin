'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.AdvancedSignatureManager = void 0;
class AdvancedSignatureManager {
    static instance;
    /**
     * Map to index cache entries by signer public key.
     * Key: Public Key (string)
     * Value: Set of CacheEntries
     */
    cacheBySigner = new Map();
    /**
     * FinalizationRegistry to clean up cache entries when their data buffers are garbage collected.
     */
    registry;
    constructor() {
        this.registry = new FinalizationRegistry(entry => {
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
    static getInstance() {
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
    addSignature(pubKey, data, signature) {
        const entry = {
            pubKey,
            dataRef: new WeakRef(data),
            signature,
        };
        if (!this.cacheBySigner.has(pubKey)) {
            this.cacheBySigner.set(pubKey, new Set());
        }
        const set = this.cacheBySigner.get(pubKey);
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
    getSignature(pubKey, data) {
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
    clearCache() {
        this.cacheBySigner.clear();
    }
    /**
     * Clears the cache for a specific signer.
     * @param pubKey The signer's public key.
     */
    clearCacheForSigner(pubKey) {
        this.cacheBySigner.delete(pubKey);
    }
}
exports.AdvancedSignatureManager = AdvancedSignatureManager;
