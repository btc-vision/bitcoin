# ECC (Elliptic Curve Cryptography) Support

The ECC module provides dependency injection for the secp256k1 elliptic curve library required by Bitcoin operations including Taproot (BIP 340/BIP 341), ECDSA signing, and public key derivation. Rather than hard-coding a specific cryptographic library, the module lets you plug in any backend that satisfies the `CryptoBackend` interface.

## Overview

| Property | Value |
|----------|-------|
| Curve | secp256k1 |
| Module path | `@btc-vision/bitcoin` (re-exported from `@btc-vision/ecpair`) |
| Pattern | Dependency injection via singleton context |
| Canonical interface | `CryptoBackend` |
| Legacy alias | `EccLib` (deprecated) |
| Available backends | `NobleBackend` (pure JS), `LegacyBackend` (wraps `tiny-secp256k1`) — provided by `@btc-vision/ecpair` |

### Architecture

```
@btc-vision/bitcoin
  src/ecc/
    types.ts      - Re-exports CryptoBackend, EccLib, XOnlyPointAddTweakResult (Parity is internal only)
    context.ts    - EccContext class, initEccLib(), getEccLib()
    index.ts      - Barrel exports
  src/pubkey.ts   - Public key utilities (toXOnly, decompressPublicKey, pubkeysMatch)
```

---

## Installation and Quick Start

```typescript
import { initEccLib, getEccLib, EccContext } from '@btc-vision/bitcoin';
import { createNobleBackend } from '@btc-vision/ecpair';

// 1. Initialize once at application startup
initEccLib(createNobleBackend());

// 2. Use anywhere in your codebase
const ecc = getEccLib();
const isValid = ecc.isPoint(somePublicKey);

// 3. (Optional) Clear when done, e.g. in test teardown
initEccLib(undefined);
```

---

## Class: EccContext

The `EccContext` class manages the ECC library instance using a private singleton pattern. The constructor is private; all interaction happens through static methods.

```typescript
class EccContext {
    // Private constructor - cannot be instantiated directly
    private constructor(lib: CryptoBackend);

    // The underlying CryptoBackend instance
    get lib(): CryptoBackend;

    // Static lifecycle methods
    static init(lib: CryptoBackend): EccContext;
    static get(): EccContext;
    static clear(): void;
    static isInitialized(): boolean;
}
```

### EccContext.init()

Initializes the ECC context with the provided `CryptoBackend`. The library is verified via `verifyCryptoBackend()` before being stored. If the same library instance is already initialized, verification is skipped and the existing context is returned.

```typescript
import { EccContext } from '@btc-vision/bitcoin';
import { createNobleBackend } from '@btc-vision/ecpair';

const context = EccContext.init(createNobleBackend());
// context.lib is now the verified NobleBackend instance
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `lib` | `CryptoBackend` | The secp256k1 backend to initialize |
| **Returns** | `EccContext` | The initialized context instance |
| **Throws** | `Error` | If the backend fails known-answer verification tests |

### EccContext.get()

Returns the initialized `EccContext` instance. Throws if the context has not been initialized.

```typescript
import { EccContext } from '@btc-vision/bitcoin';

const context = EccContext.get();
const tweaked = context.lib.xOnlyPointAddTweak(pubkey, tweak);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| **Returns** | `EccContext` | The current context instance |
| **Throws** | `Error` | `'ECC library not initialized. Call EccContext.init() or initEccLib() first.'` |

### EccContext.clear()

Clears the singleton instance, resetting the context to an uninitialized state. Useful for test teardown or reinitializing with a different backend.

```typescript
EccContext.clear();
// EccContext.isInitialized() === false
```

### EccContext.isInitialized()

Returns `true` if the ECC context has been initialized, `false` otherwise.

```typescript
if (!EccContext.isInitialized()) {
    EccContext.init(createNobleBackend());
}
```

---

## Convenience Functions

### initEccLib()

A convenience wrapper around `EccContext.init()` and `EccContext.clear()`. Pass a `CryptoBackend` to initialize, or `undefined` to clear.

```typescript
import { initEccLib } from '@btc-vision/bitcoin';
import { createNobleBackend } from '@btc-vision/ecpair';

// Initialize
initEccLib(createNobleBackend());

// Clear
initEccLib(undefined);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `eccLib` | `CryptoBackend \| undefined` | Backend to set, or `undefined` to clear |
| **Returns** | `void` | |
| **Throws** | `Error` | If the backend fails verification |

### getEccLib()

A convenience wrapper around `EccContext.get().lib`. Returns the raw `CryptoBackend` instance directly.

```typescript
import { getEccLib } from '@btc-vision/bitcoin';

const ecc = getEccLib();
const pubkey = ecc.pointFromScalar(privateKey);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| **Returns** | `CryptoBackend` | The initialized backend |
| **Throws** | `Error` | If the ECC library has not been initialized |

---

## CryptoBackend Interface

The `CryptoBackend` interface (from `@btc-vision/ecpair`) defines the low-level secp256k1 operations required by the library. Any object implementing all required methods can be used as a backend.

```typescript
interface CryptoBackend {
    // Validation
    isPrivate(d: Uint8Array): boolean;
    isPoint(p: Uint8Array): boolean;
    isXOnlyPoint(p: Uint8Array): boolean;

    // Point operations
    pointFromScalar(d: PrivateKey, compressed?: boolean): PublicKey | null;
    pointCompress(p: PublicKey, compressed?: boolean): PublicKey;
    pointAddScalar(p: PublicKey, tweak: Bytes32, compressed?: boolean): PublicKey | null;
    xOnlyPointAddTweak(p: XOnlyPublicKey, tweak: Bytes32): XOnlyPointAddTweakResult | null;

    // Scalar operations
    privateAdd(d: PrivateKey, tweak: Bytes32): PrivateKey | null;
    privateNegate(d: PrivateKey): PrivateKey;

    // ECDSA
    sign(hash: MessageHash, privateKey: PrivateKey, extraEntropy?: Uint8Array): Signature;
    verify(hash: MessageHash, publicKey: PublicKey, signature: Signature): boolean;

    // Schnorr (BIP 340) - optional
    signSchnorr?(hash: MessageHash, privateKey: PrivateKey, extraEntropy?: Uint8Array): SchnorrSignature;
    verifySchnorr?(hash: MessageHash, publicKey: XOnlyPublicKey, signature: SchnorrSignature): boolean;
}
```

### Required Methods

| Method | Parameters | Returns | Description |
|--------|-----------|---------|-------------|
| `isPrivate` | `d: Uint8Array` | `boolean` | Returns `true` if `d` is a valid 32-byte secp256k1 private key (in range `[1, n)`) |
| `isPoint` | `p: Uint8Array` | `boolean` | Returns `true` if `p` is a valid SEC1-encoded secp256k1 point (33 or 65 bytes) |
| `isXOnlyPoint` | `p: Uint8Array` | `boolean` | Returns `true` if `p` is a valid 32-byte x-only public key on the curve |
| `pointFromScalar` | `d: PrivateKey, compressed?: boolean` | `PublicKey \| null` | Derives the public key for a private key scalar. Returns `null` if `d` is invalid |
| `pointCompress` | `p: PublicKey, compressed?: boolean` | `PublicKey` | Re-encodes a public key in compressed (33 bytes) or uncompressed (65 bytes) form |
| `pointAddScalar` | `p: PublicKey, tweak: Bytes32, compressed?: boolean` | `PublicKey \| null` | Adds a scalar tweak to a public key point (`P + tweak*G`). Returns `null` if result is point at infinity |
| `xOnlyPointAddTweak` | `p: XOnlyPublicKey, tweak: Bytes32` | `XOnlyPointAddTweakResult \| null` | Adds a scalar tweak to an x-only public key, returning the result with Y parity. Returns `null` on failure |
| `privateAdd` | `d: PrivateKey, tweak: Bytes32` | `PrivateKey \| null` | Adds two scalars modulo the curve order (`(d + tweak) mod n`). Returns `null` if result is zero |
| `privateNegate` | `d: PrivateKey` | `PrivateKey` | Negates a private key scalar modulo the curve order (`n - d`) |
| `sign` | `hash: MessageHash, privateKey: PrivateKey, extraEntropy?: Uint8Array` | `Signature` | Produces a DER-encoded ECDSA signature (8-73 bytes) |
| `verify` | `hash: MessageHash, publicKey: PublicKey, signature: Signature` | `boolean` | Verifies a DER-encoded ECDSA signature |

### Optional Methods (Schnorr / BIP 340)

| Method | Parameters | Returns | Description |
|--------|-----------|---------|-------------|
| `signSchnorr?` | `hash: MessageHash, privateKey: PrivateKey, extraEntropy?: Uint8Array` | `SchnorrSignature` | Produces a 64-byte BIP 340 Schnorr signature. Omitting causes `signSchnorr` to throw at runtime |
| `verifySchnorr?` | `hash: MessageHash, publicKey: XOnlyPublicKey, signature: SchnorrSignature` | `boolean` | Verifies a 64-byte BIP 340 Schnorr signature. Omitting causes `verifySchnorr` to throw at runtime |

---

## Type Definitions

### EccLib (Deprecated Alias)

```typescript
// @deprecated - Use CryptoBackend instead
type EccLib = CryptoBackend;
```

`EccLib` is a legacy type alias for `CryptoBackend`, kept for backward compatibility. New code should use `CryptoBackend` directly.

### XOnlyPointAddTweakResult

Returned by `CryptoBackend.xOnlyPointAddTweak()` on success. Contains the resulting x-only public key and the parity of its Y coordinate.

```typescript
interface XOnlyPointAddTweakResult {
    /** Parity of the resulting point's Y coordinate. */
    readonly parity: Parity;
    /** 32-byte x-only public key of the tweaked point. */
    readonly xOnlyPubkey: XOnlyPublicKey;
}
```

### Parity

```typescript
type Parity = 0 | 1;
```

Y-coordinate parity of a point on the secp256k1 curve: `0` means even Y, `1` means odd Y. Used in Taproot key tweaking and BIP 340.

> **Note:** `Parity` is NOT re-exported from the main `@btc-vision/bitcoin` entry point. It is defined in `@btc-vision/ecpair` and used internally. Use the literal type `0 | 1` in consumer code.

### Branded Types (from `@btc-vision/ecpair`)

The library uses branded types to prevent accidental misuse of structurally identical `Uint8Array` values.

| Type | Underlying | Description |
|------|-----------|-------------|
| `PrivateKey` | `Uint8Array` (32 bytes) | Valid secp256k1 scalar in range `[1, n)` |
| `PublicKey` | `Uint8Array` (33 or 65 bytes) | SEC1-encoded secp256k1 point |
| `XOnlyPublicKey` | `Uint8Array` (32 bytes) | BIP 340 x-only public key |
| `Bytes32` | `Uint8Array` (32 bytes) | Generic 32-byte array |
| `MessageHash` | `Uint8Array` (32 bytes) | 32-byte hash to be signed |
| `Signature` | `Uint8Array` (8-73 bytes) | DER-encoded ECDSA signature |
| `SchnorrSignature` | `Uint8Array` (64 bytes) | BIP 340 Schnorr signature |

---

## Public Key Utilities (`pubkey.ts`)

The `pubkey.ts` module provides utility functions for manipulating Bitcoin public keys, including conversion between compressed, uncompressed, hybrid, and x-only formats.

```typescript
import { toXOnly, decompressPublicKey, pubkeysMatch } from '@btc-vision/bitcoin';
```

### toXOnly()

Converts a public key to 32-byte x-only format by stripping the prefix byte. If the input is already 32 bytes (x-only), it is returned as-is. For 33-byte (compressed) or 65-byte (uncompressed) keys, the first byte is stripped and only the 32-byte x-coordinate is returned.

```typescript
const toXOnly = (pubKey: PublicKey | XOnlyPublicKey): XOnlyPublicKey;
```

```typescript
import { toXOnly } from '@btc-vision/bitcoin';

// From a 33-byte compressed public key (0x02 or 0x03 prefix)
const compressed = new Uint8Array(33); // 0x02 + 32 bytes x
const xOnly = toXOnly(compressed);
// xOnly.length === 32 (just the x-coordinate)

// Already x-only (32 bytes) - returned unchanged
const already = new Uint8Array(32);
const same = toXOnly(already);
// same === already
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `pubKey` | `PublicKey \| XOnlyPublicKey` | 32, 33, or 65-byte public key |
| **Returns** | `XOnlyPublicKey` | 32-byte x-only public key |

### UncompressedPublicKey Interface

Returned by `decompressPublicKey()`. Contains both the hybrid and standard uncompressed encodings of a public key.

```typescript
interface UncompressedPublicKey {
    /** 65-byte hybrid public key (prefix 0x06 for even Y, 0x07 for odd Y) */
    hybrid: Uint8Array;
    /** 65-byte uncompressed public key (prefix 0x04) */
    uncompressed: Uint8Array;
}
```

### decompressPublicKey()

Converts a compressed (33-byte) or uncompressed (65-byte) public key to both its hybrid form (prefix `0x06`/`0x07`) and standard uncompressed form (prefix `0x04`). Returns `undefined` for 32-byte x-only keys or invalid lengths.

```typescript
function decompressPublicKey(realPubKey: PublicKey): UncompressedPublicKey | undefined;
```

```typescript
import { decompressPublicKey } from '@btc-vision/bitcoin';

const compressed = getCompressedPubKey(); // 33-byte key with 0x02 or 0x03 prefix
const result = decompressPublicKey(compressed);

if (result) {
    console.log(result.uncompressed.length); // 65, prefix 0x04
    console.log(result.hybrid.length);       // 65, prefix 0x06 or 0x07
    console.log(result.hybrid[0]);           // 0x06 (even Y) or 0x07 (odd Y)
}

// x-only keys return undefined
const xonly = new Uint8Array(32);
decompressPublicKey(xonly); // undefined
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `realPubKey` | `PublicKey` | 33-byte compressed or 65-byte uncompressed key |
| **Returns** | `UncompressedPublicKey \| undefined` | Both hybrid and uncompressed forms, or `undefined` for x-only / invalid lengths |
| **Throws** | `Error` | `'Invalid secp256k1 public key bytes. Cannot parse.'` if the key bytes are not a valid curve point |

### Hybrid Key Prefix Encoding

| Y Parity | Standard Prefix | Hybrid Prefix |
|-----------|----------------|---------------|
| Even | `0x02` (compressed) / `0x04` (uncompressed) | `0x06` |
| Odd | `0x03` (compressed) / `0x04` (uncompressed) | `0x07` |

### pubkeysMatch()

Compares two public key `Uint8Array` values for equality. For 65-byte keys, hybrid prefixes (`0x06`/`0x07`) are treated as equivalent to the uncompressed prefix (`0x04`), so a hybrid-encoded key will match its uncompressed counterpart.

```typescript
function pubkeysMatch(a: Uint8Array, b: Uint8Array): boolean;
```

```typescript
import { pubkeysMatch } from '@btc-vision/bitcoin';

// Exact match
pubkeysMatch(keyA, keyA); // true

// Hybrid vs uncompressed match (same x,y but different prefix byte)
const uncompressed = new Uint8Array([0x04, ...xBytes, ...yBytes]);
const hybrid =       new Uint8Array([0x06, ...xBytes, ...yBytes]);
pubkeysMatch(uncompressed, hybrid); // true

// Different keys
pubkeysMatch(keyA, keyB); // false
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `a` | `Uint8Array` | First public key |
| `b` | `Uint8Array` | Second public key |
| **Returns** | `boolean` | `true` if keys represent the same point |

### bigIntTo32Bytes()

Internal utility that converts a `bigint` to a zero-padded 32-byte `Uint8Array`. Used by `decompressPublicKey()` to serialize point coordinates.

> **Note:** This function is NOT re-exported from the main `@btc-vision/bitcoin` entry point. It is an internal utility in `src/pubkey.ts`.

```typescript
function bigIntTo32Bytes(num: bigint): Uint8Array;
```

---

## Backend Setup

### Option 1: Noble Backend (Recommended)

Pure JavaScript implementation backed by `@noble/curves/secp256k1`. No native dependencies, works in all environments.

```typescript
import { initEccLib } from '@btc-vision/bitcoin';
import { createNobleBackend } from '@btc-vision/ecpair';

initEccLib(createNobleBackend());
```

### Option 2: Legacy Backend (tiny-secp256k1)

Wraps an existing `tiny-secp256k1` installation (or any compatible library) via the `TinySecp256k1Interface` adapter.

```typescript
import { initEccLib } from '@btc-vision/bitcoin';
import { createLegacyBackend } from '@btc-vision/ecpair';
import * as tinysecp from 'tiny-secp256k1';

initEccLib(createLegacyBackend(tinysecp));
```

### Option 3: Custom Backend

Any object implementing all required `CryptoBackend` methods can be used. The library verifies the backend against known-answer test vectors during initialization.

```typescript
import { initEccLib } from '@btc-vision/bitcoin';
import type { CryptoBackend } from '@btc-vision/ecpair';

const customBackend: CryptoBackend = {
    isPrivate(d) { /* ... */ },
    isPoint(p) { /* ... */ },
    isXOnlyPoint(p) { /* ... */ },
    pointFromScalar(d, compressed) { /* ... */ },
    pointCompress(p, compressed) { /* ... */ },
    pointAddScalar(p, tweak, compressed) { /* ... */ },
    xOnlyPointAddTweak(p, tweak) { /* ... */ },
    privateAdd(d, tweak) { /* ... */ },
    privateNegate(d) { /* ... */ },
    sign(hash, privateKey, extraEntropy) { /* ... */ },
    verify(hash, publicKey, signature) { /* ... */ },
    // Optional Schnorr methods
    signSchnorr(hash, privateKey, extraEntropy) { /* ... */ },
    verifySchnorr(hash, publicKey, signature) { /* ... */ },
};

initEccLib(customBackend); // Runs verifyCryptoBackend() internally
```

### Backend Comparison

| Aspect | `NobleBackend` | `LegacyBackend` |
|--------|---------------|-----------------|
| Package | `@btc-vision/ecpair` (built-in) | `@btc-vision/ecpair` + `tiny-secp256k1` |
| Dependencies | `@noble/curves` (pure JS) | `tiny-secp256k1` (native/WASM) |
| Schnorr support | Always available | Depends on `tiny-secp256k1` version |
| Construction | `createNobleBackend()` | `createLegacyBackend(tinysecp)` |
| Environment | Browser, Node.js, Workers | Node.js (native), Browser (WASM build) |

---

## Verification

When `EccContext.init()` or `initEccLib()` is called, the backend is validated by `verifyCryptoBackend()` from `@btc-vision/ecpair`. This function runs a comprehensive suite of known-answer tests to verify correctness before the backend is accepted. If any test vector fails, an error is thrown and the backend is not stored.

```typescript
import { verifyCryptoBackend } from '@btc-vision/ecpair';

// Manual verification (rarely needed - initEccLib does this automatically)
const backend = createNobleBackend();
verifyCryptoBackend(backend); // throws if broken
```

---

## Complete Examples

### Taproot Key Tweaking

```typescript
import { initEccLib, getEccLib, toXOnly } from '@btc-vision/bitcoin';
import { createNobleBackend, createBytes32, createXOnlyPublicKey } from '@btc-vision/ecpair';

// Initialize the ECC library
initEccLib(createNobleBackend());
const ecc = getEccLib();

// Get x-only public key from a compressed key
const compressedPubKey = getPublicKey(); // 33-byte compressed key
const xOnlyPubKey = toXOnly(compressedPubKey);

// Tweak the x-only key (used in Taproot)
const tweak = createBytes32(computeTapTweak(xOnlyPubKey, merkleRoot));
const result = ecc.xOnlyPointAddTweak(
    createXOnlyPublicKey(xOnlyPubKey),
    tweak,
);

if (result) {
    console.log('Tweaked key:', result.xOnlyPubkey); // 32-byte x-only
    console.log('Parity:', result.parity);           // 0 or 1
}
```

### ECDSA Signing and Verification

```typescript
import { initEccLib, getEccLib } from '@btc-vision/bitcoin';
import {
    createNobleBackend,
    createMessageHash,
    createPrivateKey,
} from '@btc-vision/ecpair';

initEccLib(createNobleBackend());
const ecc = getEccLib();

// Sign
const hash = createMessageHash(sha256(message));
const privKey = createPrivateKey(keyBytes);
const signature = ecc.sign(hash, privKey);

// Derive public key
const pubKey = ecc.pointFromScalar(privKey);
if (pubKey) {
    // Verify
    const isValid = ecc.verify(hash, pubKey, signature);
    console.log('Valid:', isValid); // true
}
```

### Decompressing and Comparing Public Keys

```typescript
import { decompressPublicKey, pubkeysMatch, toXOnly } from '@btc-vision/bitcoin';

// Decompress a key to get hybrid and uncompressed forms
const compressed = getCompressedPubKey(); // 33 bytes
const result = decompressPublicKey(compressed);

if (result) {
    // The hybrid and uncompressed forms match (same point, different prefix)
    pubkeysMatch(result.hybrid, result.uncompressed); // true

    // Extract x-only from any form
    const xFromCompressed = toXOnly(compressed);
    // xFromCompressed is 32 bytes (the x-coordinate)
}
```

### Testing with Context Lifecycle

```typescript
import { EccContext, initEccLib } from '@btc-vision/bitcoin';
import { createNobleBackend } from '@btc-vision/ecpair';

describe('my taproot tests', () => {
    beforeAll(() => {
        initEccLib(createNobleBackend());
    });

    afterAll(() => {
        initEccLib(undefined); // or EccContext.clear()
    });

    it('should check initialization', () => {
        expect(EccContext.isInitialized()).toBe(true);

        const ecc = EccContext.get().lib;
        expect(ecc.isPoint(validPubKey)).toBe(true);
    });
});
```

---

## Error Handling

| Scenario | Error Message |
|----------|--------------|
| Calling `getEccLib()` or `EccContext.get()` before initialization | `'ECC library not initialized. Call EccContext.init() or initEccLib() first.'` |
| Backend fails verification during `initEccLib()` or `EccContext.init()` | Error thrown by `verifyCryptoBackend()` with details about which test vector failed |
| `decompressPublicKey()` with invalid curve point bytes | `'Invalid secp256k1 public key bytes. Cannot parse.'` |
| `decompressPublicKey()` with unsupported key length (not 32, 33, or 65) | Logs a warning and returns `undefined` |
