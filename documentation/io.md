# I/O Utilities

High-performance binary I/O module providing encoding, decoding, buffer manipulation, and stateful binary reading/writing with zero-allocation operations through reused DataView instances.

## Overview

| Category | Functions / Classes |
|----------|-------------------|
| Hex encoding | `toHex()`, `fromHex()`, `isHex()` |
| Base64 encoding | `fromBase64()`, `toBase64()` |
| Base58Check encoding | `base58check.encode()`, `base58check.decode()`, `base58check.decodeUnsafe()` |
| Buffer utilities | `concat()`, `equals()`, `compare()`, `isZero()`, `clone()`, `reverse()`, `reverseCopy()`, `alloc()`, `xor()` |
| UTF-8 utilities | `fromUtf8()`, `toUtf8()` |
| Variable-length integers | `varuint.encode()`, `varuint.decode()`, `varuint.encodingLength()` |
| Binary reading | `BinaryReader` class |
| Binary writing | `BinaryWriter`, `GrowableBinaryWriter` classes |

---

## Installation

Most I/O utilities (hex, base64, buffer utilities, UTF-8, varuint) are re-exported from the main entry point. However, `base58check`, `BinaryReader`, `BinaryWriter`, and `GrowableBinaryWriter` are only available from the `@btc-vision/bitcoin/io` subpath.

```typescript
// These are available from the main entry point:
import {
    // Hex
    toHex, fromHex, isHex,
    // Base64
    fromBase64, toBase64,
    // Buffer utilities
    concat, equals, compare, isZero, clone, reverse, reverseCopy, alloc, xor,
    // UTF-8
    fromUtf8, toUtf8,
    // Variable-length integers
    varuint,
} from '@btc-vision/bitcoin';

// These are only available from the io subpath:
import {
    base58check,
    BinaryReader, BinaryWriter, GrowableBinaryWriter,
} from '@btc-vision/bitcoin/io';
```

> **Note:** `@btc-vision/bs58check` (the underlying Base58Check implementation) is listed under `devDependencies`, not `dependencies`. If your project uses `base58check` directly, ensure that `@btc-vision/bs58check` is installed in your own project's dependencies.

---

## Hex Encoding

Optimized hex encoding and decoding using pre-computed lookup tables for O(1) per-byte conversion. Zero dependencies.

### toHex

Converts a `Uint8Array` to a lowercase hex string.

```typescript
function toHex(bytes: Uint8Array): string;
```

```typescript
import { toHex } from '@btc-vision/bitcoin';

const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
const hex = toHex(bytes);
console.log(hex); // 'deadbeef'
```

### fromHex

Converts a hex string to a `Uint8Array`. Accepts hex strings with or without `0x` prefix. Case-insensitive.

```typescript
function fromHex(hex: string): Uint8Array;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `hex` | `string` | Hex string to convert (with or without `0x` prefix) |

| Throws | Condition |
|--------|-----------|
| `TypeError` | Hex string has odd length |
| `TypeError` | Hex string contains invalid characters |

```typescript
import { fromHex, toHex } from '@btc-vision/bitcoin';

const bytes = fromHex('deadbeef');
console.log(bytes); // Uint8Array [222, 173, 190, 239]

// Works with 0x prefix
const bytes2 = fromHex('0xCAFEBABE');
console.log(toHex(bytes2)); // 'cafebabe'
```

### isHex

Checks if a string is valid hexadecimal. Validates even length and valid hex characters. Accepts optional `0x` prefix.

```typescript
function isHex(value: string): boolean;
```

```typescript
import { isHex } from '@btc-vision/bitcoin';

isHex('deadbeef');   // true
isHex('0xdeadbeef'); // true
isHex('DEADBEEF');   // true
isHex('deadbee');    // false (odd length)
isHex('deadbeeg');   // false (invalid char 'g')
```

---

## Base64 Encoding

Base64 encoding and decoding using the native `atob()`/`btoa()` functions available in both browser and service worker contexts.

### fromBase64

Decodes a base64 string to a `Uint8Array`.

```typescript
function fromBase64(base64: string): Uint8Array;
```

```typescript
import { fromBase64, toHex } from '@btc-vision/bitcoin';

const bytes = fromBase64('3q2+7w==');
console.log(toHex(bytes)); // 'deadbeef'
```

### toBase64

Encodes a `Uint8Array` into a base64 string.

```typescript
function toBase64(bytes: Uint8Array): string;
```

```typescript
import { toBase64, fromHex } from '@btc-vision/bitcoin';

const bytes = fromHex('deadbeef');
const encoded = toBase64(bytes);
console.log(encoded); // '3q2+7w=='
```

---

## Base58Check Encoding

Base58Check encoding with checksum verification, re-exported from `@btc-vision/bs58check`. Used for legacy Bitcoin addresses and WIF private keys.

> **Note:** `@btc-vision/bs58check` is a `devDependency` of this package, not a runtime `dependency`. If your project relies on `base58check`, you should add `@btc-vision/bs58check` to your own project's `dependencies`.

### base58check.encode

Encodes a `Uint8Array` payload into a Base58Check string (with 4-byte checksum appended).

```typescript
function encode(payload: Uint8Array): string;
```

```typescript
import { base58check } from '@btc-vision/bitcoin/io';
import { fromHex } from '@btc-vision/bitcoin';

// Encode a version byte + hash160 into a legacy address
const payload = fromHex('0014...'); // version prefix + payload
const address = base58check.encode(payload);
console.log(address); // '1...' or '3...'
```

### base58check.decode

Decodes a Base58Check string into a `Uint8Array`. Verifies the 4-byte checksum and throws on invalid input.

```typescript
function decode(str: string): Uint8Array;
```

```typescript
import { base58check } from '@btc-vision/bitcoin/io';
import { toHex } from '@btc-vision/bitcoin';

const payload = base58check.decode('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
console.log(toHex(payload)); // version byte + 20-byte pubkey hash
```

### base58check.decodeUnsafe

Decodes a Base58Check string, returning `undefined` instead of throwing on invalid input.

```typescript
function decodeUnsafe(str: string): Uint8Array | undefined;
```

```typescript
import { base58check } from '@btc-vision/bitcoin/io';

const result = base58check.decodeUnsafe('invalidstring');
if (result === undefined) {
    console.log('Invalid Base58Check string');
}
```

---

## Buffer Utilities

Pure utility functions for `Uint8Array` operations. No DataView allocations. Optimized for performance with minimal allocations.

### concat

Concatenates multiple `Uint8Array` instances into a single array. Allocates exactly once for the result.

```typescript
function concat(arrays: readonly Uint8Array[]): Uint8Array;
```

```typescript
import { concat, fromHex, toHex } from '@btc-vision/bitcoin';

const a = fromHex('deadbeef');
const b = fromHex('cafebabe');
const result = concat([a, b]);
console.log(toHex(result)); // 'deadbeefcafebabe'
```

### equals

Checks if two `Uint8Array` instances have identical contents.

```typescript
function equals(a: Uint8Array, b: Uint8Array): boolean;
```

```typescript
import { equals, fromHex } from '@btc-vision/bitcoin';

const a = fromHex('deadbeef');
const b = fromHex('deadbeef');
const c = fromHex('cafebabe');

equals(a, b); // true
equals(a, c); // false
```

### compare

Compares two `Uint8Array` instances lexicographically. Returns a negative number if `a < b`, positive if `a > b`, and `0` if equal.

> **Note:** The return value is the arithmetic difference between the first differing bytes (or the difference in lengths), not a normalized -1/0/1. For example, comparing `0x01` to `0x03` returns `-2`, not `-1`.

```typescript
function compare(a: Uint8Array, b: Uint8Array): number;
```

```typescript
import { compare, fromHex } from '@btc-vision/bitcoin';

const a = fromHex('0001');
const b = fromHex('0002');

compare(a, b); // -1 (a < b, difference: 0x01 - 0x02)
compare(b, a); //  1 (b > a, difference: 0x02 - 0x01)
compare(a, a); //  0 (equal)

// The return value is the arithmetic difference, not normalized to -1/0/1:
const x = fromHex('0001');
const y = fromHex('0005');
compare(x, y); // -4 (difference: 0x01 - 0x05)
```

### isZero

Checks if a `Uint8Array` contains only zero bytes.

```typescript
function isZero(bytes: Uint8Array): boolean;
```

```typescript
import { isZero } from '@btc-vision/bitcoin';

isZero(new Uint8Array(32));            // true
isZero(new Uint8Array([0, 0, 1]));     // false
```

### clone

Creates an independent copy of a `Uint8Array`. Modifications to the clone do not affect the original.

```typescript
function clone(bytes: Uint8Array): Uint8Array;
```

```typescript
import { clone, fromHex } from '@btc-vision/bitcoin';

const original = fromHex('deadbeef');
const copy = clone(original);
copy[0] = 0; // Modifying copy doesn't affect original
```

### reverse

Reverses a `Uint8Array` **in place**. Returns the same array reference.

```typescript
function reverse(bytes: Uint8Array): Uint8Array;
```

```typescript
import { reverse, fromHex, toHex } from '@btc-vision/bitcoin';

const bytes = fromHex('01020304');
reverse(bytes);
console.log(toHex(bytes)); // '04030201'
```

### reverseCopy

Creates a **new** reversed copy of a `Uint8Array`. The original array is not modified.

```typescript
function reverseCopy(bytes: Uint8Array): Uint8Array;
```

```typescript
import { reverseCopy, fromHex, toHex } from '@btc-vision/bitcoin';

const bytes = fromHex('01020304');
const reversed = reverseCopy(bytes);
console.log(toHex(reversed)); // '04030201'
console.log(toHex(bytes));    // '01020304' (original unchanged)
```

### alloc

Allocates a new `Uint8Array` of the specified size, optionally filled with a byte value.

```typescript
function alloc(size: number, fill?: number): Uint8Array;
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `size` | `number` | - | Number of bytes to allocate |
| `fill` | `number` | `0` | Byte value to fill with |

```typescript
import { alloc, toHex } from '@btc-vision/bitcoin';

const zeros = alloc(4);        // 4 zero bytes: 00000000
const ones = alloc(4, 0xff);   // 4 bytes of 0xff
console.log(toHex(ones));      // 'ffffffff'
```

### xor

XORs two `Uint8Array` instances together, returning a new array with the result.

```typescript
function xor(a: Uint8Array, b: Uint8Array): Uint8Array;
```

| Throws | Condition |
|--------|-----------|
| `TypeError` | Arrays have different lengths |

```typescript
import { xor, fromHex, toHex } from '@btc-vision/bitcoin';

const a = fromHex('ff00ff00');
const b = fromHex('0f0f0f0f');
const result = xor(a, b);
console.log(toHex(result)); // 'f00ff00f'
```

---

## UTF-8 Utilities

UTF-8 string encoding and decoding using the standard `TextEncoder`/`TextDecoder` APIs.

### fromUtf8

Creates a `Uint8Array` from a UTF-8 string.

```typescript
function fromUtf8(str: string): Uint8Array;
```

```typescript
import { fromUtf8, toHex } from '@btc-vision/bitcoin';

const bytes = fromUtf8('hello');
console.log(toHex(bytes)); // '68656c6c6f'
```

### toUtf8

Decodes a `Uint8Array` to a UTF-8 string.

```typescript
function toUtf8(bytes: Uint8Array): string;
```

```typescript
import { toUtf8, fromHex } from '@btc-vision/bitcoin';

const bytes = fromHex('68656c6c6f');
const str = toUtf8(bytes);
console.log(str); // 'hello'
```

---

## Variable-Length Integers (varuint)

Bitcoin CompactSize variable-length integer encoding, re-exported from `varuint-bitcoin`. Used throughout the Bitcoin protocol for encoding lengths and counts.

### Encoding Format

| First byte | Total size | Value range |
|------------|-----------|-------------|
| `0x00` - `0xFC` | 1 byte | 0 - 252 |
| `0xFD` | 3 bytes | 253 - 65535 (0xFD + 2-byte LE uint16) |
| `0xFE` | 5 bytes | 65536 - 4294967295 (0xFE + 4-byte LE uint32) |
| `0xFF` | 9 bytes | 4294967296+ (0xFF + 8-byte LE uint64) |

### varuint.encode

Encodes a number or bigint as a CompactSize variable-length integer into a buffer.

```typescript
function encode(
    n: number | bigint,
    buffer?: Uint8Array,
    offset?: number,
): { buffer: Uint8Array; bytes: number };
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `n` | `number \| bigint` | Value to encode |
| `buffer` | `Uint8Array` | Optional target buffer |
| `offset` | `number` | Optional offset within buffer |

Returns an object with the `buffer` containing the encoded data and `bytes` indicating how many bytes were written.

```typescript
import { varuint } from '@btc-vision/bitcoin';

// Encode a small value (1 byte)
const small = varuint.encode(100);
console.log(small.bytes); // 1

// Encode a larger value (3 bytes)
const medium = varuint.encode(515);
console.log(medium.bytes); // 3

// Encode into an existing buffer
const buf = new Uint8Array(9);
const result = varuint.encode(70000, buf, 0);
console.log(result.bytes); // 5
```

### varuint.decode

Decodes a CompactSize variable-length integer from a buffer.

```typescript
function decode(
    buffer: Uint8Array,
    offset?: number,
): { numberValue: number | null; bigintValue: bigint; bytes: number };
```

Returns an object with `bigintValue` (always present), `numberValue` (null if the value exceeds `Number.MAX_SAFE_INTEGER`), and `bytes` indicating how many bytes were consumed.

```typescript
import { varuint, fromHex } from '@btc-vision/bitcoin';

// Decode a single-byte varint
const small = varuint.decode(fromHex('64'));
console.log(small.numberValue); // 100
console.log(small.bytes);       // 1

// Decode a 3-byte varint
const medium = varuint.decode(fromHex('fd0302'));
console.log(medium.numberValue); // 515
console.log(medium.bytes);       // 3
```

### varuint.encodingLength

Returns the number of bytes required to encode a given value.

```typescript
function encodingLength(n: number | bigint): number;
```

```typescript
import { varuint } from '@btc-vision/bitcoin';

varuint.encodingLength(100);        // 1
varuint.encodingLength(252);        // 1
varuint.encodingLength(253);        // 3
varuint.encodingLength(65535);      // 3
varuint.encodingLength(65536);      // 5
varuint.encodingLength(4294967295); // 5
varuint.encodingLength(4294967296); // 9
```

---

## Class: BinaryReader

Stateful binary reader for parsing binary data. Creates exactly one `DataView` instance that is reused for all read operations, eliminating garbage collection pressure.

```typescript
class BinaryReader {
    constructor(data: Uint8Array, offset?: number);

    // Properties
    get offset(): number;
    set offset(value: number);
    get length(): number;
    get remaining(): number;
    get data(): Uint8Array;

    // Static factory
    static fromHex(hex: string): BinaryReader;

    // Integer reads (little-endian)
    readUInt8(): number;
    readInt8(): number;
    readUInt16LE(): number;
    readInt16LE(): number;
    readUInt32LE(): number;
    readInt32LE(): number;
    readUInt64LE(): bigint;
    readInt64LE(): bigint;

    // Byte reads
    readBytes(length: number): Uint8Array;      // returns subarray view (no copy)
    readBytesCopy(length: number): Uint8Array;   // returns independent copy

    // Bitcoin CompactSize reads
    readVarInt(): number;
    readVarIntBig(): bigint;
    readVarBytes(): Uint8Array;
    readVector(): Uint8Array[];

    // Navigation
    peek(): number | undefined;
    skip(length: number): void;
    reset(): void;
    hasMore(): boolean;
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `offset` | `number` | Current read position (get/set) |
| `length` | `number` | Total length of the underlying buffer |
| `remaining` | `number` | Number of bytes remaining to read |
| `data` | `Uint8Array` | The underlying data buffer |

### Read Methods

| Method | Return Type | Description |
|--------|-------------|-------------|
| `readUInt8()` | `number` | Reads an 8-bit unsigned integer (0-255) |
| `readInt8()` | `number` | Reads an 8-bit signed integer (-128 to 127) |
| `readUInt16LE()` | `number` | Reads a 16-bit unsigned integer, little-endian |
| `readInt16LE()` | `number` | Reads a 16-bit signed integer, little-endian |
| `readUInt32LE()` | `number` | Reads a 32-bit unsigned integer, little-endian |
| `readInt32LE()` | `number` | Reads a 32-bit signed integer, little-endian |
| `readUInt64LE()` | `bigint` | Reads a 64-bit unsigned integer, little-endian |
| `readInt64LE()` | `bigint` | Reads a 64-bit signed integer, little-endian |
| `readBytes(length)` | `Uint8Array` | Reads bytes as a subarray view (no copy) |
| `readBytesCopy(length)` | `Uint8Array` | Reads bytes as an independent copy |
| `readVarInt()` | `number` | Reads a Bitcoin CompactSize varint |
| `readVarIntBig()` | `bigint` | Reads a CompactSize varint as bigint |
| `readVarBytes()` | `Uint8Array` | Reads a length-prefixed byte array |
| `readVector()` | `Uint8Array[]` | Reads an array of length-prefixed byte arrays |

### Navigation Methods

| Method | Return Type | Description |
|--------|-------------|-------------|
| `peek()` | `number \| undefined` | Returns next byte without advancing position |
| `skip(length)` | `void` | Skips specified number of bytes |
| `reset()` | `void` | Resets read position to beginning |
| `hasMore()` | `boolean` | Returns true if there are remaining bytes |

### Example: Parsing a Bitcoin Transaction

```typescript
import { BinaryReader } from '@btc-vision/bitcoin/io';
import { fromHex } from '@btc-vision/bitcoin';

const rawTx = fromHex('01000000...');
const reader = new BinaryReader(rawTx);

// Read transaction version
const version = reader.readInt32LE();

// Read input count
const inputCount = reader.readVarInt();

for (let i = 0; i < inputCount; i++) {
    const txid = reader.readBytes(32);        // Previous tx hash
    const vout = reader.readUInt32LE();        // Previous output index
    const scriptSig = reader.readVarBytes();   // Script signature
    const sequence = reader.readUInt32LE();     // Sequence number
}

// Read output count
const outputCount = reader.readVarInt();

for (let i = 0; i < outputCount; i++) {
    const value = reader.readUInt64LE();           // Satoshi value
    const scriptPubKey = reader.readVarBytes();    // Output script
}

const locktime = reader.readUInt32LE();
```

### Example: Using fromHex Factory

```typescript
import { BinaryReader } from '@btc-vision/bitcoin/io';

const reader = BinaryReader.fromHex('01000000');
const version = reader.readInt32LE(); // 1
```

### readBytes vs readBytesCopy

`readBytes()` returns a subarray view into the underlying buffer for zero-copy performance. If the original data might be modified or if you need to store the result independently, use `readBytesCopy()` instead.

```typescript
const reader = new BinaryReader(data);

// Fast: returns a view (shares memory with original)
const view = reader.readBytes(32);

// Safe: returns an independent copy
const copy = reader.readBytesCopy(32);
```

---

## Class: BinaryWriter

Stateful binary writer for serializing binary data. Creates exactly one `DataView` instance that is reused for all write operations. All write methods return `this` for method chaining.

```typescript
class BinaryWriter {
    constructor(size: number);
    constructor(buffer: Uint8Array, offset?: number);

    // Properties
    get offset(): number;
    set offset(value: number);
    get capacity(): number;
    get remaining(): number;
    get data(): Uint8Array;

    // Static factory
    static growable(initialCapacity?: number): GrowableBinaryWriter;

    // Integer writes (little-endian)
    writeUInt8(value: number): this;
    writeInt8(value: number): this;
    writeUInt16LE(value: number): this;
    writeInt16LE(value: number): this;
    writeUInt32LE(value: number): this;
    writeInt32LE(value: number): this;
    writeUInt64LE(value: bigint): this;
    writeInt64LE(value: bigint): this;

    // Byte writes
    writeBytes(bytes: Uint8Array): this;

    // Bitcoin CompactSize writes
    writeVarInt(value: number): this;
    writeVarIntBig(value: bigint): this;
    writeVarBytes(bytes: Uint8Array): this;
    writeVector(vector: readonly Uint8Array[]): this;

    // Buffer operations
    fill(value: number, length: number): this;
    skip(length: number): this;
    reset(): this;

    // Finalization
    end(): Uint8Array;
    finish(): Uint8Array;
    toHex(): string;
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `offset` | `number` | Current write position (get/set) |
| `capacity` | `number` | Total capacity of the underlying buffer |
| `remaining` | `number` | Number of bytes remaining in the buffer |
| `data` | `Uint8Array` | The underlying data buffer |

### Write Methods

| Method | Parameter Type | Description |
|--------|---------------|-------------|
| `writeUInt8(value)` | `number` | Writes an 8-bit unsigned integer (0-255) |
| `writeInt8(value)` | `number` | Writes an 8-bit signed integer (-128 to 127) |
| `writeUInt16LE(value)` | `number` | Writes a 16-bit unsigned integer, little-endian |
| `writeInt16LE(value)` | `number` | Writes a 16-bit signed integer, little-endian |
| `writeUInt32LE(value)` | `number` | Writes a 32-bit unsigned integer, little-endian |
| `writeInt32LE(value)` | `number` | Writes a 32-bit signed integer, little-endian |
| `writeUInt64LE(value)` | `bigint` | Writes a 64-bit unsigned integer, little-endian |
| `writeInt64LE(value)` | `bigint` | Writes a 64-bit signed integer, little-endian |
| `writeBytes(bytes)` | `Uint8Array` | Writes raw bytes |
| `writeVarInt(value)` | `number` | Writes a Bitcoin CompactSize varint |
| `writeVarIntBig(value)` | `bigint` | Writes a CompactSize varint from bigint |
| `writeVarBytes(bytes)` | `Uint8Array` | Writes a length-prefixed byte array |
| `writeVector(vector)` | `readonly Uint8Array[]` | Writes an array of length-prefixed byte arrays |

### Finalization Methods

| Method | Return Type | Description |
|--------|-------------|-------------|
| `end()` | `Uint8Array` | Returns the buffer; **throws** `Error` if not fully written |
| `finish()` | `Uint8Array` | Returns the written portion (subarray if partially written) |
| `toHex()` | `string` | Returns the written portion as a hex string |

### end() vs finish()

- `end()` verifies the buffer was **fully** written (offset equals capacity). Throws a plain `Error` (not a typed error subclass) if any bytes remain unwritten. Use this when you know the exact output size.
- `finish()` returns whatever has been written so far, without verification. Returns a subarray view if the buffer was only partially filled.

### Example: Serializing with Fixed Size

```typescript
import { BinaryWriter } from '@btc-vision/bitcoin/io';

const writer = new BinaryWriter(16);
writer
    .writeInt32LE(1)        // version
    .writeUInt32LE(0)       // input count
    .writeUInt32LE(0)       // output count
    .writeUInt32LE(0);      // locktime

const bytes = writer.end(); // OK: wrote exactly 16 bytes
```

### Example: Method Chaining

```typescript
import { BinaryWriter } from '@btc-vision/bitcoin/io';
import { fromHex } from '@btc-vision/bitcoin';

const writer = new BinaryWriter(100);
writer
    .writeUInt8(0x01)
    .writeVarBytes(fromHex('deadbeef'))
    .writeUInt32LE(0xffffffff);

const result = writer.finish(); // Returns only the written portion
console.log(writer.toHex());
```

### Example: Writing into an Existing Buffer

```typescript
import { BinaryWriter } from '@btc-vision/bitcoin/io';

const buffer = new Uint8Array(1024);
const writer = new BinaryWriter(buffer, 10); // Start writing at offset 10
writer.writeUInt32LE(42);
```

---

## Class: GrowableBinaryWriter

A variant of `BinaryWriter` that automatically grows its internal buffer as needed. Use when the final serialized size is unknown.

> **Note:** `GrowableBinaryWriter` provides a subset of `BinaryWriter`'s write methods. The following `BinaryWriter` methods are **not available** on `GrowableBinaryWriter`:
> - `writeInt8()` -- use `writeUInt8(value & 0xff)` as a workaround
> - `writeInt16LE()`
> - `writeInt64LE()`
> - `writeVarIntBig()`
> - `fill()`
> - `skip()`
> - `reset()`
> - `end()`
>
> The `remaining` and `data` properties are also not available.

```typescript
class GrowableBinaryWriter {
    constructor(initialCapacity?: number);

    // Properties
    get offset(): number;
    set offset(value: number);
    get capacity(): number;

    // Write methods (subset of BinaryWriter)
    writeUInt8(value: number): this;
    writeUInt16LE(value: number): this;
    writeUInt32LE(value: number): this;
    writeInt32LE(value: number): this;
    writeUInt64LE(value: bigint): this;
    writeBytes(bytes: Uint8Array): this;
    writeVarInt(value: number): this;
    writeVarBytes(bytes: Uint8Array): this;
    writeVector(vector: readonly Uint8Array[]): this;

    // Finalization
    finish(): Uint8Array;
    toHex(): string;
}
```

The buffer starts at the given initial capacity (default 256 bytes) and doubles in size whenever more space is needed.

### Example: Dynamic Serialization

```typescript
import { BinaryWriter } from '@btc-vision/bitcoin/io';
import { fromHex } from '@btc-vision/bitcoin';

const writer = BinaryWriter.growable();

// Write variable amounts of data without worrying about buffer size
writer.writeUInt32LE(1);
writer.writeBytes(fromHex('aa'.repeat(500))); // Automatically grows
writer.writeVarInt(1000);

const result = writer.finish(); // Returns a copy of exactly the written bytes
```

---

## Common Patterns

### Round-Trip Encoding

```typescript
import { toHex, fromHex, toBase64, fromBase64 } from '@btc-vision/bitcoin';

const original = new Uint8Array([1, 2, 3, 4]);

// Hex round-trip
const hex = toHex(original);
const fromHexBytes = fromHex(hex);

// Base64 round-trip
const b64 = toBase64(original);
const fromB64Bytes = fromBase64(b64);
```

### Bitcoin Transaction ID (Reversed Hash Display)

```typescript
import { reverseCopy, toHex } from '@btc-vision/bitcoin';

// Bitcoin displays transaction hashes in reversed byte order
const txHashInternal = /* 32-byte hash from double-SHA256 */;
const txid = toHex(reverseCopy(txHashInternal));
```

### Building and Parsing a Length-Prefixed Message

```typescript
import { BinaryWriter, BinaryReader } from '@btc-vision/bitcoin/io';
import { fromHex } from '@btc-vision/bitcoin';

// Write
const writer = BinaryWriter.growable();
const payload = fromHex('deadbeefcafebabe');
writer.writeVarBytes(payload);
const serialized = writer.finish();

// Read
const reader = new BinaryReader(serialized);
const decoded = reader.readVarBytes();
// decoded contains deadbeefcafebabe
```

### Witness Vector Serialization

```typescript
import { BinaryWriter, BinaryReader } from '@btc-vision/bitcoin/io';
import { fromHex } from '@btc-vision/bitcoin';

// Write a witness stack
const witnessItems = [
    fromHex('3045022100...'),  // signature
    fromHex('0279be667e...'),  // public key
];

const writer = BinaryWriter.growable();
writer.writeVector(witnessItems);
const serialized = writer.finish();

// Read it back
const reader = new BinaryReader(serialized);
const decoded = reader.readVector();
// decoded[0] = signature, decoded[1] = public key
```

### Buffer Comparison for Sorting

```typescript
import { compare, fromHex } from '@btc-vision/bitcoin';

const hashes = [
    fromHex('ff00'),
    fromHex('0001'),
    fromHex('aa00'),
];

// Sort in lexicographic order
hashes.sort(compare);
// Result: [0001, aa00, ff00]
```
