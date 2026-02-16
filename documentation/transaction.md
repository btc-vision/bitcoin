# Transaction

The `Transaction` class represents a Bitcoin transaction. It handles parsing, serialization, cloning, and producing the various sighash digests needed for legacy, SegWit v0, and Taproot (SegWit v1) signing.

## Overview

| Property | Description |
|----------|-------------|
| Module | `@btc-vision/bitcoin` |
| Export | `Transaction` |
| Witness support | Yes (BIP 141 serialization) |
| Signing support | Legacy (`hashForSignature`), SegWit v0 (`hashForWitnessV0`), Taproot (`hashForWitnessV1`) |
| TRUC support | Version 3 transactions (Topologically Restricted Until Confirmation) |

---

## Static Constants

### Sighash Types

| Constant | Value | Description |
|----------|-------|-------------|
| `SIGHASH_DEFAULT` | `0x00` | Taproot-only default, semantically equivalent to `SIGHASH_ALL` |
| `SIGHASH_ALL` | `0x01` | Sign all inputs and outputs |
| `SIGHASH_NONE` | `0x02` | Sign all inputs, no outputs (wildcard payee) |
| `SIGHASH_SINGLE` | `0x03` | Sign all inputs, only the output at the same index |
| `SIGHASH_ANYONECANPAY` | `0x80` | Combined with the above via bitwise OR; sign only the current input |
| `SIGHASH_OUTPUT_MASK` | `0x03` | Bitmask to extract the output sighash type |
| `SIGHASH_INPUT_MASK` | `0x80` | Bitmask to extract the input sighash type |

### Sequence and Serialization

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_SEQUENCE` | `0xffffffff` | Default sequence number (no RBF, no relative timelock) |
| `ADVANCED_TRANSACTION_MARKER` | `0x00` | SegWit marker byte in serialized transactions |
| `ADVANCED_TRANSACTION_FLAG` | `0x01` | SegWit flag byte in serialized transactions |

### TRUC (Topologically Restricted Until Confirmation)

| Constant | Value | Description |
|----------|-------|-------------|
| `TRUC_VERSION` | `3` | Transaction version for TRUC transactions |
| `TRUC_MAX_VSIZE` | `10000` | Maximum virtual size in vbytes for a TRUC parent transaction |
| `TRUC_CHILD_MAX_VSIZE` | `1000` | Maximum virtual size in vbytes for a TRUC child transaction |

---

## Interfaces

### Input

Represents a transaction input (a reference to a previous output being spent).

```typescript
interface Input {
    readonly hash: Bytes32;    // 32-byte hash of the previous transaction
    readonly index: number;    // Output index in the previous transaction
    script: Script;            // Input script (scriptSig)
    sequence: number;          // Sequence number
    witness: Uint8Array[];     // Witness data stack
}
```

### Output

Represents a transaction output (a locking script with an associated value).

```typescript
interface Output {
    readonly script: Script;   // Output script (scriptPubKey / locking script)
    readonly value: Satoshi;   // Value in satoshis (bigint)
}
```

### TaprootHashCache

Cache for Taproot sighash intermediate values. These are identical for all inputs when using `SIGHASH_ALL`, so they can be computed once and reused across inputs.

```typescript
interface TaprootHashCache {
    readonly hashPrevouts: Bytes32;
    readonly hashAmounts: Bytes32;
    readonly hashScriptPubKeys: Bytes32;
    readonly hashSequences: Bytes32;
    readonly hashOutputs: Bytes32;
}
```

---

## Instance Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `version` | `number` | `1` | Transaction version |
| `locktime` | `number` | `0` | Transaction locktime |
| `ins` | `Input[]` | `[]` | Array of transaction inputs |
| `outs` | `Output[]` | `[]` | Array of transaction outputs |

---

## Static Methods

### fromBuffer

Parse a transaction from a raw `Uint8Array` buffer.

```typescript
static fromBuffer(buffer: Uint8Array, _NO_STRICT?: boolean): Transaction
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `buffer` | `Uint8Array` | Yes | The raw transaction bytes |
| `_NO_STRICT` | `boolean` | No | If `true`, allow extra trailing data after the transaction |

Returns a fully parsed `Transaction` instance. Automatically detects SegWit transactions by checking for the marker and flag bytes. Throws if the buffer contains superfluous witness data or unexpected trailing bytes (unless `_NO_STRICT` is set).

```typescript
import { Transaction, fromHex } from '@btc-vision/bitcoin';

const rawTx = fromHex('0200000001abcdef...');
const tx = Transaction.fromBuffer(rawTx);
console.log(tx.version); // 2
console.log(tx.ins.length);
console.log(tx.outs.length);
```

---

### fromHex

Parse a transaction from a hex string. A convenience wrapper around `fromBuffer`.

```typescript
static fromHex(hex: string): Transaction
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hex` | `string` | Yes | The transaction as a hex-encoded string |

Returns a fully parsed `Transaction` instance.

```typescript
import { Transaction } from '@btc-vision/bitcoin';

const tx = Transaction.fromHex('0200000001abcdef...');
console.log(tx.getId());
```

---

### isCoinbaseHash

Check if a 32-byte hash is a coinbase hash (all zeros).

```typescript
static isCoinbaseHash(hash: Bytes32): boolean
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hash` | `Bytes32` | Yes | 32-byte hash to check |

Returns `true` if every byte is `0x00`. Throws `TypeError` if the hash is not exactly 32 bytes.

---

## Instance Methods

### addInput

Add an input to the transaction.

```typescript
addInput(hash: Bytes32, index: number, sequence?: number, scriptSig?: Script): number
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hash` | `Bytes32` | Yes | 32-byte hash of the previous transaction |
| `index` | `number` | Yes | Output index in the previous transaction (uint32) |
| `sequence` | `number` | No | Sequence number (defaults to `0xffffffff`) |
| `scriptSig` | `Script` | No | Input script (defaults to empty) |

Returns the index of the newly added input. The witness field is initialized to an empty array.

```typescript
import { Transaction, fromHex } from '@btc-vision/bitcoin';
import type { Bytes32, Script } from '@btc-vision/bitcoin';

const tx = new Transaction();

// Previous transaction hash (in internal byte order)
const prevTxHash = fromHex(
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
) as Bytes32;

const inputIndex = tx.addInput(prevTxHash, 0);
console.log(inputIndex); // 0

// With custom sequence (e.g. for RBF)
tx.addInput(prevTxHash, 1, 0xfffffffd);
```

---

### addOutput

Add an output to the transaction.

```typescript
addOutput(scriptPubKey: Script, value: Satoshi): number
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scriptPubKey` | `Script` | Yes | Output script (locking script) |
| `value` | `Satoshi` | Yes | Output value in satoshis (`bigint`, range `0` to `2^63 - 1`) |

Returns the index of the newly added output.

```typescript
import { Transaction, address } from '@btc-vision/bitcoin';
import type { Satoshi } from '@btc-vision/bitcoin';

const tx = new Transaction();
const scriptPubKey = address.toOutputScript('bc1qexampleaddress...');
const outputIndex = tx.addOutput(scriptPubKey, 50000n as Satoshi);
console.log(outputIndex); // 0
```

---

### clone

Create a deep copy of the transaction. All inputs and outputs are duplicated.

```typescript
clone(): Transaction
```

Returns a new `Transaction` instance with identical version, locktime, inputs, and outputs.

```typescript
const original = Transaction.fromHex('0200000001...');
const copy = original.clone();

// Modifying the copy does not affect the original
copy.locktime = 800000;
console.log(original.locktime); // unchanged
```

---

### toBuffer

Serialize the transaction to a `Uint8Array` buffer. Includes witness data if present.

```typescript
toBuffer(buffer?: Uint8Array, initialOffset?: number): Uint8Array
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `buffer` | `Uint8Array` | No | Pre-allocated buffer (auto-allocated if omitted) |
| `initialOffset` | `number` | No | Starting offset within the buffer |

Returns the serialized transaction bytes. If witness data is present, the output uses the BIP 141 serialization format with marker and flag bytes.

```typescript
const tx = new Transaction();
// ... add inputs and outputs ...
const raw = tx.toBuffer();
console.log(raw.length); // byte length of the serialized transaction
```

---

### toHex

Serialize the transaction to a hex string. A convenience wrapper around `toBuffer`.

```typescript
toHex(): string
```

Returns the full transaction as a hex-encoded string.

```typescript
const tx = new Transaction();
// ... add inputs and outputs ...
const hex = tx.toHex();
console.log(hex); // "0200000001..."
```

---

### getHash

Compute the transaction hash (double SHA-256 of the serialized data).

```typescript
getHash(forWitness?: boolean): Bytes32
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `forWitness` | `boolean` | No | If `true`, include witness data to produce the wtxid |

Returns a 32-byte hash. When `forWitness` is `false` or omitted, witness data is excluded from the hash (producing the txid). When `forWitness` is `true`, witness data is included (producing the wtxid). For coinbase transactions with `forWitness = true`, always returns 32 zero bytes.

---

### getId

Get the transaction ID (txid) as a hex string in the conventional display order (reversed).

```typescript
getId(): string
```

Returns the txid as a 64-character hex string. Bitcoin transaction IDs are displayed in reversed byte order relative to the internal hash.

```typescript
const tx = Transaction.fromHex('0200000001...');
console.log(tx.getId()); // "d4e5f6a1b2c3..."
```

---

### weight

Calculate the transaction weight as defined by BIP 141.

```typescript
weight(): number
```

Returns the weight in weight units. The formula is `base_size * 3 + total_size`, where `base_size` is the serialized size without witness data and `total_size` includes witness data.

---

### virtualSize

Calculate the virtual size (vsize) of the transaction in virtual bytes.

```typescript
virtualSize(): number
```

Returns `Math.ceil(weight() / 4)`. This is the value used for fee rate calculations.

```typescript
const tx = Transaction.fromHex('0200000001...');
console.log(tx.virtualSize()); // e.g. 141
```

---

### byteLength

Calculate the serialized byte length of the transaction.

```typescript
byteLength(_ALLOW_WITNESS?: boolean): number
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `_ALLOW_WITNESS` | `boolean` | No | If `true` (default), include witness data in the calculation |

Returns the byte count. When `_ALLOW_WITNESS` is `true` and the transaction has witness data, the count includes the marker, flag, and all witness stacks.

---

### isCoinbase

Check if this transaction is a coinbase transaction.

```typescript
isCoinbase(): boolean
```

Returns `true` if the transaction has exactly one input and that input's hash is all zeros (the defining characteristic of a coinbase transaction).

```typescript
const tx = Transaction.fromHex('0100000001000000000000000000000000...');
console.log(tx.isCoinbase()); // true
```

---

### hasWitnesses

Check if any input in the transaction has witness data.

```typescript
hasWitnesses(): boolean
```

Returns `true` if at least one input has a non-empty witness stack.

---

### setInputScript

Set the scriptSig for a specific input.

```typescript
setInputScript(index: number, scriptSig: Script): void
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `index` | `number` | Yes | Input index |
| `scriptSig` | `Script` | Yes | The script to set |

---

### setWitness

Set the witness data for a specific input.

```typescript
setWitness(index: number, witness: Uint8Array[]): void
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `index` | `number` | Yes | Input index |
| `witness` | `Uint8Array[]` | Yes | Array of witness stack elements |

---

## Signing Methods

### hashForSignature

Produce the sighash digest for signing a legacy (pre-SegWit) input. This method clones the transaction, modifies it according to the sighash type, serializes it with the hash type appended, and returns the double SHA-256 hash.

```typescript
hashForSignature(inIndex: number, prevOutScript: Script, hashType: number): MessageHash
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inIndex` | `number` | Yes | Index of the input being signed |
| `prevOutScript` | `Script` | Yes | The scriptPubKey of the output being spent |
| `hashType` | `number` | Yes | Sighash type (combination of `SIGHASH_*` constants) |

Returns a 32-byte `MessageHash`. In two specific cases, the method returns the constant `ONE` (32-byte value `0x0000...0001`) instead of computing a normal sighash:

1. **`inIndex >= ins.length`**: The input index is out of range (any sighash type).
2. **`SIGHASH_SINGLE` with `inIndex >= outs.length`**: The output at the matching index does not exist.

Both cases are well-known Bitcoin consensus quirks — the method returns the literal 32-byte value `0x0000000000000000000000000000000000000000000000000000000000000001`, **not** a hash of `0x01`.

The method automatically strips `OP_CODESEPARATOR` from the previous output script.

```typescript
import { Transaction } from '@btc-vision/bitcoin';

const tx = Transaction.fromHex('0200000001...');
const sighash = tx.hashForSignature(
    0,                          // input index
    prevOutScript,              // scriptPubKey of the UTXO
    Transaction.SIGHASH_ALL,    // sighash type
);
// Sign `sighash` with your private key
```

---

### hashForWitnessV0

Produce the sighash digest for signing a SegWit v0 input (P2WPKH or P2WSH), as defined by BIP 143.

```typescript
hashForWitnessV0(
    inIndex: number,
    prevOutScript: Script,
    value: Satoshi,
    hashType: number,
): MessageHash
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inIndex` | `number` | Yes | Index of the input being signed |
| `prevOutScript` | `Script` | Yes | The scriptCode of the output being spent |
| `value` | `Satoshi` | Yes | Value of the output being spent (bigint satoshis) |
| `hashType` | `number` | Yes | Sighash type (combination of `SIGHASH_*` constants) |

Returns a 32-byte `MessageHash`. Unlike legacy signing, the BIP 143 algorithm commits to the value of the input being spent, which prevents certain fee-related attacks.

```typescript
import { Transaction } from '@btc-vision/bitcoin';
import type { Satoshi, Script } from '@btc-vision/bitcoin';

const tx = new Transaction();
tx.version = 2;
// ... add inputs and outputs ...

const sighash = tx.hashForWitnessV0(
    0,                          // input index
    prevOutScript as Script,    // scriptCode of the UTXO
    100000n as Satoshi,         // value of the UTXO in satoshis
    Transaction.SIGHASH_ALL,    // sighash type
);
// Sign `sighash` with your private key
```

---

### hashForWitnessV1

Produce the sighash digest for signing a Taproot (SegWit v1) input, as defined by BIP 341 and BIP 342.

```typescript
hashForWitnessV1(
    inIndex: number,
    prevOutScripts: readonly Script[],
    values: readonly Satoshi[],
    hashType: number,
    leafHash?: Bytes32,
    annex?: Uint8Array,
    taprootCache?: TaprootHashCache,
): MessageHash
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inIndex` | `number` | Yes | Index of the input being signed |
| `prevOutScripts` | `readonly Script[]` | Yes | Scripts of ALL inputs being spent |
| `values` | `readonly Satoshi[]` | Yes | Values of ALL inputs being spent |
| `hashType` | `number` | Yes | Sighash type (`SIGHASH_DEFAULT`, or combination of `SIGHASH_*` constants) |
| `leafHash` | `Bytes32` | No | Leaf hash for script-path spending (BIP 342) |
| `annex` | `Uint8Array` | No | Optional annex data |
| `taprootCache` | `TaprootHashCache` | No | Pre-computed intermediate hashes (from `getTaprootHashCache`) |

Returns a 32-byte `MessageHash`. The Taproot sighash algorithm commits to the scripts and values of ALL inputs (not just the one being signed), providing stronger security guarantees. The hash is produced using the `TapSighash` tagged hash.

For key-path spending, omit `leafHash`. For script-path spending (BIP 342), pass the `leafHash` of the tapleaf being executed.

```typescript
import { Transaction } from '@btc-vision/bitcoin';
import type { Satoshi, Script } from '@btc-vision/bitcoin';

const tx = new Transaction();
tx.version = 2;
// ... add inputs and outputs ...

const prevOutScripts: Script[] = [scriptPubKey0, scriptPubKey1];
const values: Satoshi[] = [50000n as Satoshi, 75000n as Satoshi];

// Key-path spending
const sighash = tx.hashForWitnessV1(
    0,                              // input index
    prevOutScripts,                 // scripts of ALL inputs
    values,                         // values of ALL inputs
    Transaction.SIGHASH_DEFAULT,    // sighash type
);

// Script-path spending (with leaf hash)
const scriptPathHash = tx.hashForWitnessV1(
    0,
    prevOutScripts,
    values,
    Transaction.SIGHASH_DEFAULT,
    leafHash,    // 32-byte tapleaf hash
);
```

---

### getTaprootHashCache

Pre-compute the intermediate hash values used during Taproot signing. When signing multiple inputs in the same transaction, calling this once and passing the result to each `hashForWitnessV1` call avoids redundant O(n) hashing per input, reducing overall complexity from O(n^2) to O(n).

```typescript
getTaprootHashCache(
    prevOutScripts: readonly Script[],
    values: readonly Satoshi[],
): TaprootHashCache
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prevOutScripts` | `readonly Script[]` | Yes | Array of previous output scripts for all inputs |
| `values` | `readonly Satoshi[]` | Yes | Array of previous output values for all inputs |

Returns a `TaprootHashCache` object containing five 32-byte intermediate hashes.

```typescript
import { Transaction } from '@btc-vision/bitcoin';
import type { Satoshi, Script } from '@btc-vision/bitcoin';

const tx = new Transaction();
tx.version = 2;
// ... add multiple inputs and outputs ...

const prevOutScripts: Script[] = [script0, script1, script2];
const values: Satoshi[] = [10000n as Satoshi, 20000n as Satoshi, 30000n as Satoshi];

// Compute cache once
const cache = tx.getTaprootHashCache(prevOutScripts, values);

// Sign each input using the cache
for (let i = 0; i < tx.ins.length; i++) {
    const sighash = tx.hashForWitnessV1(
        i,
        prevOutScripts,
        values,
        Transaction.SIGHASH_DEFAULT,
        undefined,    // no leafHash (key-path spend)
        undefined,    // no annex
        cache,        // reuse pre-computed hashes
    );
    // Sign sighash with the private key for input i
}
```

---

## Sighash Types Explained

The sighash type controls which parts of the transaction are covered by the signature. It is a single byte composed of an output mode (lower bits) and an optional input modifier (upper bit).

### Output Modes

| Type | Value | Inputs Signed | Outputs Signed |
|------|-------|---------------|----------------|
| `SIGHASH_ALL` | `0x01` | All | All |
| `SIGHASH_NONE` | `0x02` | All | None |
| `SIGHASH_SINGLE` | `0x03` | All | Only the output at the same index as the signed input |

### Input Modifier

| Modifier | Value | Effect |
|----------|-------|--------|
| `SIGHASH_ANYONECANPAY` | `0x80` | Only sign the current input (others may be added/removed) |

### Taproot-Specific

| Type | Value | Description |
|------|-------|-------------|
| `SIGHASH_DEFAULT` | `0x00` | Taproot only. Semantically identical to `SIGHASH_ALL` but produces a different byte in the signature serialization. A 64-byte Schnorr signature (without appended sighash byte) implicitly means `SIGHASH_DEFAULT`. |

### Combining Modifiers

Combine an output mode with the input modifier using bitwise OR:

```typescript
// Sign only this input, and only the matching output
const hashType = Transaction.SIGHASH_SINGLE | Transaction.SIGHASH_ANYONECANPAY;
// hashType === 0x83
```

### All Valid Combinations

| Combination | Value | Description |
|-------------|-------|-------------|
| `SIGHASH_ALL` | `0x01` | All inputs, all outputs |
| `SIGHASH_NONE` | `0x02` | All inputs, no outputs |
| `SIGHASH_SINGLE` | `0x03` | All inputs, matching output |
| `SIGHASH_ALL \| SIGHASH_ANYONECANPAY` | `0x81` | This input only, all outputs |
| `SIGHASH_NONE \| SIGHASH_ANYONECANPAY` | `0x82` | This input only, no outputs |
| `SIGHASH_SINGLE \| SIGHASH_ANYONECANPAY` | `0x83` | This input only, matching output |

---

## Complete Examples

### Creating a Transaction from Scratch

```typescript
import { Transaction, address, fromHex } from '@btc-vision/bitcoin';
import type { Bytes32, Satoshi, Script } from '@btc-vision/bitcoin';

// Create a new transaction
const tx = new Transaction();
tx.version = 2;

// Add an input referencing a previous transaction output
const prevTxHash = fromHex(
    'a1b2c3d4e5f6071829304a5b6c7d8e9f0011223344556677a1b2c3d4e5f60718'
) as Bytes32;
tx.addInput(prevTxHash, 0);

// Optionally set a custom sequence for RBF (replace-by-fee)
tx.addInput(prevTxHash, 1, 0xfffffffd);

// Add outputs
const outputScript = address.toOutputScript('bc1qexampleaddress...');
tx.addOutput(outputScript, 49000n as Satoshi);

// Set locktime (optional)
tx.locktime = 800000;

console.log(tx.ins.length);  // 2
console.log(tx.outs.length); // 1
```

### Serializing and Deserializing

```typescript
import { Transaction } from '@btc-vision/bitcoin';

// Serialize to hex
const tx = new Transaction();
tx.version = 2;
// ... add inputs and outputs ...
const hex = tx.toHex();

// Deserialize from hex
const parsed = Transaction.fromHex(hex);
console.log(parsed.version);  // 2
console.log(parsed.getId());  // txid as hex string

// Serialize to buffer
const buffer = tx.toBuffer();

// Deserialize from buffer
const parsed2 = Transaction.fromBuffer(buffer);
```

### Cloning a Transaction

```typescript
import { Transaction } from '@btc-vision/bitcoin';

const original = Transaction.fromHex('0200000001...');
const clone = original.clone();

// The clone is independent of the original
clone.locktime = 900000;
console.log(original.locktime !== clone.locktime); // true
```

### Computing Transaction Size and Weight

```typescript
import { Transaction } from '@btc-vision/bitcoin';

const tx = Transaction.fromHex('0200000001...');

// Size without witness data
const baseSize = tx.byteLength(false);

// Size with witness data (if present)
const totalSize = tx.byteLength(true);

// BIP 141 weight
const weight = tx.weight();

// Virtual size for fee calculation
const vsize = tx.virtualSize();

console.log(`Base size: ${baseSize} bytes`);
console.log(`Total size: ${totalSize} bytes`);
console.log(`Weight: ${weight} WU`);
console.log(`Virtual size: ${vsize} vbytes`);
```

### Legacy Input Signing

```typescript
import { Transaction } from '@btc-vision/bitcoin';
import type { Script } from '@btc-vision/bitcoin';

const tx = new Transaction();
tx.version = 1;
// ... add inputs and outputs ...

// Produce the sighash for legacy signing
const sighash = tx.hashForSignature(
    0,                         // input index
    prevOutScript as Script,   // the scriptPubKey of the UTXO being spent
    Transaction.SIGHASH_ALL,
);

// Sign the sighash with an ECDSA private key
// const signature = ecpair.sign(sighash);

// Set the scriptSig with the signature and public key
// tx.setInputScript(0, scriptSig);
```

### SegWit v0 Input Signing

```typescript
import { Transaction } from '@btc-vision/bitcoin';
import type { Satoshi, Script } from '@btc-vision/bitcoin';

const tx = new Transaction();
tx.version = 2;
// ... add inputs and outputs ...

// BIP 143 sighash commits to the input value
const sighash = tx.hashForWitnessV0(
    0,                          // input index
    prevOutScript as Script,    // scriptCode for this input
    100000n as Satoshi,         // value of the UTXO being spent
    Transaction.SIGHASH_ALL,
);

// Sign and set witness
// const signature = ecpair.sign(sighash);
// tx.setWitness(0, [signature, publicKey]);
```

### Taproot Key-Path Signing

```typescript
import { Transaction } from '@btc-vision/bitcoin';
import type { Satoshi, Script } from '@btc-vision/bitcoin';

const tx = new Transaction();
tx.version = 2;
// ... add inputs and outputs ...

// Taproot sighash requires scripts and values for ALL inputs
const prevOutScripts: Script[] = [utxo0ScriptPubKey, utxo1ScriptPubKey];
const values: Satoshi[] = [50000n as Satoshi, 75000n as Satoshi];

// Key-path spend: no leafHash
const sighash = tx.hashForWitnessV1(
    0,                              // input index
    prevOutScripts,
    values,
    Transaction.SIGHASH_DEFAULT,    // 0x00 for default key-path
);

// Sign with Schnorr signature
// const schnorrSig = tweakedKeypair.signSchnorr(sighash);
// tx.setWitness(0, [schnorrSig]);
```

### Taproot Script-Path Signing with Cache

```typescript
import { Transaction } from '@btc-vision/bitcoin';
import type { Bytes32, Satoshi, Script } from '@btc-vision/bitcoin';

const tx = new Transaction();
tx.version = 2;
// ... add inputs and outputs ...

const prevOutScripts: Script[] = [script0, script1, script2];
const values: Satoshi[] = [10000n as Satoshi, 20000n as Satoshi, 30000n as Satoshi];

// Pre-compute intermediate hashes once
const cache = tx.getTaprootHashCache(prevOutScripts, values);

// Sign each input with the cache for O(n) total performance
for (let i = 0; i < tx.ins.length; i++) {
    const sighash = tx.hashForWitnessV1(
        i,
        prevOutScripts,
        values,
        Transaction.SIGHASH_DEFAULT,
        leafHash as Bytes32,    // tapleaf hash for script-path spend
        undefined,              // no annex
        cache,                  // reuse pre-computed hashes
    );
    // Sign sighash and set witness for input i
}
```

### Checking for Coinbase Transactions

```typescript
import { Transaction } from '@btc-vision/bitcoin';

const tx = Transaction.fromHex('0100000001000000000000000000000000...');

if (tx.isCoinbase()) {
    console.log('This is a coinbase transaction (block reward)');
}

// Static method to check a hash directly
import type { Bytes32 } from '@btc-vision/bitcoin';
const hash = new Uint8Array(32) as Bytes32; // all zeros
console.log(Transaction.isCoinbaseHash(hash)); // true
```

### Setting Witness Data

```typescript
import { Transaction, fromHex } from '@btc-vision/bitcoin';

const tx = Transaction.fromHex('0200000001...');

// Set witness for a P2WPKH input
tx.setWitness(0, [
    fromHex('3045022100...'),   // DER-encoded signature
    fromHex('02abcdef...'),     // compressed public key
]);

// Verify witness is set
console.log(tx.hasWitnesses()); // true
console.log(tx.ins[0].witness.length); // 2
```

---

## Transaction Serialization Format

### Legacy Format

```
[version: 4 bytes]
[input count: varint]
  [prev tx hash: 32 bytes][prev output index: 4 bytes][scriptSig: varint + bytes][sequence: 4 bytes]
  ...
[output count: varint]
  [value: 8 bytes][scriptPubKey: varint + bytes]
  ...
[locktime: 4 bytes]
```

### SegWit Format (BIP 141)

```
[version: 4 bytes]
[marker: 0x00][flag: 0x01]
[input count: varint]
  [prev tx hash: 32 bytes][prev output index: 4 bytes][scriptSig: varint + bytes][sequence: 4 bytes]
  ...
[output count: varint]
  [value: 8 bytes][scriptPubKey: varint + bytes]
  ...
[witness data]
  [witness stack for input 0: varint count + varint-length items]
  [witness stack for input 1: ...]
  ...
[locktime: 4 bytes]
```

The `marker` (`0x00`) and `flag` (`0x01`) bytes distinguish SegWit transactions from legacy ones during parsing. The `Transaction` class handles this automatically in both `fromBuffer` and `toBuffer`.
