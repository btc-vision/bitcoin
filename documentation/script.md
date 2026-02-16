# Script - Bitcoin Script Compilation, Decompilation, and Utilities

The `script` module provides tools for working with Bitcoin Script: compiling human-readable or structured representations into raw byte buffers, decompiling buffers back into structured chunks, converting to and from ASM notation, validating public keys and signatures within scripts, and encoding/decoding script numbers and script signatures. It also re-exports the full set of Bitcoin opcodes.

## Overview

| Concept | Description |
|---------|-------------|
| Chunks | An array of opcodes (`number`) and data pushes (`Uint8Array`) representing a script |
| Compiled script | A `Uint8Array` (branded as `Script`) containing the serialized byte-level encoding |
| ASM | A space-separated string of opcode names and hex-encoded data pushes |
| Stack | An array of `Uint8Array` elements extracted from push-only scripts |
| Script number | A variable-length little-endian signed integer encoding used by Bitcoin Script |
| Script signature | A DER-encoded ECDSA signature with an appended hash type byte |

### Import

```typescript
import * as script from '@btc-vision/bitcoin/script';
// or
import { script } from '@btc-vision/bitcoin';

// Destructured access
const { compile, decompile, toASM, fromASM, toStack, opcodes } = script;
const { encode, decode } = script.number;    // script number
const { encode, decode } = script.signature; // script signature
```

---

## compile()

Converts an array of chunks (opcodes and data buffers) into a single compiled `Script` buffer. If the input is already a `Uint8Array`, it is returned as-is.

```typescript
function compile(chunks: Uint8Array | Stack): Script;
```

### Behavior

1. Each numeric element is written as a single byte (the opcode value).
2. Each `Uint8Array` element is written using Bitcoin's push data encoding:
   - Data that can be represented as a minimal opcode (`OP_0`, `OP_1` through `OP_16`, `OP_1NEGATE`) is encoded as a single opcode byte per BIP 62.3 (minimal push policy).
   - Otherwise the appropriate `OP_PUSHDATA` prefix is used followed by the raw bytes.
3. Throws `TypeError` if the input is not an array.
4. Throws `Error` if the final buffer length does not match the computed size.

### Example

```typescript
import { script } from '@btc-vision/bitcoin';
const { compile, opcodes } = script;

// P2PKH scriptPubKey: OP_DUP OP_HASH160 <20-byte hash> OP_EQUALVERIFY OP_CHECKSIG
const pubKeyHash = new Uint8Array(20); // 20-byte public key hash
const compiled = compile([
    opcodes.OP_DUP,
    opcodes.OP_HASH160,
    pubKeyHash,
    opcodes.OP_EQUALVERIFY,
    opcodes.OP_CHECKSIG,
]);
// compiled is a Uint8Array of length 25

// Minimal push: a 1-byte buffer containing 0x05 compiles to OP_5 (a single byte)
const minimal = compile([new Uint8Array([5])]);
// minimal[0] === 0x55 (OP_5)
```

---

## decompile()

Converts a compiled `Uint8Array` buffer back into an array of chunks. If the input is already an array, it is returned as-is.

```typescript
function decompile(buffer: Uint8Array | Stack): Array<number | Uint8Array> | null;
```

**Throws** `TypeError` if the input is neither a `Uint8Array` nor an array. Returns `null` if the buffer is malformed (e.g., truncated push data).

### Behavior

1. Iterates through the buffer byte by byte.
2. Bytes in the range `0x01`..`0x4e` (`OP_PUSHDATA4`) are treated as push data instructions; the push data prefix is decoded and the corresponding number of bytes are read as a `Uint8Array` chunk.
3. Data that can be represented as a minimal opcode is converted to its numeric opcode form.
4. All other bytes are treated as opcode numbers.
5. Returns `null` if the buffer is malformed (e.g., truncated push data).

### Example

```typescript
import { script } from '@btc-vision/bitcoin';
const { decompile, opcodes } = script;

const raw = new Uint8Array([0x76, 0xa9, 0x14, ...new Array(20).fill(0), 0x88, 0xac]);
const chunks = decompile(raw);
// chunks = [118(OP_DUP), 169(OP_HASH160), Uint8Array(20), 136(OP_EQUALVERIFY), 172(OP_CHECKSIG)]

if (chunks !== null) {
    console.log(chunks[0] === opcodes.OP_DUP);         // true
    console.log(chunks[1] === opcodes.OP_HASH160);      // true
    console.log(chunks[2] instanceof Uint8Array);        // true (the 20-byte hash)
    console.log(chunks[3] === opcodes.OP_EQUALVERIFY);   // true
    console.log(chunks[4] === opcodes.OP_CHECKSIG);      // true
}
```

---

## toASM()

Converts chunks (or a compiled buffer) into a human-readable ASM string. Each chunk is separated by a space. Opcodes are rendered by name (e.g., `OP_DUP`), and data pushes are rendered as lowercase hex strings. Minimal data pushes are rendered as their opcode name.

```typescript
function toASM(chunks: Uint8Array | Stack): string;
```

**Throws** `Error` if the input `Uint8Array` cannot be decompiled (e.g., truncated push data).

### Example

```typescript
import { script } from '@btc-vision/bitcoin';

const asm = script.toASM(compiledScript);
// "OP_DUP OP_HASH160 0000000000000000000000000000000000000000 OP_EQUALVERIFY OP_CHECKSIG"
```

---

## fromASM()

Parses a human-readable ASM string back into a compiled `Script` buffer. Each token is either an opcode name (e.g., `OP_CHECKSIG`) or a hex-encoded data push.

```typescript
function fromASM(asm: string): Script;
```

**Throws** `TypeError` if the input is not a string or if any non-opcode token is not a valid hex string.

### Behavior

1. Splits the input string on spaces.
2. Tokens matching a known opcode name are converted to the corresponding numeric value.
3. All other tokens must be valid hex strings and are converted to `Uint8Array` data pushes.
4. The resulting array of chunks is passed through `compile()`.

### Example

```typescript
import { script } from '@btc-vision/bitcoin';

const compiled = script.fromASM('OP_DUP OP_HASH160 ab68025513c3dbd2f7b92a94e0581f5d50f654e7 OP_EQUALVERIFY OP_CHECKSIG');
// compiled is a Uint8Array containing the serialized script

// Round-trip
const asm = script.toASM(compiled);
// "OP_DUP OP_HASH160 ab68025513c3dbd2f7b92a94e0581f5d50f654e7 OP_EQUALVERIFY OP_CHECKSIG"
```

---

## toStack()

Converts a push-only script (compiled buffer or chunk array) into an array of `Uint8Array` stack elements. This is useful for extracting witness or scriptSig data elements.

```typescript
function toStack(chunks: Uint8Array | Stack): Uint8Array[];
```

### Behavior

1. Decompiles the input if it is a `Uint8Array`.
2. Validates that the script is push-only (throws `TypeError` otherwise).
3. Converts each chunk:
   - `Uint8Array` chunks are returned as-is.
   - `OP_0` is converted to an empty `Uint8Array`.
   - `OP_1` through `OP_16` are converted to their script number encoding (e.g., `OP_5` becomes a buffer encoding the number 5).
   - `OP_1NEGATE` is converted to the script number encoding of -1.

### Example

```typescript
import { script } from '@btc-vision/bitcoin';

// A push-only script with OP_0 and two data pushes
const chunks = [script.opcodes.OP_0, new Uint8Array([0xab, 0xcd]), new Uint8Array([0xef])];
const stack = script.toStack(chunks);
// stack[0] => Uint8Array(0) (empty buffer for OP_0)
// stack[1] => Uint8Array([0xab, 0xcd])
// stack[2] => Uint8Array([0xef])
```

---

## isPushOnly()

Returns `true` if every element in the chunk array is either a `Uint8Array` data push or a numeric push opcode (`OP_0`, `OP_1`..`OP_16`, `OP_1NEGATE`).

```typescript
function isPushOnly(value: Stack): boolean;
```

### Example

```typescript
import { script } from '@btc-vision/bitcoin';
const { opcodes } = script;

script.isPushOnly([opcodes.OP_0, new Uint8Array([1, 2, 3])]);  // true
script.isPushOnly([opcodes.OP_DUP, new Uint8Array([1, 2, 3])]); // false (OP_DUP is not a push)
```

---

## countNonPushOnlyOPs()

Returns the number of elements in the chunk array that are NOT push-only (i.e., opcodes other than `OP_0`, `OP_1`..`OP_16`, `OP_1NEGATE`, and data buffers).

```typescript
function countNonPushOnlyOPs(value: Stack): number;
```

### Example

```typescript
import { script } from '@btc-vision/bitcoin';
const { opcodes } = script;

const chunks = [opcodes.OP_DUP, opcodes.OP_HASH160, new Uint8Array(20), opcodes.OP_EQUALVERIFY, opcodes.OP_CHECKSIG];
script.countNonPushOnlyOPs(chunks); // 4 (OP_DUP, OP_HASH160, OP_EQUALVERIFY, OP_CHECKSIG)
```

---

## isCanonicalPubKey()

Returns `true` if the buffer is a valid SEC-encoded public key (compressed 33 bytes with `0x02`/`0x03` prefix, or uncompressed 65 bytes with `0x04`/`0x06`/`0x07` prefix). Validates that x and y coordinates are non-zero and less than the secp256k1 field prime.

```typescript
function isCanonicalPubKey(buffer: Uint8Array): boolean;
```

### Accepted formats

| Format | Length | Prefix byte |
|--------|--------|-------------|
| Compressed | 33 bytes | `0x02` or `0x03` |
| Uncompressed | 65 bytes | `0x04`, `0x06`, or `0x07` |

### Example

```typescript
import { script } from '@btc-vision/bitcoin';

const compressedKey = new Uint8Array(33);
compressedKey[0] = 0x02;
compressedKey[1] = 0x01; // non-zero x coordinate
script.isCanonicalPubKey(compressedKey); // true (if valid point)

script.isCanonicalPubKey(new Uint8Array(20)); // false (wrong length)
```

---

## isCanonicalScriptSignature()

Returns `true` if the buffer is a valid DER-encoded script signature: a BIP 66-compliant DER signature followed by a valid hash type byte. Valid hash types are `0x01`, `0x02`, `0x03`, `0x81`, `0x82`, `0x83` (SIGHASH_ALL, SIGHASH_NONE, SIGHASH_SINGLE, each optionally OR'd with `0x80` for SIGHASH_ANYONECANPAY).

```typescript
function isCanonicalScriptSignature(buffer: Uint8Array): boolean;
```

### Example

```typescript
import { script } from '@btc-vision/bitcoin';

// A properly DER-encoded signature with SIGHASH_ALL (0x01) appended
script.isCanonicalScriptSignature(derSignatureWithHashType); // true or false
```

---

## Script Number Module (`script.number`)

Encodes and decodes integers using Bitcoin Script's variable-length little-endian signed integer format. This encoding is used by arithmetic opcodes (`OP_ADD`, `OP_SUB`, etc.) and locktime checks.

### script.number.decode()

```typescript
function decode(buffer: Buffer, maxLength?: number, minimal?: boolean): number;
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `buffer` | -- | The buffer containing the encoded script number |
| `maxLength` | `4` | Maximum allowed byte length (set to 5 for lock times) |
| `minimal` | `true` | If `true`, rejects non-minimally-encoded numbers |

**Encoding rules:**
- An empty buffer decodes to `0`.
- The number is stored in little-endian byte order.
- The most significant bit of the last byte is the sign bit.
- If the value's MSB would collide with the sign bit, an extra byte is added.
- Supports up to 5 bytes (40-bit numbers) for locktime values.

### script.number.encode()

```typescript
function encode(number: number): Buffer;
```

Encodes a JavaScript number into a minimally-encoded script number buffer.

### Example

```typescript
import { script } from '@btc-vision/bitcoin';

// Encode
const buf = script.number.encode(1000);
// buf => Buffer [0xe8, 0x03]

const negBuf = script.number.encode(-1000);
// negBuf => Buffer [0xe8, 0x83]

// Decode
script.number.decode(Buffer.from([0xe8, 0x03])); // 1000
script.number.decode(Buffer.from([0xe8, 0x83])); // -1000
script.number.decode(Buffer.from([]));            // 0

// 5-byte locktime value
script.number.decode(Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00]), 5); // 1
```

---

## Script Signature Module (`script.signature`)

Encodes and decodes ECDSA signatures used in Bitcoin Script. A script signature consists of a DER-encoded signature (BIP 66) followed by a one-byte hash type flag (BIP 62).

### ScriptSignature Interface

```typescript
interface ScriptSignature {
    signature: Uint8Array; // 64 bytes: 32-byte R + 32-byte S (raw, not DER)
    hashType: number;      // one of 0x01, 0x02, 0x03, 0x81, 0x82, 0x83
}
```

### script.signature.decode()

```typescript
function decode(buffer: Uint8Array): ScriptSignature;
```

Decodes a DER-encoded script signature (with trailing hash type byte) into a `ScriptSignature` object. The `signature` field in the result is the raw 64-byte `R || S` value (each component zero-padded to 32 bytes).

### script.signature.encode()

```typescript
function encode(signature: Uint8Array, hashType: number): Uint8Array;
```

Encodes a raw 64-byte signature and a hash type into a DER-encoded script signature buffer. The `signature` parameter must be exactly 64 bytes. The `hashType` must be a valid BIP 62 hash type.

### Hash Type Values

| Constant | Value | Description |
|----------|-------|-------------|
| SIGHASH_ALL | `0x01` | Sign all inputs and outputs |
| SIGHASH_NONE | `0x02` | Sign all inputs, no outputs |
| SIGHASH_SINGLE | `0x03` | Sign all inputs, only the output at the same index |
| SIGHASH_ALL \| ANYONECANPAY | `0x81` | Sign only own input, all outputs |
| SIGHASH_NONE \| ANYONECANPAY | `0x82` | Sign only own input, no outputs |
| SIGHASH_SINGLE \| ANYONECANPAY | `0x83` | Sign only own input, matching output |

### Example

```typescript
import { script } from '@btc-vision/bitcoin';

// Decode a DER-encoded script signature
const decoded = script.signature.decode(derEncodedSigWithHashType);
console.log(decoded.signature.length); // 64 (raw R || S)
console.log(decoded.hashType);         // e.g. 0x01

// Encode a raw signature with hash type
const raw64 = new Uint8Array(64); // 32-byte R + 32-byte S
const encoded = script.signature.encode(raw64, 0x01);
// encoded is DER-encoded with 0x01 hash type appended
```

---

## Push Data Encoding

The push data module handles the variable-length encoding used to push data onto the Bitcoin Script stack. This is used internally by `compile()` and `decompile()`.

| Data length | Encoding | Total prefix size |
|-------------|----------|-------------------|
| 0 - 75 bytes | Single byte (length = opcode) | 1 byte |
| 76 - 255 bytes | `OP_PUSHDATA1` + 1-byte length | 2 bytes |
| 256 - 65535 bytes | `OP_PUSHDATA2` + 2-byte LE length | 3 bytes |
| 65536+ bytes | `OP_PUSHDATA4` + 4-byte LE length | 5 bytes |

---

## Complete Opcodes Reference

All opcodes are available via `script.opcodes` (or imported directly from `@btc-vision/bitcoin`).

```typescript
import { script } from '@btc-vision/bitcoin';

const { opcodes } = script;
opcodes.OP_CHECKSIG; // 172

// Reverse lookup: build a name-by-value map from the opcodes object
const reverseOps: Record<number, string> = {};
for (const [name, value] of Object.entries(opcodes)) {
    reverseOps[value as number] = name;
}
reverseOps[172]; // "OP_CHECKSIG"
```

> **Note:** `getReverseOps()` is defined in `src/opcodes.ts` but is NOT re-exported from the main `@btc-vision/bitcoin` entry point. Use the manual reverse-mapping approach above, or import from the opcodes module directly.

### Constants and Push Numbers

| Opcode | Decimal | Hex | Description |
|--------|---------|-----|-------------|
| `OP_FALSE` / `OP_0` | 0 | `0x00` | Push empty byte array (false) |
| `OP_PUSHDATA1` | 76 | `0x4c` | Next 1 byte is data length |
| `OP_PUSHDATA2` | 77 | `0x4d` | Next 2 bytes (LE) are data length |
| `OP_PUSHDATA4` | 78 | `0x4e` | Next 4 bytes (LE) are data length |
| `OP_1NEGATE` | 79 | `0x4f` | Push -1 |
| `OP_RESERVED` | 80 | `0x50` | Reserved (causes script failure if executed) |
| `OP_TRUE` / `OP_1` | 81 | `0x51` | Push 1 |
| `OP_2` | 82 | `0x52` | Push 2 |
| `OP_3` | 83 | `0x53` | Push 3 |
| `OP_4` | 84 | `0x54` | Push 4 |
| `OP_5` | 85 | `0x55` | Push 5 |
| `OP_6` | 86 | `0x56` | Push 6 |
| `OP_7` | 87 | `0x57` | Push 7 |
| `OP_8` | 88 | `0x58` | Push 8 |
| `OP_9` | 89 | `0x59` | Push 9 |
| `OP_10` | 90 | `0x5a` | Push 10 |
| `OP_11` | 91 | `0x5b` | Push 11 |
| `OP_12` | 92 | `0x5c` | Push 12 |
| `OP_13` | 93 | `0x5d` | Push 13 |
| `OP_14` | 94 | `0x5e` | Push 14 |
| `OP_15` | 95 | `0x5f` | Push 15 |
| `OP_16` | 96 | `0x60` | Push 16 |

### Flow Control

| Opcode | Decimal | Hex | Description |
|--------|---------|-----|-------------|
| `OP_NOP` | 97 | `0x61` | No operation |
| `OP_VER` | 98 | `0x62` | Reserved (push protocol version, disabled) |
| `OP_IF` | 99 | `0x63` | Execute if top stack value is true |
| `OP_NOTIF` | 100 | `0x64` | Execute if top stack value is false |
| `OP_VERIF` | 101 | `0x65` | Reserved (always fails) |
| `OP_VERNOTIF` | 102 | `0x66` | Reserved (always fails) |
| `OP_ELSE` | 103 | `0x67` | Else branch of OP_IF/OP_NOTIF |
| `OP_ENDIF` | 104 | `0x68` | End of OP_IF/OP_NOTIF block |
| `OP_VERIFY` | 105 | `0x69` | Fail if top stack value is false |
| `OP_RETURN` | 106 | `0x6a` | Mark output as provably unspendable |

### Stack Operations

| Opcode | Decimal | Hex | Description |
|--------|---------|-----|-------------|
| `OP_TOALTSTACK` | 107 | `0x6b` | Move top item to alt stack |
| `OP_FROMALTSTACK` | 108 | `0x6c` | Move top item from alt stack |
| `OP_2DROP` | 109 | `0x6d` | Remove top two items |
| `OP_2DUP` | 110 | `0x6e` | Duplicate top two items |
| `OP_3DUP` | 111 | `0x6f` | Duplicate top three items |
| `OP_2OVER` | 112 | `0x70` | Copy 3rd and 4th items to top |
| `OP_2ROT` | 113 | `0x71` | Move 5th and 6th items to top |
| `OP_2SWAP` | 114 | `0x72` | Swap top two pairs |
| `OP_IFDUP` | 115 | `0x73` | Duplicate top if non-zero |
| `OP_DEPTH` | 116 | `0x74` | Push stack depth |
| `OP_DROP` | 117 | `0x75` | Remove top item |
| `OP_DUP` | 118 | `0x76` | Duplicate top item |
| `OP_NIP` | 119 | `0x77` | Remove second-to-top item |
| `OP_OVER` | 120 | `0x78` | Copy second-to-top item to top |
| `OP_PICK` | 121 | `0x79` | Copy nth item to top |
| `OP_ROLL` | 122 | `0x7a` | Move nth item to top |
| `OP_ROT` | 123 | `0x7b` | Rotate top three items |
| `OP_SWAP` | 124 | `0x7c` | Swap top two items |
| `OP_TUCK` | 125 | `0x7d` | Copy top item below second |

### Splice Operations (Disabled)

| Opcode | Decimal | Hex | Description |
|--------|---------|-----|-------------|
| `OP_CAT` | 126 | `0x7e` | Concatenate (disabled) |
| `OP_SUBSTR` | 127 | `0x7f` | Substring (disabled) |
| `OP_LEFT` | 128 | `0x80` | Left substring (disabled) |
| `OP_RIGHT` | 129 | `0x81` | Right substring (disabled) |
| `OP_SIZE` | 130 | `0x82` | Push string length |

### Bitwise Logic

| Opcode | Decimal | Hex | Description |
|--------|---------|-----|-------------|
| `OP_INVERT` | 131 | `0x83` | Bitwise NOT (disabled) |
| `OP_AND` | 132 | `0x84` | Bitwise AND (disabled) |
| `OP_OR` | 133 | `0x85` | Bitwise OR (disabled) |
| `OP_XOR` | 134 | `0x86` | Bitwise XOR (disabled) |
| `OP_EQUAL` | 135 | `0x87` | Push 1 if top two are byte-for-byte equal |
| `OP_EQUALVERIFY` | 136 | `0x88` | OP_EQUAL then OP_VERIFY |
| `OP_RESERVED1` | 137 | `0x89` | Reserved (fails if executed) |
| `OP_RESERVED2` | 138 | `0x8a` | Reserved (fails if executed) |

### Arithmetic

| Opcode | Decimal | Hex | Description |
|--------|---------|-----|-------------|
| `OP_1ADD` | 139 | `0x8b` | Add 1 |
| `OP_1SUB` | 140 | `0x8c` | Subtract 1 |
| `OP_2MUL` | 141 | `0x8d` | Multiply by 2 (disabled) |
| `OP_2DIV` | 142 | `0x8e` | Divide by 2 (disabled) |
| `OP_NEGATE` | 143 | `0x8f` | Negate sign |
| `OP_ABS` | 144 | `0x90` | Absolute value |
| `OP_NOT` | 145 | `0x91` | Logical NOT (0 becomes 1, else 0) |
| `OP_0NOTEQUAL` | 146 | `0x92` | Push 0 if input is 0, else 1 |
| `OP_ADD` | 147 | `0x93` | Add top two items |
| `OP_SUB` | 148 | `0x94` | Subtract top from second |
| `OP_MUL` | 149 | `0x95` | Multiply (disabled) |
| `OP_DIV` | 150 | `0x96` | Divide (disabled) |
| `OP_MOD` | 151 | `0x97` | Modulo (disabled) |
| `OP_LSHIFT` | 152 | `0x98` | Left shift (disabled) |
| `OP_RSHIFT` | 153 | `0x99` | Right shift (disabled) |
| `OP_BOOLAND` | 154 | `0x9a` | Boolean AND |
| `OP_BOOLOR` | 155 | `0x9b` | Boolean OR |
| `OP_NUMEQUAL` | 156 | `0x9c` | Push 1 if numbers are equal |
| `OP_NUMEQUALVERIFY` | 157 | `0x9d` | OP_NUMEQUAL then OP_VERIFY |
| `OP_NUMNOTEQUAL` | 158 | `0x9e` | Push 1 if numbers are not equal |
| `OP_LESSTHAN` | 159 | `0x9f` | Push 1 if a < b |
| `OP_GREATERTHAN` | 160 | `0xa0` | Push 1 if a > b |
| `OP_LESSTHANOREQUAL` | 161 | `0xa1` | Push 1 if a <= b |
| `OP_GREATERTHANOREQUAL` | 162 | `0xa2` | Push 1 if a >= b |
| `OP_MIN` | 163 | `0xa3` | Push the smaller of two values |
| `OP_MAX` | 164 | `0xa4` | Push the larger of two values |
| `OP_WITHIN` | 165 | `0xa5` | Push 1 if x is within [min, max) |

### Cryptographic Operations

| Opcode | Decimal | Hex | Description |
|--------|---------|-----|-------------|
| `OP_RIPEMD160` | 166 | `0xa6` | RIPEMD-160 hash |
| `OP_SHA1` | 167 | `0xa7` | SHA-1 hash |
| `OP_SHA256` | 168 | `0xa8` | SHA-256 hash |
| `OP_HASH160` | 169 | `0xa9` | SHA-256 then RIPEMD-160 |
| `OP_HASH256` | 170 | `0xaa` | Double SHA-256 |
| `OP_CODESEPARATOR` | 171 | `0xab` | Mark beginning of signature-checked script |
| `OP_CHECKSIG` | 172 | `0xac` | Verify signature against public key |
| `OP_CHECKSIGVERIFY` | 173 | `0xad` | OP_CHECKSIG then OP_VERIFY |
| `OP_CHECKMULTISIG` | 174 | `0xae` | Verify m-of-n multisig |
| `OP_CHECKMULTISIGVERIFY` | 175 | `0xaf` | OP_CHECKMULTISIG then OP_VERIFY |

### Locktime and Expansion

| Opcode | Decimal | Hex | Description |
|--------|---------|-----|-------------|
| `OP_NOP1` | 176 | `0xb0` | No operation (reserved for expansion) |
| `OP_NOP2` / `OP_CHECKLOCKTIMEVERIFY` | 177 | `0xb1` | Verify locktime (BIP 65) |
| `OP_NOP3` / `OP_CHECKSEQUENCEVERIFY` | 178 | `0xb2` | Verify sequence number (BIP 112) |
| `OP_NOP4` | 179 | `0xb3` | No operation (reserved) |
| `OP_NOP5` | 180 | `0xb4` | No operation (reserved) |
| `OP_NOP6` | 181 | `0xb5` | No operation (reserved) |
| `OP_NOP7` | 182 | `0xb6` | No operation (reserved) |
| `OP_NOP8` | 183 | `0xb7` | No operation (reserved) |
| `OP_NOP9` | 184 | `0xb8` | No operation (reserved) |
| `OP_NOP10` | 185 | `0xb9` | No operation (reserved) |

### Tapscript

| Opcode | Decimal | Hex | Description |
|--------|---------|-----|-------------|
| `OP_CHECKSIGADD` | 186 | `0xba` | Tapscript: verify signature and increment counter (BIP 342) |

### Template Matching (Internal)

| Opcode | Decimal | Hex | Description |
|--------|---------|-----|-------------|
| `OP_PUBKEYHASH` | 253 | `0xfd` | Template placeholder for pubkey hash |
| `OP_PUBKEY` | 254 | `0xfe` | Template placeholder for pubkey |
| `OP_INVALIDOPCODE` | 255 | `0xff` | Invalid opcode marker |

---

## Code Examples

### Building a P2PKH Script

```typescript
import { script } from '@btc-vision/bitcoin';
const { compile, opcodes } = script;

// scriptPubKey: OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
function buildP2PKH(pubKeyHash: Uint8Array): Uint8Array {
    if (pubKeyHash.length !== 20) throw new Error('Expected 20-byte hash');
    return compile([
        opcodes.OP_DUP,
        opcodes.OP_HASH160,
        pubKeyHash,
        opcodes.OP_EQUALVERIFY,
        opcodes.OP_CHECKSIG,
    ]);
}
```

### Building an OP_RETURN Data Script

```typescript
import { script } from '@btc-vision/bitcoin';
const { compile, opcodes } = script;

function buildOpReturn(data: Uint8Array): Uint8Array {
    return compile([opcodes.OP_RETURN, data]);
}
```

### Building a CLTV Timelocked Script

```typescript
import { script } from '@btc-vision/bitcoin';
const { compile, opcodes, number: scriptNum } = script;

function buildTimelocked(locktime: number, pubKeyHash: Uint8Array): Uint8Array {
    return compile([
        scriptNum.encode(locktime),
        opcodes.OP_CHECKLOCKTIMEVERIFY,
        opcodes.OP_DROP,
        opcodes.OP_DUP,
        opcodes.OP_HASH160,
        pubKeyHash,
        opcodes.OP_EQUALVERIFY,
        opcodes.OP_CHECKSIG,
    ]);
}
```

### Parsing and Inspecting a Script

```typescript
import { script } from '@btc-vision/bitcoin';
const { decompile, toASM, isPushOnly, countNonPushOnlyOPs, opcodes } = script;

function inspectScript(raw: Uint8Array): void {
    // Human-readable form
    console.log('ASM:', toASM(raw));

    // Structured form
    const chunks = decompile(raw);
    if (!chunks) {
        console.log('Invalid script');
        return;
    }

    console.log('Chunk count:', chunks.length);
    console.log('Push-only:', isPushOnly(chunks));
    console.log('Non-push opcodes:', countNonPushOnlyOPs(chunks));

    // Check for specific patterns
    if (chunks[0] === opcodes.OP_DUP && chunks[1] === opcodes.OP_HASH160) {
        console.log('Looks like a P2PKH script');
    }
    if (chunks[0] === opcodes.OP_RETURN) {
        console.log('This is an OP_RETURN output');
    }
}
```

### Round-trip: ASM to Buffer and Back

```typescript
import { script } from '@btc-vision/bitcoin';

const original = 'OP_2 0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798 OP_2 OP_CHECKMULTISIG';

const compiled = script.fromASM(original);
const restored = script.toASM(compiled);
console.log(original === restored); // true
```

### Validating a Script Signature

```typescript
import { script } from '@btc-vision/bitcoin';

function validateScriptSig(sigBuffer: Uint8Array): boolean {
    if (!script.isCanonicalScriptSignature(sigBuffer)) {
        console.log('Invalid DER signature or hash type');
        return false;
    }

    const { signature, hashType } = script.signature.decode(sigBuffer);
    console.log('Raw signature (64 bytes):', signature);
    console.log('Hash type:', hashType);
    return true;
}
```

### Working with Script Numbers

```typescript
import { script } from '@btc-vision/bitcoin';

// Encode various values
script.number.encode(0);     // Buffer(0) - empty buffer
script.number.encode(1);     // Buffer [0x01]
script.number.encode(127);   // Buffer [0x7f]
script.number.encode(128);   // Buffer [0x80, 0x00]  (extra byte to avoid sign-bit collision)
script.number.encode(-1);    // Buffer [0x81]
script.number.encode(-128);  // Buffer [0x80, 0x80]

// Decode with strict minimal encoding (default)
script.number.decode(Buffer.from([0x7f]));       // 127
script.number.decode(Buffer.from([0x80, 0x00])); // 128

// Decode with relaxed minimal check
script.number.decode(Buffer.from([0x00]), 4, false); // 0 (would throw with minimal=true)
```
