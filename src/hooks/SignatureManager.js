'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.SignatureManager = void 0;
class SignatureManager {
    /**
     * Map to index cache entries by buffer length.
     * Key: Buffer length
     * Value: Set of CacheEntries with that buffer length
     */
    cacheByLength = new Map();
    /**
     * FinalizationRegistry to clean up cache entries when their data buffers are garbage collected.
     */
    registry;
    constructor() {
        this.registry = new FinalizationRegistry(entry => {
            const set = this.cacheByLength.get(entry.length);
            if (set) {
                set.delete(entry);
                // Clean up the set if it's empty
                if (set.size === 0) {
                    this.cacheByLength.delete(entry.length);
                }
            }
        });
    }
    /**
     * Adds (caches) the signature for the given data buffer.
     * @param data The data buffer.
     * @param signature The signature buffer.
     */
    addSignature(data, signature) {
        const length = data.length;
        const entry = {
            length,
            dataRef: new WeakRef(data),
            signature,
        };
        if (!this.cacheByLength.has(length)) {
            this.cacheByLength.set(length, new Set());
        }
        const set = this.cacheByLength.get(length);
        set.add(entry);
        // Register the data buffer with the FinalizationRegistry.
        this.registry.register(data, entry);
        return signature;
    }
    /**
     * Retrieves the signature for the given data buffer.
     * @param data The data buffer.
     * @returns The signature buffer if found; otherwise, undefined.
     */
    getSignature(data) {
        const length = data.length;
        const set = this.cacheByLength.get(length);
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
     * Use with caution as it removes all cached signatures.
     */
    clearCache() {
        this.cacheByLength.clear();
    }
}
exports.SignatureManager = SignatureManager;
