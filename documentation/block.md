# Block

The `Block` class represents a Bitcoin block, including its 80-byte header and optional array of transactions. It provides methods for parsing raw block data, computing block hashes and IDs, validating proof-of-work, verifying merkle roots, and handling SegWit witness commitments (BIP 141).

## Overview

| Property | Value |
|----------|-------|
| Header size | 80 bytes |
| Hash algorithm | Double SHA-256 (`hash256`) |
| Block ID format | Reversed hash as hex (matches block explorers) |
| Witness commitment | BIP 141 (`OP_RETURN` with prefix `0x6a24aa21a9ed`) |
| Weight formula | `base_size * 3 + total_size` |

---

## Installation

```typescript
import { Block } from '@btc-vision/bitcoin';
```

---

## Block Header Structure

Every Bitcoin block begins with an 80-byte header containing six fields, serialized in the following order:

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `version` | `int32le` | 4 bytes | Block version number (signed, little-endian) |
| `prevHash` | `Bytes32` | 32 bytes | Hash of the previous block header |
| `merkleRoot` | `Bytes32` | 32 bytes | Merkle root of the block's transactions |
| `timestamp` | `uint32le` | 4 bytes | Block timestamp as Unix epoch seconds |
| `bits` | `uint32le` | 4 bytes | Compact target threshold for proof-of-work |
| `nonce` | `uint32le` | 4 bytes | Nonce value iterated during mining |

After the header, a full block contains a varint transaction count followed by the serialized transactions.

```
[version:4][prevHash:32][merkleRoot:32][timestamp:4][bits:4][nonce:4][txCount:varint][tx0][tx1]...[txN]
```

---

## Class: Block

```typescript
class Block {
    // Header fields
    version: number;
    prevHash?: Bytes32;
    merkleRoot?: Bytes32;
    timestamp: number;
    bits: number;
    nonce: number;

    // Body
    transactions?: Transaction[];

    // Witness (BIP 141)
    witnessCommit?: Bytes32;

    // Static methods
    static fromBuffer(buffer: Uint8Array): Block;
    static fromHex(hex: string): Block;
    static calculateTarget(bits: number): Bytes32;
    static calculateMerkleRoot(transactions: Transaction[], forWitness?: boolean): Bytes32;

    // Instance methods
    getHash(): Bytes32;
    getId(): string;
    getUTCDate(): Date;
    getWitnessCommit(): Bytes32 | null;
    hasWitnessCommit(): boolean;
    hasWitness(): boolean;
    weight(): number;
    byteLength(headersOnly?: boolean, allowWitness?: boolean): number;
    checkTxRoots(): boolean;
    checkProofOfWork(): boolean;
    toBuffer(headersOnly?: boolean): Uint8Array;
    toHex(headersOnly?: boolean): string;
}
```

---

## Instance Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `version` | `number` | `1` | Block version number, interpreted as a signed 32-bit integer (little-endian). Version 2+ signals BIP 34 (height in coinbase). |
| `prevHash` | `Bytes32 \| undefined` | `undefined` | 32-byte hash of the previous block header. The genesis block uses all zeros. |
| `merkleRoot` | `Bytes32 \| undefined` | `undefined` | 32-byte merkle root computed from the double-SHA256 hashes of all transactions in the block. |
| `timestamp` | `number` | `0` | Block timestamp in Unix epoch seconds. Must be greater than the median of the last 11 blocks. |
| `bits` | `number` | `0` | Compact encoding of the target threshold. The block hash must be less than or equal to the expanded target for the proof-of-work to be valid. |
| `nonce` | `number` | `0` | 32-bit nonce value. Miners iterate this field to search for a valid proof-of-work. |
| `transactions` | `Transaction[] \| undefined` | `undefined` | Array of transactions in the block. `undefined` when only the 80-byte header was parsed. The first transaction is always the coinbase. |
| `witnessCommit` | `Bytes32 \| undefined` | `undefined` | 32-byte witness commitment extracted from the coinbase transaction's `OP_RETURN` output. Present only for SegWit blocks (BIP 141). |

---

## Static Methods

### Block.fromBuffer(buffer)

Parses a `Block` from a raw `Uint8Array`. If the buffer is exactly 80 bytes, only the header fields are populated and `transactions` remains `undefined`. If the buffer is longer, the transaction data following the header is deserialized, and the witness commitment is extracted if present.

```typescript
static fromBuffer(buffer: Uint8Array): Block;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `buffer` | `Uint8Array` | Raw block data (minimum 80 bytes) |

**Returns:** A fully populated `Block` instance.

**Throws:** `Error` if the buffer is smaller than 80 bytes.

```typescript
import { Block, fromHex } from '@btc-vision/bitcoin';

// Parse a header-only block (80 bytes = 160 hex chars)
const headerHex =
    '020000003385c4b2a3499669987f5d04fa4127b59dbf2ee625694fa0bf08000000000000' +
    'cf52f0ed6571367818a801a169e64030d8cab1a9f17e27170a6924127e19dbb8' +
    'eba43e54ffff001d12052ce0';
const block = Block.fromBuffer(fromHex(headerHex));

console.log(block.version);       // 2
console.log(block.timestamp);     // 1413391595
console.log(block.transactions);  // undefined (header only)
```

---

### Block.fromHex(hex)

Convenience wrapper around `fromBuffer` that accepts a hex string instead of a `Uint8Array`.

```typescript
static fromHex(hex: string): Block;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `hex` | `string` | Hexadecimal representation of the block |

**Returns:** A fully populated `Block` instance.

```typescript
import { Block } from '@btc-vision/bitcoin';

const block = Block.fromHex('020000003385c4b2a349...');
console.log(block.version); // 2
```

---

### Block.calculateTarget(bits)

Expands the compact `bits` field from the block header into the full 32-byte target threshold. The compact format encodes the target as a 3-byte mantissa with a 1-byte exponent.

```typescript
static calculateTarget(bits: number): Bytes32;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `bits` | `number` | Compact bits value from the block header |

**Returns:** 32-byte target threshold as `Bytes32`.

The encoding works as follows:
- The top byte `(bits >> 24)` is the exponent.
- The lower 3 bytes `(bits & 0x007fffff)` are the mantissa.
- The target is `mantissa * 2^(8 * (exponent - 3))`.

```typescript
import { Block } from '@btc-vision/bitcoin';
import { toHex } from '@btc-vision/bitcoin';

// Bitcoin mainnet difficulty 1 target
const target = Block.calculateTarget(0x1d00ffff);
console.log(toHex(target));
// '00000000ffff0000000000000000000000000000000000000000000000000000'
```

---

### Block.calculateMerkleRoot(transactions, forWitness?)

Computes the merkle root from an array of transactions. When `forWitness` is `true`, computes the witness merkle root used in BIP 141 witness commitments by hashing with witness data and combining with the coinbase witness nonce.

```typescript
static calculateMerkleRoot(transactions: Transaction[], forWitness?: boolean): Bytes32;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `transactions` | `Transaction[]` | Array of transactions |
| `forWitness` | `boolean \| undefined` | If `true`, calculate the witness merkle root |

**Returns:** 32-byte merkle root as `Bytes32`.

**Throws:**
- `TypeError` if `transactions` is empty or not an array.
- `TypeError` if `forWitness` is `true` but the coinbase has no witness data.

```typescript
import { Block } from '@btc-vision/bitcoin';
import { toHex } from '@btc-vision/bitcoin';

const block = Block.fromHex(fullBlockHex);
const merkleRoot = Block.calculateMerkleRoot(block.transactions!);
console.log(toHex(merkleRoot)); // matches block.merkleRoot
```

---

## Instance Methods

### block.getHash()

Computes the double-SHA256 hash of the 80-byte block header. This is the raw 32-byte hash in internal byte order (little-endian).

```typescript
getHash(): Bytes32;
```

**Returns:** 32-byte block hash as `Bytes32`.

```typescript
import { Block } from '@btc-vision/bitcoin';
import { toHex } from '@btc-vision/bitcoin';

const block = Block.fromHex(blockHex);
const hash = block.getHash();
console.log(toHex(hash));
// '55388f8f9b326bd0b8e50fbe44c1903d4be14febcfad4dffa50c846c00000000'
```

---

### block.getId()

Returns the block hash as a hex string in reversed byte order, matching the format used by block explorers and Bitcoin RPC.

```typescript
getId(): string;
```

**Returns:** Block ID as a hex string.

The difference between `getHash()` and `getId()` is byte order. Bitcoin displays block hashes with the bytes reversed from the internal representation.

```typescript
import { Block } from '@btc-vision/bitcoin';

const block = Block.fromHex(blockHex);
console.log(block.getId());
// '000000006c840ca5ff4dadcfeb4fe14b3d90c144be0fe5b8d06b329b8f8f3855'
```

---

### block.getWitnessCommit()

Extracts the witness commitment hash from the coinbase transaction. The witness commitment is stored in an `OP_RETURN` output of the coinbase transaction, prefixed with `0x6a24aa21a9ed`. If multiple outputs match, the one with the highest index is used.

```typescript
getWitnessCommit(): Bytes32 | null;
```

**Returns:** 32-byte witness commitment, or `null` if the block has no witness commitment.

```typescript
import { Block } from '@btc-vision/bitcoin';
import { toHex } from '@btc-vision/bitcoin';

const block = Block.fromHex(segwitBlockHex);
const commit = block.getWitnessCommit();
if (commit) {
    console.log(toHex(commit)); // 32-byte witness commitment
}
```

---

### block.hasWitnessCommit()

Checks whether the block contains a witness commitment, either from the already-set `witnessCommit` property or by scanning the coinbase transaction outputs.

```typescript
hasWitnessCommit(): boolean;
```

**Returns:** `true` if a witness commitment is present.

---

### block.hasWitness()

Checks whether any transaction in the block contains witness data.

```typescript
hasWitness(): boolean;
```

**Returns:** `true` if any transaction has non-empty witness fields. Returns `false` if `transactions` is `undefined`.

---

### block.checkProofOfWork()

Validates the block's proof-of-work by comparing the block hash against the target threshold derived from the `bits` field. The block hash (in reversed byte order) must be less than or equal to the target.

```typescript
checkProofOfWork(): boolean;
```

**Returns:** `true` if the block hash satisfies the target difficulty.

```typescript
import { Block } from '@btc-vision/bitcoin';

const block = Block.fromHex(blockHex);

if (block.checkProofOfWork()) {
    console.log('Block has valid proof-of-work');
} else {
    console.log('Invalid proof-of-work');
}
```

---

### block.checkTxRoots()

Validates both the transaction merkle root and the witness commitment (if present). Returns `false` if the block has witness data in its transactions but no witness commitment in the coinbase.

```typescript
checkTxRoots(): boolean;
```

**Returns:** `true` if the merkle root and witness commitment (when applicable) are valid.

| Throws | Condition |
|--------|-----------|
| `TypeError` | Block has no `transactions` array (header-only block). Message: `"Cannot compute merkle root for zero transactions"` |
| `TypeError` | Block has no `merkleRoot` set. Message: `"Block merkleRoot is required"` |

```typescript
import { Block } from '@btc-vision/bitcoin';

const block = Block.fromHex(fullBlockHex);
console.log(block.checkTxRoots()); // true for valid blocks
```

---

### block.weight()

Calculates the block weight as defined by BIP 141. Weight is used for block size limits in SegWit (maximum 4,000,000 weight units).

```typescript
weight(): number;
```

**Returns:** Block weight in weight units.

**Formula:** `weight = base_size * 3 + total_size`

Where `base_size` is the serialized size without witness data, and `total_size` includes witness data.

---

### block.byteLength(headersOnly?, allowWitness?)

Calculates the serialized byte length of the block.

```typescript
byteLength(headersOnly?: boolean, allowWitness?: boolean): number;
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `headersOnly` | `boolean \| undefined` | `undefined` | If `true`, returns 80 (header size only) |
| `allowWitness` | `boolean` | `true` | If `true`, includes witness data in the calculation |

**Returns:** Byte length of the serialized block.

```typescript
const block = Block.fromHex(fullBlockHex);

console.log(block.byteLength(true));          // 80 (header only)
console.log(block.byteLength(false, false));  // stripped size (no witness)
console.log(block.byteLength(false, true));   // total size (with witness)
```

---

### block.getUTCDate()

Converts the block's `timestamp` field to a JavaScript `Date` object.

```typescript
getUTCDate(): Date;
```

**Returns:** `Date` object representing the block time in UTC.

```typescript
const block = Block.fromHex(blockHex);
console.log(block.getUTCDate().toISOString());
// '2014-10-15T19:33:15.000Z'
```

---

### block.toBuffer(headersOnly?)

Serializes the block to a `Uint8Array`. When `headersOnly` is `true`, only the 80-byte header is serialized. Otherwise, the full block including all transactions is serialized.

```typescript
toBuffer(headersOnly?: boolean): Uint8Array;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `headersOnly` | `boolean \| undefined` | If `true`, serialize only the 80-byte header |

**Returns:** Serialized block data as `Uint8Array`.

**Throws:** `TypeError` if `prevHash` or `merkleRoot` is not set.

```typescript
const block = Block.fromHex(blockHex);

const headerBytes = block.toBuffer(true);   // 80 bytes
const fullBytes = block.toBuffer();          // full block
```

---

### block.toHex(headersOnly?)

Serializes the block to a hex string. This is a convenience wrapper around `toBuffer()`.

```typescript
toHex(headersOnly?: boolean): string;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `headersOnly` | `boolean \| undefined` | If `true`, serialize only the 80-byte header |

**Returns:** Hex string representation of the block.

```typescript
const block = Block.fromHex(blockHex);
const headerHex = block.toHex(true);  // 160-character hex string (80 bytes)
const fullHex = block.toHex();         // full block as hex
```

---

## Witness Commitment (BIP 141)

SegWit blocks include a witness commitment in the coinbase transaction. The commitment is stored in an `OP_RETURN` output identified by the 6-byte prefix `0x6a24aa21a9ed`:

```
OP_RETURN OP_PUSHBYTES_36 0xaa21a9ed <32-byte witness commitment>
```

The witness commitment is computed as:

```
witness_root = merkle_root(witness_hashes_of_all_transactions)
witness_commitment = hash256(witness_root || witness_nonce)
```

Where `witness_nonce` is a 32-byte value stored in the coinbase input's witness field (typically all zeros).

The `Block` class handles witness commitments automatically:

1. `fromBuffer()` / `fromHex()` -- Extracts the witness commitment during parsing and sets `witnessCommit`.
2. `getWitnessCommit()` -- Scans the coinbase outputs for the commitment prefix and returns the 32-byte hash.
3. `hasWitnessCommit()` -- Checks if a witness commitment exists.
4. `checkTxRoots()` -- Validates both the standard merkle root and the witness commitment.

```typescript
import { Block } from '@btc-vision/bitcoin';
import { toHex } from '@btc-vision/bitcoin';

const block = Block.fromHex(segwitBlockHex);

// Check for witness data
console.log(block.hasWitness());        // true
console.log(block.hasWitnessCommit());  // true

// Access the witness commitment
if (block.witnessCommit) {
    console.log(toHex(block.witnessCommit));
}

// Validate witness merkle root
console.log(block.checkTxRoots()); // true
```

---

## Examples

### Parsing a Block from Hex

```typescript
import { Block } from '@btc-vision/bitcoin';
import { toHex } from '@btc-vision/bitcoin';

const blockHex = '020000003385c4b2a3499669987f5d04fa4127b59dbf2ee625694fa0bf' +
    '08000000000000cf52f0ed6571367818a801a169e64030d8cab1a9f17e27170a6924127e' +
    '19dbb8eba43e54ffff001d12052ce00101000000010000000000000000000000000000000' +
    '000000000000000000000000000000000ffffffff2403089904174b6e434d696e65724251' +
    '521defe5cdcf04ad543ea4eb0101000000165e0000ffffffff0100f90295000000001976a' +
    '9149e8985f82bc4e0f753d0492aa8d11cc39925774088ac00000000';

const block = Block.fromHex(blockHex);

// Header fields
console.log('Version:', block.version);           // 2
console.log('Timestamp:', block.timestamp);        // 1413391595
console.log('Bits:', block.bits);                  // 486604799
console.log('Nonce:', block.nonce);                // 3760981266
console.log('Previous Hash:', toHex(block.prevHash!));
console.log('Merkle Root:', toHex(block.merkleRoot!));

// Block identification
console.log('Block ID:', block.getId());
// '000000006c840ca5ff4dadcfeb4fe14b3d90c144be0fe5b8d06b329b8f8f3855'

// Date
console.log('Date:', block.getUTCDate().toISOString());
// '2014-10-15T19:33:15.000Z'
```

---

### Checking Proof-of-Work

```typescript
import { Block } from '@btc-vision/bitcoin';
import { toHex } from '@btc-vision/bitcoin';

const block = Block.fromHex(blockHex);

// Compute the target from the bits field
const target = Block.calculateTarget(block.bits);
console.log('Target:', toHex(target));
// '00000000ffff0000000000000000000000000000000000000000000000000000'

// Validate proof-of-work
if (block.checkProofOfWork()) {
    console.log('Valid PoW: block hash is below target');
} else {
    console.log('Invalid PoW: block hash exceeds target');
}
```

---

### Accessing Transactions

```typescript
import { Block } from '@btc-vision/bitcoin';
import { toHex } from '@btc-vision/bitcoin';

const block = Block.fromHex(fullBlockHex);

if (block.transactions) {
    console.log('Transaction count:', block.transactions.length);

    // The first transaction is always the coinbase
    const coinbase = block.transactions[0];
    console.log('Coinbase TX ID:', coinbase.getId());

    // Iterate over all transactions
    for (const tx of block.transactions) {
        console.log('TX:', tx.getId(), 'Inputs:', tx.ins.length, 'Outputs:', tx.outs.length);
    }
} else {
    console.log('Header-only block, no transactions available');
}
```

---

### Validating Merkle Roots

```typescript
import { Block } from '@btc-vision/bitcoin';
import { toHex } from '@btc-vision/bitcoin';

const block = Block.fromHex(fullBlockHex);

// Recompute and compare the merkle root
const computed = Block.calculateMerkleRoot(block.transactions!);
console.log('Header merkle root:', toHex(block.merkleRoot!));
console.log('Computed merkle root:', toHex(computed));

// Validate both merkle root and witness commitment in one call
console.log('Roots valid:', block.checkTxRoots()); // true
```

---

### Round-Trip Serialization

```typescript
import { Block } from '@btc-vision/bitcoin';

const original = '020000003385c4b2a3499669...'; // full block hex
const block = Block.fromHex(original);

// Serialize back to hex
const headerOnly = block.toHex(true);   // 80-byte header (160 hex chars)
const full = block.toHex();              // full block including transactions

// The round-trip preserves the original data
console.log(full === original); // true
```

---

### Block Weight and Size

```typescript
import { Block } from '@btc-vision/bitcoin';

const block = Block.fromHex(fullBlockHex);

// Header size is always 80 bytes
console.log('Header size:', block.byteLength(true)); // 80

// Stripped size excludes witness data
const strippedSize = block.byteLength(false, false);
console.log('Stripped size:', strippedSize);

// Total size includes witness data
const totalSize = block.byteLength(false, true);
console.log('Total size:', totalSize);

// Weight = stripped_size * 3 + total_size
console.log('Weight:', block.weight());
console.log('Matches formula:', block.weight() === strippedSize * 3 + totalSize); // true
```

---

## Compact Target Encoding (bits)

The `bits` field uses Bitcoin's compact representation of the 256-bit target threshold. The format splits the 4-byte value into an exponent and mantissa:

```
bits = 0xEEMMMMMMM

exponent = (bits >> 24) - 3
mantissa = bits & 0x007fffff
target[29 - exponent .. 29 - exponent + 2] = mantissa (big-endian)
```

| bits (hex) | Expanded Target |
|------------|-----------------|
| `0x1d00ffff` | `00000000ffff0000000000000000000000000000000000000000000000000000` |
| `0x1b0404cb` | `00000000000404cb000000000000000000000000000000000000000000000000` |
| `0x1814dd04` | `000000000000000014dd04000000000000000000000000000000000000000000` |

A block's proof-of-work is valid when its double-SHA256 hash, interpreted as a 256-bit big-endian number, is less than or equal to the expanded target.
