# Cryptographic Hash Functions

This module provides all cryptographic hashing primitives used throughout the Bitcoin protocol. It exposes single-pass hashes (`sha256`, `sha1`, `ripemd160`), composite hashes (`hash160`, `hash256`), and BIP340 tagged hashes (`taggedHash`) used by Taproot.

## Overview

| Function | Algorithm | Output Size | Primary Bitcoin Use |
|----------|-----------|-------------|---------------------|
| `sha256` | SHA-256 | 32 bytes (`Bytes32`) | SegWit v1 sighash components, witness commitments |
| `sha1` | SHA-1 | 20 bytes (`Bytes20`) | `OP_SHA1` script opcode |
| `ripemd160` | RIPEMD-160 | 20 bytes (`Bytes20`) | `OP_RIPEMD160` script opcode |
| `hash160` | RIPEMD-160(SHA-256(x)) | 20 bytes (`Bytes20`) | P2PKH addresses, P2SH addresses, P2WPKH witness programs |
| `hash256` | SHA-256(SHA-256(x)) | 32 bytes (`Bytes32`) | Block headers, transaction IDs (txid), legacy sighash |
| `taggedHash` | SHA-256(tag_prefix \|\| data) | 32 bytes (`Bytes32`) | Taproot (BIP340/341): key tweaking, leaf/branch hashing, Schnorr signatures |

---

## Installation

```typescript
import {
    sha256,
    sha1,
    ripemd160,
    hash160,
    hash256,
    taggedHash,
    TAGS,
    TAGGED_HASH_PREFIXES,
} from '@btc-vision/bitcoin';

// Or via the crypto namespace
import { crypto } from '@btc-vision/bitcoin';
crypto.sha256(data);
```

---

## sha256

Computes the SHA-256 hash of the input data.

```typescript
function sha256(data: Uint8Array): Bytes32
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Uint8Array` | Arbitrary input bytes |
| **Returns** | `Bytes32` | 32-byte SHA-256 digest |

SHA-256 is the foundational hash in Bitcoin. While it is rarely used as a single pass for addresses or block identification (those use `hash256` or `hash160`), it is used directly in SegWit v1 (BIP 143 / BIP 341) sighash computation to hash individual transaction components (prevouts, sequences, amounts, outputs, script pubkeys) before they are assembled into the final sighash message.

### Example

```typescript
import { sha256 } from '@btc-vision/bitcoin';

const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
const digest = sha256(data);
// digest is a 32-byte Uint8Array (Bytes32)
console.log(digest.length); // 32
```

---

## sha1

Computes the SHA-1 hash of the input data.

```typescript
function sha1(data: Uint8Array): Bytes20
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Uint8Array` | Arbitrary input bytes |
| **Returns** | `Bytes20` | 20-byte SHA-1 digest |

SHA-1 is available in Bitcoin Script via the `OP_SHA1` opcode. It is not used in standard transaction workflows but is required for certain specialized scripts.

### Example

```typescript
import { sha1 } from '@btc-vision/bitcoin';

const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
const digest = sha1(data);
console.log(digest.length); // 20
```

---

## ripemd160

Computes the RIPEMD-160 hash of the input data.

```typescript
function ripemd160(data: Uint8Array): Bytes20
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Uint8Array` | Arbitrary input bytes |
| **Returns** | `Bytes20` | 20-byte RIPEMD-160 digest |

RIPEMD-160 is available in Bitcoin Script via the `OP_RIPEMD160` opcode. On its own it is not commonly used in standard Bitcoin payments, but it is a core component of the `hash160` composite hash (see below).

### Example

```typescript
import { ripemd160 } from '@btc-vision/bitcoin';

const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
const digest = ripemd160(data);
console.log(digest.length); // 20
```

---

## hash160

Computes RIPEMD-160(SHA-256(data)), the standard 20-byte address hash used throughout Bitcoin.

```typescript
function hash160(data: Uint8Array): Bytes20
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Uint8Array` | Arbitrary input bytes (typically a public key or redeem script) |
| **Returns** | `Bytes20` | 20-byte composite digest |

`hash160` is the most widely used address-derivation hash in Bitcoin:

- **P2PKH** (Pay-to-Public-Key-Hash): The output script contains `hash160(compressed_pubkey)`. This is what produces classic `1...` Bitcoin addresses.
- **P2SH** (Pay-to-Script-Hash): The output script contains `hash160(redeem_script)`. This produces `3...` addresses.
- **P2WPKH** (Pay-to-Witness-Public-Key-Hash): The witness program is `hash160(compressed_pubkey)`. This produces `bc1q...` bech32 addresses.

The `OP_HASH160` opcode in Bitcoin Script performs exactly this operation.

### Example

```typescript
import { hash160 } from '@btc-vision/bitcoin';

// Hash a compressed public key to derive a P2PKH address hash
const compressedPubkey = new Uint8Array(33); // 33-byte compressed public key
const pubkeyHash = hash160(compressedPubkey);
console.log(pubkeyHash.length); // 20

// This 20-byte hash is what goes into a P2PKH output script:
// OP_DUP OP_HASH160 <pubkeyHash> OP_EQUALVERIFY OP_CHECKSIG
```

### Usage in P2PKH Address Derivation

```typescript
import { payments } from '@btc-vision/bitcoin';
import type { PublicKey } from '@btc-vision/bitcoin';

// P2PKH internally calls hash160(pubkey) to derive the address
const payment = payments.P2PKH.fromPubkey(compressedPubkey as PublicKey);
console.log(payment.hash);    // 20-byte hash160 of the public key (Bytes20 | undefined)
console.log(payment.address); // Base58Check-encoded address (string | undefined)
```

### Usage in P2SH

```typescript
import { payments } from '@btc-vision/bitcoin';

// P2SH internally calls hash160(redeemScript) for the script hash
const payment = payments.P2SH.fromRedeem({ output: redeemScript });
console.log(payment.hash);    // 20-byte hash160 of the redeem script (Bytes20 | undefined)
console.log(payment.address); // Base58Check-encoded address (string | undefined)
```

---

## hash256

Computes SHA-256(SHA-256(data)), the double-SHA-256 hash used for block headers and transaction identifiers.

```typescript
function hash256(data: Uint8Array): Bytes32
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Uint8Array` | Arbitrary input bytes (typically a serialized block header or transaction) |
| **Returns** | `Bytes32` | 32-byte double-SHA-256 digest |

`hash256` (double SHA-256) is the backbone of Bitcoin's proof-of-work and transaction identification:

- **Block header hashing**: The 80-byte block header is double-SHA-256 hashed to produce the block hash. Miners must find a nonce such that this hash is below the target threshold.
- **Transaction IDs (txid)**: Every transaction is identified by the double-SHA-256 of its serialized form (excluding witness data).
- **Merkle tree construction**: The transaction merkle root in each block is built by pairwise double-SHA-256 hashing of transaction IDs.
- **Legacy sighash**: Pre-SegWit signature hashes use `hash256` over the sighash preimage.
- **BIP 143 sighash (SegWit v0)**: The intermediate components (hashPrevouts, hashSequence, hashOutputs) and the final sighash digest are computed with `hash256`.

### Example

```typescript
import { hash256 } from '@btc-vision/bitcoin';

// Double-SHA-256 of arbitrary data
const data = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
const digest = hash256(data);
console.log(digest.length); // 32
```

### Block Header Hashing

```typescript
import { Block } from '@btc-vision/bitcoin';

const block = Block.fromHex(blockHex);

// Block.getHash() internally calls hash256(serialized_80_byte_header)
const blockHash = block.getHash();
console.log(blockHash.length); // 32

// The block ID is the hash in reversed byte order (display convention)
console.log(block.getId()); // hex string as shown in block explorers
```

### Transaction ID Computation

```typescript
import { Transaction } from '@btc-vision/bitcoin';

const tx = Transaction.fromHex(txHex);

// tx.getHash() internally calls hash256(serialized_tx_without_witness)
const txid = tx.getHash();
console.log(txid.length); // 32
```

### Merkle Tree

```typescript
import { Block } from '@btc-vision/bitcoin';

// Block.calculateMerkleRoot uses hash256 for pairwise merkle node hashing
const merkleRoot = Block.calculateMerkleRoot(transactions);
```

---

## taggedHash

Computes a BIP340-style tagged hash: `SHA-256(SHA-256(tag) || SHA-256(tag) || data)`.

```typescript
function taggedHash(prefix: TaggedHashPrefix, data: Uint8Array): Bytes32
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `prefix` | `TaggedHashPrefix` | One of the predefined tag names (see TAGS below) |
| `data` | `Uint8Array` | Input data to hash |
| **Returns** | `Bytes32` | 32-byte tagged hash digest |

Tagged hashing was introduced by BIP340 (Schnorr signatures) and BIP341 (Taproot) to provide domain separation. Each tag produces a different hash function, ensuring that a hash computed in one context cannot collide with a hash in another context. The tag prefix (`SHA-256(tag) || SHA-256(tag)`) is prepended to the data before the final SHA-256, making it impossible for two different tags to produce the same output for the same input.

The library precomputes the 64-byte tag prefixes in `TAGGED_HASH_PREFIXES` for performance, avoiding redundant SHA-256 computations of the tag string on every call.

### Example

```typescript
import { taggedHash } from '@btc-vision/bitcoin';

// Compute a TapTweak tagged hash (used when tweaking an internal public key)
const tweakData = new Uint8Array(64); // e.g., internal_pubkey || merkle_root
const tweakHash = taggedHash('TapTweak', tweakData);
console.log(tweakHash.length); // 32
```

### Taproot Leaf Hashing

```typescript
import { tapleafHash, LEAF_VERSION_TAPSCRIPT } from '@btc-vision/bitcoin';

// tapleafHash internally calls taggedHash('TapLeaf', version || script_length || script)
const leafHash = tapleafHash({
    output: leafScript,
    version: LEAF_VERSION_TAPSCRIPT,
});
```

### Taproot Branch Hashing

```typescript
import { tapBranchHash } from '@btc-vision/bitcoin';

// tapBranchHash internally calls taggedHash('TapBranch', left || right)
const branchHash = tapBranchHash(leftHash, rightHash);
```

### Taproot Sighash

```typescript
// The BIP341 sighash for SegWit v1 transactions uses taggedHash('TapSighash', ...)
// This is handled internally by Transaction.hashForWitnessV1()
const sighash = tx.hashForWitnessV1(inputIndex, prevOutScripts, values, hashType);
```

---

## TAGS

A readonly tuple of all recognized BIP340/BIP341/MuSig2 tag names.

```typescript
const TAGS = [
    'BIP0340/challenge',
    'BIP0340/aux',
    'BIP0340/nonce',
    'TapLeaf',
    'TapBranch',
    'TapSighash',
    'TapTweak',
    'KeyAgg list',
    'KeyAgg coefficient',
] as const;
```

| Tag | BIP | Purpose |
|-----|-----|---------|
| `BIP0340/challenge` | BIP 340 | Schnorr signature challenge hash `e = H(R \|\| P \|\| m)` |
| `BIP0340/aux` | BIP 340 | Auxiliary randomness in nonce generation |
| `BIP0340/nonce` | BIP 340 | Deterministic nonce derivation |
| `TapLeaf` | BIP 341 | Hashing individual tapscript leaves |
| `TapBranch` | BIP 341 | Hashing pairs of child nodes in the Taproot Merkle tree |
| `TapSighash` | BIP 341 | Computing the sighash for SegWit v1 (Taproot) inputs |
| `TapTweak` | BIP 341 | Tweaking the internal public key with the Merkle root |
| `KeyAgg list` | BIP 327 (MuSig2) | Key aggregation list commitment |
| `KeyAgg coefficient` | BIP 327 (MuSig2) | Key aggregation coefficient derivation |

---

## TaggedHashPrefix

A union type of all valid tag strings. Only these strings are accepted by `taggedHash()`.

```typescript
type TaggedHashPrefix = (typeof TAGS)[number];
// Equivalent to:
// 'BIP0340/challenge' | 'BIP0340/aux' | 'BIP0340/nonce' |
// 'TapLeaf' | 'TapBranch' | 'TapSighash' | 'TapTweak' |
// 'KeyAgg list' | 'KeyAgg coefficient'
```

---

## TAGGED_HASH_PREFIXES

A precomputed map from each `TaggedHashPrefix` to its 64-byte prefix (`SHA-256(tag) || SHA-256(tag)`). These are computed once and reused on every call to `taggedHash()`, avoiding the overhead of hashing the tag string each time.

```typescript
const TAGGED_HASH_PREFIXES: { [key in TaggedHashPrefix]: Uint8Array }
```

Each entry is exactly 64 bytes: the first 32 bytes are `SHA-256(tag)` and the second 32 bytes are an identical copy. When `taggedHash(prefix, data)` is called, it computes:

```
SHA-256( TAGGED_HASH_PREFIXES[prefix] || data )
```

This follows the BIP340 specification:

```
tagged_hash(tag, msg) = SHA-256(SHA-256(tag) || SHA-256(tag) || msg)
```

### Example: Verifying a Prefix

```typescript
import { sha256, TAGGED_HASH_PREFIXES } from '@btc-vision/bitcoin';

// The prefix for 'TapTweak' should be SHA-256("TapTweak") repeated twice
const tagBytes = new TextEncoder().encode('TapTweak');
const tagHash = sha256(tagBytes);

const prefix = TAGGED_HASH_PREFIXES['TapTweak'];
console.log(prefix.length); // 64

// First 32 bytes === SHA-256("TapTweak")
console.log(prefix.subarray(0, 32)); // equals tagHash
// Second 32 bytes === SHA-256("TapTweak")
console.log(prefix.subarray(32, 64)); // equals tagHash
```

---

## Return Types

The crypto module uses branded `Uint8Array` subtypes for type safety:

| Type | Length | Used By |
|------|--------|---------|
| `Bytes32` | 32 bytes | `sha256`, `hash256`, `taggedHash` |
| `Bytes20` | 20 bytes | `sha1`, `ripemd160`, `hash160` |

These types help catch misuse at compile time. A `Bytes32` cannot be accidentally passed where a `Bytes20` is expected, and vice versa.

```typescript
import { isBytes32, isBytes20, toBytes32, toBytes20 } from '@btc-vision/bitcoin';

// Runtime validation
if (isBytes32(value)) {
    // value is Bytes32
}

// Runtime conversion (throws if length is wrong)
const b32 = toBytes32(someUint8Array); // asserts 32 bytes
const b20 = toBytes20(someUint8Array); // asserts 20 bytes
```

---

## Underlying Implementation

The raw hash functions are provided by the `@noble/hashes` library:

```typescript
// src/crypto-hashes.ts
import { ripemd160, sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
```

The `crypto.ts` module wraps these with proper return types (`Bytes20`, `Bytes32`) and builds the composite functions (`hash160`, `hash256`, `taggedHash`) on top of them.

---

## Hash Function Usage Summary by Bitcoin Feature

| Bitcoin Feature | Hash Function | Details |
|-----------------|---------------|---------|
| P2PKH addresses (`1...`) | `hash160` | `RIPEMD-160(SHA-256(pubkey))` produces the 20-byte pubkey hash |
| P2SH addresses (`3...`) | `hash160` | `RIPEMD-160(SHA-256(redeemScript))` produces the 20-byte script hash |
| P2WPKH addresses (`bc1q...`) | `hash160` | 20-byte witness program is `hash160(pubkey)` |
| P2WSH addresses (`bc1q...`) | `sha256` | 32-byte witness program is `SHA-256(witnessScript)` |
| Block header hash | `hash256` | Double-SHA-256 of the 80-byte header; basis for proof-of-work |
| Transaction ID (txid) | `hash256` | Double-SHA-256 of the serialized transaction (no witness) |
| Merkle root (block) | `hash256` | Pairwise double-SHA-256 of txids |
| Legacy sighash (pre-SegWit) | `hash256` | Double-SHA-256 of the sighash preimage |
| SegWit v0 sighash (BIP 143) | `hash256` | Double-SHA-256 for intermediate components and final digest |
| SegWit v1 sighash (BIP 341) | `sha256` + `taggedHash` | Single SHA-256 for intermediate components; `taggedHash('TapSighash', ...)` for the final digest |
| Taproot key tweaking | `taggedHash` | `taggedHash('TapTweak', pubkey \|\| merkleRoot)` |
| Tapscript leaf hash | `taggedHash` | `taggedHash('TapLeaf', version \|\| scriptLen \|\| script)` |
| Tapscript branch hash | `taggedHash` | `taggedHash('TapBranch', left \|\| right)` |
| Schnorr signature challenge | `taggedHash` | `taggedHash('BIP0340/challenge', R \|\| P \|\| m)` |
| Schnorr nonce generation | `taggedHash` | `taggedHash('BIP0340/nonce', ...)` and `taggedHash('BIP0340/aux', ...)` |
| MuSig2 key aggregation | `taggedHash` | `taggedHash('KeyAgg list', ...)` and `taggedHash('KeyAgg coefficient', ...)` |
| `OP_SHA1` script opcode | `sha1` | Rarely used; available for specialized scripts |
| `OP_RIPEMD160` script opcode | `ripemd160` | Rarely used directly; component of `hash160` |
| `OP_SHA256` script opcode | `sha256` | Single SHA-256 in script evaluation |
| `OP_HASH160` script opcode | `hash160` | RIPEMD-160(SHA-256(x)) in script evaluation |
| `OP_HASH256` script opcode | `hash256` | SHA-256(SHA-256(x)) in script evaluation |
