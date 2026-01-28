/**
 * Browser-safe utilities for tests that need crypto.randomBytes().
 */

/**
 * Browser-safe replacement for Node.js `crypto.randomBytes()`.
 * Uses the Web Crypto API (`crypto.getRandomValues()`).
 */
export function randomBytes(size: number): Uint8Array {
    const buf = new Uint8Array(size);
    globalThis.crypto.getRandomValues(buf);
    return buf;
}
