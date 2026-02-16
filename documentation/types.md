# Types - Branded Types, Type Guards, and Assertions

The type system in `@btc-vision/bitcoin` uses TypeScript branded types to provide compile-time safety for Bitcoin primitives that are structurally identical at runtime. A 32-byte `PrivateKey` and a 32-byte `MessageHash` are both `Uint8Array`, but the branding mechanism prevents one from being passed where the other is expected. Runtime type guards and assertion helpers complement these types by performing validation at boundaries where data enters the system.

## Overview

| Category | Purpose |
|----------|---------|
| Branded types | Nominal typing over `Uint8Array` and `bigint` to prevent accidental misuse of structurally identical values |
| Type guards | Runtime `is*()` functions returning `value is T` for safe narrowing |
| Assertion helpers | `assert*()` functions throwing `TypeError` / `RangeError` with descriptive messages |
| Conversion functions | `to*()` functions that validate and cast plain values into branded types |
| Stack types | Types representing Bitcoin script execution stack elements |
| Taptree types | Recursive types representing Taproot/P2MR script trees |
| Constants | Protocol-level numeric limits |
| Utilities | Helper functions for comparing stack arrays |

---

## Branded Types

Branded types use the `Brand<T, B>` utility to create nominal types from structural base types. The brand is a phantom property that exists only at the type level and has zero runtime cost.

```typescript
// The underlying branding mechanism (from @btc-vision/ecpair)
declare const __brand: unique symbol;
type Brand<T, B extends string> = T & {
    readonly [__brand]: B;
};
```

Because `__brand` is a `unique symbol`, TypeScript treats each branded type as distinct even though they share the same runtime representation. You cannot assign a `PrivateKey` to a `MessageHash` parameter without an explicit cast, despite both being 32-byte `Uint8Array` values at runtime.

### Branded Type Reference

| Type | Base | Size | Description |
|------|------|------|-------------|
| `Bytes32` | `Uint8Array` | 32 bytes | Generic 32-byte buffer. Used for transaction hashes, Merkle roots, and other 256-bit values. |
| `Bytes20` | `Uint8Array` | 20 bytes | Generic 20-byte buffer. Used for HASH160 results (RIPEMD160(SHA256(x))), P2PKH/P2SH hashes. |
| `PublicKey` | `Uint8Array` | 33 or 65 bytes | SEC1-encoded secp256k1 public key. 33 bytes compressed (prefix `0x02`/`0x03`) or 65 bytes uncompressed (prefix `0x04`/`0x06`/`0x07`). |
| `XOnlyPublicKey` | `Uint8Array` | 32 bytes | BIP 340 x-only public key for Taproot and Schnorr signatures. Must be non-zero and less than the secp256k1 field prime `p`. |
| `Satoshi` | `bigint` | N/A | Bitcoin amount in satoshis. Must be `>= 0n` and `<= 2_100_000_000_000_000n` (21 million BTC). |
| `PrivateKey` | `Uint8Array` | 32 bytes | secp256k1 private key scalar. Must be non-zero and less than the curve order `n`. |
| `Signature` | `Uint8Array` | 8-73 bytes | DER-encoded ECDSA signature. |
| `SchnorrSignature` | `Uint8Array` | 64 bytes | BIP 340 Schnorr signature. |
| `MessageHash` | `Uint8Array` | 32 bytes | 32-byte hash of the message being signed. Semantically distinct from `PrivateKey` and `Bytes32`. **Not exported from the main `@btc-vision/bitcoin` entry point.** Import from `@btc-vision/bitcoin/types` instead. |
| `Script` | `Uint8Array` | Variable | Bitcoin script bytecode. |

### Import

Most branded types are re-exported from the main entry point:

```typescript
import type {
    Bytes32,
    Bytes20,
    PublicKey,
    XOnlyPublicKey,
    Satoshi,
    PrivateKey,
    Signature,
    SchnorrSignature,
    Script,
} from '@btc-vision/bitcoin';
```

> **Note:** `MessageHash` is **not** re-exported from `@btc-vision/bitcoin`. Use the `@btc-vision/bitcoin/types` subpath:
>
> ```typescript
> import type { MessageHash } from '@btc-vision/bitcoin/types';
> ```

---

## Type Guard Functions

Type guards are runtime `is*()` functions that return a type predicate (`value is T`). They perform the minimum checks necessary to guarantee the branded type's invariants hold.

### Primitive Guards

> **Note:** The primitive guard functions listed below (`isUInt8`, `isUInt32`, `isNumber`, `isUint8Array`, `isUint8ArrayN`, `isArray`) are defined in `src/types.ts` but are **not re-exported from the main `@btc-vision/bitcoin` entry point**. To use them, import from the `@btc-vision/bitcoin/types` subpath.

| Function | Signature | Description |
|----------|-----------|-------------|
| `isUInt8` | `(value: unknown) => value is number` | True if `value` is an integer in `[0, 255]`. |
| `isUInt32` | `(value: unknown) => value is number` | True if `value` is an integer in `[0, 4_294_967_295]`. |
| `isNumber` | `(value: unknown) => value is number` | True if `value` is a finite number (excludes `NaN`, `Infinity`, `-Infinity`). |
| `isUint8Array` | `(value: unknown) => value is Uint8Array` | True if `value` is a `Uint8Array` instance. |
| `isUint8ArrayN` | `<N>(value: unknown, n: N) => value is Uint8Array & { readonly length: N }` | True if `value` is a `Uint8Array` of exactly `n` bytes. |
| `isArray` | `(value: unknown) => value is unknown[]` | True if `value` is an array (`Array.isArray`). |

```typescript
// These are NOT available from '@btc-vision/bitcoin'. Use the subpath:
import { isUInt8, isUInt32, isNumber, isUint8Array, isUint8ArrayN, isArray } from '@btc-vision/bitcoin/types';
```

### isHex

The `isHex` function exported from `@btc-vision/bitcoin` comes from `io/hex.ts` (not from `types.ts`). It has a different signature and behavior than the internal `types.ts` version:

| Function | Signature | Description |
|----------|-----------|-------------|
| `isHex` (exported, from `io/hex.ts`) | `(value: string) => boolean` | Returns `true` if `value` is a valid hex string of even length. **Strips `0x`/`0X` prefixes** before checking. Note: the parameter type is `string` (not `unknown`), and the return type is `boolean` (not a type guard predicate). |

```typescript
import { isHex } from '@btc-vision/bitcoin';

isHex('deadbeef');    // true
isHex('0xdeadbeef');  // true  (0x prefix is stripped before validation)
isHex('DEADBEEF');    // true
isHex('deadbee');     // false (odd length after stripping)
isHex('deadbeeg');    // false (invalid character)
```

> **Internal note:** `src/types.ts` also defines an `isHex` function with signature `(value: unknown) => value is string` that does **not** strip `0x` prefixes. This version is not re-exported from the main entry point; the `io/hex.ts` version takes precedence in `@btc-vision/bitcoin`.

### Branded Type Guards

| Function | Signature | Checks |
|----------|-----------|--------|
| `isBytes32` | `(value: unknown) => value is Bytes32` | `Uint8Array` with `length === 32`. |
| `isBytes20` | `(value: unknown) => value is Bytes20` | `Uint8Array` with `length === 20`. |
| `isXOnlyPublicKey` | `(value: unknown) => value is XOnlyPublicKey` | `Uint8Array` with `length === 32`, non-zero, and `< EC_P` (secp256k1 field prime). |
| `isPoint` | `(value: unknown) => value is PublicKey` | Valid SEC1-encoded point: compressed (33 bytes, prefix `0x02`/`0x03`) or uncompressed (65 bytes, prefix `0x04`/`0x06`/`0x07`), with x (and y if uncompressed) coordinates non-zero and `< EC_P`. |
| `isSatoshi` | `(value: unknown) => value is Satoshi` | `bigint` in range `[0n, SATOSHI_MAX]`. |
| `isPrivateKey` | `(value: unknown) => value is PrivateKey` | `Uint8Array` with `length === 32`, non-zero, and `< EC_N` (secp256k1 curve order). |
| `isSchnorrSignature` | `(value: unknown) => value is SchnorrSignature` | `Uint8Array` with `length === 64`. |
| `isSignature` | `(value: unknown) => value is Signature` | `Uint8Array` with `length` in `[8, 73]` (DER-encoded ECDSA range). |
| `isScript` | `(value: unknown) => value is Script` | `Uint8Array` instance (any length). |

> **Note:** `isMessageHash` is **not exported from the main `@btc-vision/bitcoin` entry point**. Import from the subpath:
>
> ```typescript
> import { isMessageHash } from '@btc-vision/bitcoin/types';
> ```
>
> | Function | Signature | Checks |
> |----------|-----------|--------|
> | `isMessageHash` | `(value: unknown) => value is MessageHash` | `Uint8Array` with `length === 32`. |

### Taproot Type Guards

> **Note:** `isTapleaf` and `isTaptree` are defined in `src/types.ts` but are **not re-exported from the main `@btc-vision/bitcoin` entry point**. Import from the subpath:
>
> ```typescript
> import { isTapleaf, isTaptree } from '@btc-vision/bitcoin/types';
> ```

| Function | Signature | Checks |
|----------|-----------|--------|
| `isTapleaf` | `(value: unknown) => value is Tapleaf` | Object with an `output` property that is a `Uint8Array`. Optional `version` must be a number satisfying `(version & TAPLEAF_VERSION_MASK) === version`. |
| `isTaptree` | `(value: unknown) => value is Taptree` | Recursively validates: either a `Tapleaf` or a two-element array where both elements are valid `Taptree` nodes. |

### Usage Examples

```typescript
import { isBytes32, isPoint, isSatoshi, isHex } from '@btc-vision/bitcoin';

// Validate a hash before use
function processHash(input: unknown): void {
    if (!isBytes32(input)) {
        throw new Error('Expected a 32-byte hash');
    }
    // input is now narrowed to Bytes32
    console.log(input.length); // 32
}

// Validate a public key
function checkKey(key: unknown): void {
    if (isPoint(key)) {
        // key is PublicKey (33 or 65 bytes, valid SEC1 encoding)
        console.log('Valid public key, length:', key.length);
    }
}

// Validate satoshi amounts from user input
function parseFee(value: unknown): void {
    if (!isSatoshi(value)) {
        throw new Error('Invalid satoshi amount');
    }
    // value is now Satoshi
}

// Validate hex strings (note: isHex from main entry accepts string, not unknown)
const input: string = '0a1b2c3d';
if (isHex(input)) {
    // Safe to decode as hex
}
```

---

## Assertion Helpers

Assertion helpers throw descriptive errors when validation fails. They use TypeScript's `asserts value is T` return type to narrow the value in subsequent code. Use these at function entry points for fail-fast validation.

### assertXOnlyPublicKey

```typescript
function assertXOnlyPublicKey(
    value: unknown,
    name: string,
): asserts value is XOnlyPublicKey;
```

Throws `TypeError` if `value` is not a 32-byte `Uint8Array`. Throws `RangeError` if the value is zero or `>= EC_P` (secp256k1 field prime). The `name` parameter is included in the error message for debugging.

> **Source code note:** The actual error message thrown when the value exceeds `EC_P` reads `"${name} exceeds curve order"`, which is technically misleading -- the check is against the field prime (`EC_P`), not the curve order (`EC_N`). The validation logic itself is correct; only the error message text is inaccurate.

```typescript
import { assertXOnlyPublicKey } from '@btc-vision/bitcoin';

function tweakKey(internalKey: Uint8Array): void {
    assertXOnlyPublicKey(internalKey, 'internalKey');
    // internalKey is now XOnlyPublicKey
    // If invalid, throws:
    //   TypeError: internalKey must be Uint8Array, got ...
    //   TypeError: internalKey must be 32 bytes, got ...
    //   RangeError: internalKey cannot be zero
    //   RangeError: internalKey exceeds curve order  (note: actually checks EC_P, not EC_N)
}
```

### assertPrivateKey

```typescript
function assertPrivateKey(
    value: unknown,
    name: string,
): asserts value is PrivateKey;
```

Throws `TypeError` if `value` is not a 32-byte `Uint8Array`. Throws `RangeError` if the value is zero or `>= EC_N` (secp256k1 curve order). The `name` parameter is included in the error message.

```typescript
import { assertPrivateKey } from '@btc-vision/bitcoin';

function signMessage(key: Uint8Array, msg: Uint8Array): void {
    assertPrivateKey(key, 'signingKey');
    // key is now PrivateKey
    // If invalid, throws:
    //   TypeError: signingKey must be Uint8Array, got ...
    //   TypeError: signingKey must be 32 bytes, got ...
    //   RangeError: signingKey cannot be zero
    //   RangeError: signingKey exceeds curve order
}
```

---

## Conversion Functions

Conversion functions validate a plain value and return it cast to the corresponding branded type. They throw on invalid input, making them suitable for trusted boundaries where you have a value you believe is correct but need the compiler to agree.

### toBytes32

```typescript
function toBytes32(value: Uint8Array): Bytes32;
```

Throws `TypeError` if `value.length !== 32`.

```typescript
import { toBytes32 } from '@btc-vision/bitcoin';
import * as crypto from '@btc-vision/bitcoin/crypto';

const hash = crypto.sha256(data);
const typed: Bytes32 = toBytes32(hash);
```

### toBytes20

```typescript
function toBytes20(value: Uint8Array): Bytes20;
```

Throws `TypeError` if `value.length !== 20`.

```typescript
import { toBytes20 } from '@btc-vision/bitcoin';

const hash160Result = hash160(pubkey);
const typed: Bytes20 = toBytes20(hash160Result);
```

### toSatoshi

```typescript
function toSatoshi(value: bigint): Satoshi;
```

Throws `RangeError` if `value < 0n` or `value > SATOSHI_MAX`.

```typescript
import { toSatoshi } from '@btc-vision/bitcoin';

const fee: Satoshi = toSatoshi(10_000n);
const amount: Satoshi = toSatoshi(50_000_000n);  // 0.5 BTC

// These throw:
toSatoshi(-1n);                       // RangeError: Satoshi cannot be negative, got -1
toSatoshi(2_100_000_000_000_001n);    // RangeError: Satoshi exceeds maximum supply ...
```

### toMessageHash

> **Note:** `toMessageHash` is **not exported from the main `@btc-vision/bitcoin` entry point**. Import from the subpath:

```typescript
function toMessageHash(value: Uint8Array): MessageHash;
```

Throws `TypeError` if `value.length !== 32`.

```typescript
import { toMessageHash } from '@btc-vision/bitcoin/types';

const sigHash = computeSigHash(tx, index);
const typed: MessageHash = toMessageHash(sigHash);
```

---

## Stack Types

Stack types represent elements on the Bitcoin script execution stack.

```typescript
type StackElement = Uint8Array | number;
type Stack = readonly StackElement[];
type StackFunction = () => Stack;
```

| Type | Description |
|------|-------------|
| `StackElement` | A single value on the script stack: either raw bytes (`Uint8Array`) or a small integer (`number`, representing script numbers / opcodes). |
| `Stack` | A readonly array of `StackElement` values, representing the full stack state. |
| `StackFunction` | A lazily evaluated stack: a zero-argument function returning a `Stack`. Used when witness data is computed on demand. |

```typescript
import type { Stack, StackElement, StackFunction } from '@btc-vision/bitcoin';

// Direct stack
const witness: Stack = [
    new Uint8Array([0x01, 0x02]),
    42,
];

// Lazy stack (computed when needed)
const lazyWitness: StackFunction = () => [
    computeSignature(),
    redeemScript,
];
```

---

## Taptree Types

Taptree types define the recursive structure of Taproot (and P2MR) script trees.

### Tapleaf

```typescript
export interface Tapleaf {
    readonly output: Uint8Array;
    readonly version?: number;
}
```

A single leaf in the script tree. `output` is the compiled script bytecode. `version` is the leaf version (defaults to `0xc0`, the standard tapscript version). The version must satisfy `(version & TAPLEAF_VERSION_MASK) === version`, meaning the lowest bit must be zero.

### Taptree

```typescript
type Taptree = [Taptree | Tapleaf, Taptree | Tapleaf] | Tapleaf;
```

A recursive binary tree type. Each node is either a `Tapleaf` (terminal) or a two-element tuple of child nodes. This mirrors the Merkle tree structure defined in BIP 341.

> **Note:** The `Tapleaf` and `Taptree` **types** are exported from `@btc-vision/bitcoin`, but the **runtime guard functions** `isTapleaf` and `isTaptree` are **not**. Import the guards from the subpath:

```typescript
import type { Tapleaf, Taptree } from '@btc-vision/bitcoin';
import { isTapleaf, isTaptree } from '@btc-vision/bitcoin/types';

// Single leaf
const leaf: Tapleaf = { output: scriptBytes };

// Two-leaf tree
const tree: Taptree = [
    { output: script1 },
    { output: script2 },
];

// Nested tree (3 leaves)
const nested: Taptree = [
    [
        { output: scriptA },
        { output: scriptB },
    ],
    { output: scriptC },
];

// Runtime validation
if (isTapleaf(value)) {
    console.log(value.output); // Uint8Array
}
if (isTaptree(value)) {
    // value is a valid tree structure
}
```

---

## Constants

| Constant | Value | Exported from main entry? | Description |
|----------|-------|---------------------------|-------------|
| `SATOSHI_MAX` | `2_100_000_000_000_000n` (`21n * 10n ** 14n`) | **No** | Maximum total supply of Bitcoin in satoshis (21 million BTC). Used by `isSatoshi()` and `toSatoshi()` for upper bound validation. |
| `TAPLEAF_VERSION_MASK` | `0xfe` | Yes | Bitmask for valid tapleaf versions. The lowest bit is reserved for the parity flag in the control block, so valid leaf versions have bit 0 clear. |

> **Note:** `SATOSHI_MAX` is **not re-exported from the main `@btc-vision/bitcoin` entry point**. Import it from the subpath:

```typescript
import { TAPLEAF_VERSION_MASK } from '@btc-vision/bitcoin';
import { SATOSHI_MAX } from '@btc-vision/bitcoin/types';

// SATOSHI_MAX
console.log(SATOSHI_MAX); // 2100000000000000n

// TAPLEAF_VERSION_MASK
const LEAF_VERSION_TAPSCRIPT = 0xc0;
console.log((LEAF_VERSION_TAPSCRIPT & TAPLEAF_VERSION_MASK) === LEAF_VERSION_TAPSCRIPT); // true

const invalid = 0xc1; // bit 0 set
console.log((invalid & TAPLEAF_VERSION_MASK) === invalid); // false
```

---

## Utility Functions

### stacksEqual

> **Note:** `stacksEqual` is defined in `src/types.ts` but is **not re-exported from the main `@btc-vision/bitcoin` entry point**. Import from the subpath:

```typescript
function stacksEqual(a: Uint8Array[], b: Uint8Array[]): boolean;
```

Compares two arrays of `Uint8Array` for deep equality. Returns `true` if both arrays have the same length and every element at each index is byte-equal. Uses the library's internal `equals()` function, which performs an **early-return comparison** (returns `false` immediately on the first mismatched byte). This is **not** constant-time.

```typescript
import { stacksEqual } from '@btc-vision/bitcoin/types';

const a = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
const b = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
const c = [new Uint8Array([1, 2]), new Uint8Array([5, 6])];

console.log(stacksEqual(a, b)); // true
console.log(stacksEqual(a, c)); // false
```

---

## Internal Constants

The module defines two internal constants used by type guards and assertions but not exported:

| Constant | Value (hex) | Description |
|----------|-------------|-------------|
| `EC_P` | `fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f` | The secp256k1 field prime. X-only public keys and point coordinates must be strictly less than this value. |
| `EC_N` | `fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141` | The secp256k1 curve order. Private keys must be strictly less than this value and non-zero. |

These are used by `isXOnlyPublicKey()`, `isPoint()`, `isPrivateKey()`, `assertXOnlyPublicKey()`, and `assertPrivateKey()` to enforce cryptographic validity beyond simple length checks.

---

## Complete Example

```typescript
import {
    // Branded types (type-only imports)
    type Bytes32,
    type Bytes20,
    type PublicKey,
    type XOnlyPublicKey,
    type Satoshi,
    type PrivateKey,
    type SchnorrSignature,
    type Script,

    // Type guards (exported from main entry)
    isBytes32,
    isPoint,
    isXOnlyPublicKey,
    isPrivateKey,
    isSatoshi,
    isSchnorrSignature,
    isHex,

    // Assertions
    assertXOnlyPublicKey,
    assertPrivateKey,

    // Conversions (exported from main entry)
    toBytes32,
    toBytes20,
    toSatoshi,

    // Constants (only TAPLEAF_VERSION_MASK from main entry)
    TAPLEAF_VERSION_MASK,
} from '@btc-vision/bitcoin';

// Items not on the main entry point -- use subpath import:
import {
    type MessageHash,
    toMessageHash,
    isMessageHash,
    stacksEqual,
    isTapleaf,
    isTaptree,
    SATOSHI_MAX,
} from '@btc-vision/bitcoin/types';

// --- Creating branded types from raw data ---

// From a known-good 32-byte hash
const txid: Bytes32 = toBytes32(rawHashBytes);

// From a bigint amount
const fee: Satoshi = toSatoshi(1000n);
const onebtc: Satoshi = toSatoshi(100_000_000n);

// --- Validating untrusted input ---

function processInput(data: unknown): Bytes32 {
    if (!isBytes32(data)) {
        throw new Error('Expected 32-byte value');
    }
    return data; // TypeScript knows this is Bytes32
}

// --- Using assertions for fail-fast validation ---

function buildTaprootOutput(internalKey: unknown, privateKey: unknown): void {
    assertXOnlyPublicKey(internalKey, 'internalKey');
    assertPrivateKey(privateKey, 'privateKey');

    // Both are now narrowed to their branded types.
    // Any invalid input would have thrown with a descriptive error.
    const xonly: XOnlyPublicKey = internalKey;
    const key: PrivateKey = privateKey;
}

// --- Conditional narrowing with type guards ---

function handleKey(key: Uint8Array): string {
    if (isXOnlyPublicKey(key)) {
        return 'x-only (32 bytes, valid field element)';
    }
    if (isPoint(key)) {
        return `SEC1 public key (${key.length} bytes)`;
    }
    if (isPrivateKey(key)) {
        return 'private key (32 bytes, valid scalar)';
    }
    return 'unknown key format';
}

// --- Satoshi bounds checking ---

console.log(isSatoshi(0n));           // true
console.log(isSatoshi(SATOSHI_MAX));  // true
console.log(isSatoshi(-1n));          // false
console.log(isSatoshi(SATOSHI_MAX + 1n)); // false
```

---

## Source File

All types, guards, assertions, and conversions are defined in:

- `/src/types.ts` - Main module re-exporting branded types and defining all runtime functions
- `/src/branded.ts` - Re-exports branded type definitions from `@btc-vision/ecpair`
