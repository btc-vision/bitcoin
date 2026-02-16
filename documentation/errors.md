# Errors

## Overview

The library defines and exports a hierarchy of custom error classes rooted at `BitcoinError`. However, the library itself does **not** throw these custom classes internally. All errors thrown by the library are standard built-in types: `Error`, `TypeError`, and `RangeError`.

The custom error classes are exported as a convenience for **consumers** of the library. You can use them in your own application code to throw domain-specific, categorized errors that integrate with the `BitcoinError` hierarchy.

### What the Library Actually Throws

| Error Type | Typical Situations |
|---|---|
| `Error` | General failures: malformed data, missing prerequisites, invalid state |
| `TypeError` | Wrong argument types, invalid lengths, format mismatches, payment validation failures |
| `RangeError` | Numeric values out of bounds (e.g. negative satoshi, exceeding max supply, exceeding curve order) |

### Custom Error Classes (for Consumer Use)

| Error class | Intended Domain |
|-------------|-----------------|
| `BitcoinError` | Base class for all custom Bitcoin errors |
| `ValidationError` | Data validation failures (key lengths, value ranges, format checks) |
| `InvalidInputError` | Invalid transaction inputs |
| `InvalidOutputError` | Invalid transaction outputs |
| `ScriptError` | Script compilation or decompilation failures |
| `PsbtError` | PSBT construction, signing, or finalization failures |
| `EccError` | ECC library not initialized or cryptographic operation failures |
| `AddressError` | Address encoding or decoding failures |
| `SignatureError` | Signature creation or validation failures |

### Inheritance Hierarchy

```
Error (built-in)
  └── BitcoinError
        ├── ValidationError
        ├── InvalidInputError
        ├── InvalidOutputError
        ├── ScriptError
        ├── PsbtError
        ├── EccError
        ├── AddressError
        └── SignatureError
```

---

## Imports

All error classes are exported individually and also grouped under the `errors` namespace object.

```typescript
// Individual named imports
import {
    BitcoinError,
    ValidationError,
    InvalidInputError,
    InvalidOutputError,
    ScriptError,
    PsbtError,
    EccError,
    AddressError,
    SignatureError,
} from '@btc-vision/bitcoin';

// Namespace import (all error classes in one object)
import { errors } from '@btc-vision/bitcoin';
```

---

## Errors Thrown by the Library

The library throws standard `Error`, `TypeError`, and `RangeError` instances with descriptive messages. The sections below list common message patterns organized by area. These are not exhaustive but cover the most frequently encountered errors.

### Address Errors

Thrown as `TypeError` or `Error` from address encoding/decoding operations.

```
TypeError: Invalid program length for segwit address
TypeError: Empty output
TypeError: Invalid version for segwit address
TypeError: Unsupported push opcode in script
TypeError: Invalid segwit version <version>
TypeError: <address> is too short
TypeError: <address> is too long
TypeError: <address> has no matching Script
Error: <address> has an invalid prefix
Error: <script> has no matching Address
```

### Transaction Errors

Thrown as `TypeError` or `Error` from transaction construction and hashing.

```
TypeError: Expected 32-byte hash
TypeError: Expected unsigned 32-bit integer for index
TypeError: Expected unsigned 32-bit integer for sequence
TypeError: Expected Uint8Array for scriptPubKey
TypeError: Expected bigint satoshi value (0 to 2^63-1)
TypeError: Expected non-negative integer for inIndex
TypeError: Expected Uint8Array for prevOutScript
TypeError: Expected integer for hashType
Error: Could not decompile prevOutScript
Error: Transaction has superfluous witness data
Error: Transaction has unexpected data
Error: Must supply prevout script and value for all inputs
Error: Add outputs to the transaction before signing.
```

### PSBT Errors

Thrown as `Error` from PSBT construction, signing, and finalization.

```
Error: Input index too high
Error: Not finalized
Error: Need Signer to sign input
Error: Need HDSigner to sign input
Error: Need Schnorr Signer to sign taproot input #<index>.
Error: No inputs were signed
Error: Can not sign for input #<index> with the key <pubkey>
Error: No script found for input #<index>
Error: Cannot finalize input #<index>. Not Taproot.
Error: Cannot finalize input #<index>. Missing witness utxo.
Error: Cannot finalize taproot key spend
Error: No signatures to validate
Error: Need validator function to validate signatures
Error: No signatures for this pubkey
```

### Script Errors

Thrown as `TypeError` or `Error` from script compilation and decompilation.

```
TypeError: Expected an array
TypeError: Expected a Uint8Array
TypeError: Expected a string
TypeError: Expected hex string
TypeError: Expected push-only script
Error: Could not decode chunks
Error: Could not convert invalid chunks to ASM
```

### Type Validation Errors

Thrown as `TypeError` or `RangeError` from the type-checking utilities.

```
TypeError: Expected 32-byte Uint8Array, got <n> bytes
TypeError: Expected 20-byte Uint8Array, got <n> bytes
TypeError: <name> must be Uint8Array, got <type>
TypeError: <name> must be 32 bytes, got <n>
RangeError: <name> cannot be zero
RangeError: <name> exceeds curve order
RangeError: Satoshi cannot be negative, got <value>
RangeError: Satoshi exceeds maximum supply (<max>), got <value>
```

### Payment Validation Errors

Thrown as `TypeError` from payment type constructors (p2pkh, p2wpkh, p2wsh, p2tr, p2ms, p2mr, p2op, embed).

```
TypeError: Invalid address
TypeError: Invalid prefix or Network mismatch
TypeError: Invalid address version
TypeError: Invalid address data
TypeError: Hash mismatch
TypeError: Output is invalid
TypeError: Pubkey mismatch
TypeError: Signature mismatch
TypeError: Input is invalid
TypeError: Input has invalid signature
TypeError: Witness is invalid
TypeError: Not enough data
TypeError: Redeem.output is invalid
TypeError: Non push-only scriptSig
```

### ECC Errors

Thrown as `Error` when the ECC library context is missing or misconfigured.

```
Error: ECC Library is required (from initEccLib or context)
```

### Script Number Errors

```
TypeError: Script number overflow
Error: Non-minimally encoded script number
```

### Signature Encoding Errors

```
Error: Invalid hashType <hashType>
TypeError: Expected signature to be a 64-byte Uint8Array
TypeError: Expected hashType to be a UInt8
```

### Bech32 Errors

```
TypeError: <address> uses wrong encoding
```

---

## Custom Error Class Reference

The following classes are defined in `src/errors.ts` and exported for use in consumer code. The library itself does not throw them.

### BitcoinError

Base class for all custom Bitcoin errors. All other custom error classes extend this one, so catching `BitcoinError` will catch every custom subtype.

| Property | Value |
|----------|-------|
| `name` | `'BitcoinError'` |
| Extends | `Error` |

#### Constructor

```typescript
new BitcoinError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Human-readable description of the error |

The constructor calls `Error.captureStackTrace` (when available on V8 engines) to maintain a clean stack trace pointing to the call site rather than the error constructor itself.

---

### ValidationError

Intended for data validation failures such as incorrect key lengths, values outside allowed ranges, or malformed data formats.

| Property | Value |
|----------|-------|
| `name` | `'ValidationError'` |
| Extends | `BitcoinError` |

#### Constructor

```typescript
new ValidationError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the validation failure |

#### Recommended Use

```typescript
import { ValidationError } from '@btc-vision/bitcoin';

function validatePublicKey(key: Uint8Array): void {
    if (key.length !== 33 && key.length !== 65) {
        throw new ValidationError(`Invalid public key length: ${key.length}`);
    }
}
```

---

### InvalidInputError

Intended for signaling that a transaction input is malformed or references invalid data.

| Property | Value |
|----------|-------|
| `name` | `'InvalidInputError'` |
| Extends | `BitcoinError` |

#### Constructor

```typescript
new InvalidInputError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the invalid input |

#### Recommended Use

```typescript
import { InvalidInputError } from '@btc-vision/bitcoin';

function checkInput(index: number, totalInputs: number): void {
    if (index >= totalInputs) {
        throw new InvalidInputError(`Input index ${index} is out of range (max ${totalInputs - 1})`);
    }
}
```

---

### InvalidOutputError

Intended for signaling that a transaction output is malformed or contains invalid values.

| Property | Value |
|----------|-------|
| `name` | `'InvalidOutputError'` |
| Extends | `BitcoinError` |

#### Constructor

```typescript
new InvalidOutputError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the invalid output |

#### Recommended Use

```typescript
import { InvalidOutputError } from '@btc-vision/bitcoin';

function checkOutputValue(value: bigint): void {
    if (value < 0n) {
        throw new InvalidOutputError('Output value cannot be negative');
    }
}
```

---

### ScriptError

Intended for signaling script compilation or decompilation failures.

| Property | Value |
|----------|-------|
| `name` | `'ScriptError'` |
| Extends | `BitcoinError` |

#### Constructor

```typescript
new ScriptError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the script failure |

#### Recommended Use

```typescript
import { ScriptError } from '@btc-vision/bitcoin';

function processScript(raw: Uint8Array): void {
    if (raw.length === 0) {
        throw new ScriptError('Cannot process empty script');
    }
}
```

---

### PsbtError

Intended for signaling PSBT construction, signing, or finalization failures.

| Property | Value |
|----------|-------|
| `name` | `'PsbtError'` |
| Extends | `BitcoinError` |

#### Constructor

```typescript
new PsbtError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the PSBT failure |

#### Recommended Use

```typescript
import { PsbtError } from '@btc-vision/bitcoin';

function requireSigned(inputIndex: number, isSigned: boolean): void {
    if (!isSigned) {
        throw new PsbtError(`Cannot finalize unsigned input #${inputIndex}`);
    }
}
```

---

### EccError

Intended for signaling ECC initialization or cryptographic operation failures.

| Property | Value |
|----------|-------|
| `name` | `'EccError'` |
| Extends | `BitcoinError` |

#### Constructor

```typescript
new EccError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the ECC failure |

#### Recommended Use

```typescript
import { EccError } from '@btc-vision/bitcoin';

function ensureEccReady(eccLib: unknown): void {
    if (!eccLib) {
        throw new EccError('ECC library must be initialized before use');
    }
}
```

---

### AddressError

Intended for signaling address encoding or decoding failures.

| Property | Value |
|----------|-------|
| `name` | `'AddressError'` |
| Extends | `BitcoinError` |

#### Constructor

```typescript
new AddressError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the address failure |

#### Recommended Use

```typescript
import { AddressError } from '@btc-vision/bitcoin';

function validateAddress(addr: string): void {
    if (!addr || addr.length < 14) {
        throw new AddressError(`Address is too short: ${addr}`);
    }
}
```

---

### SignatureError

Intended for signaling signature creation or validation failures.

| Property | Value |
|----------|-------|
| `name` | `'SignatureError'` |
| Extends | `BitcoinError` |

#### Constructor

```typescript
new SignatureError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the signature failure |

#### Recommended Use

```typescript
import { SignatureError } from '@btc-vision/bitcoin';

function checkSignature(sig: Uint8Array): void {
    if (sig.length !== 64 && sig.length !== 65) {
        throw new SignatureError(`Unexpected signature length: ${sig.length}`);
    }
}
```

---

## The `errors` Namespace

All error classes are also available as a single namespace object for convenience.

```typescript
import { errors } from '@btc-vision/bitcoin';

// Access any error class through the namespace
const err = new errors.ValidationError('bad key');
console.log(err instanceof errors.BitcoinError); // true
```

The namespace contains the following properties:

| Property | Class |
|----------|-------|
| `errors.BitcoinError` | `BitcoinError` |
| `errors.ValidationError` | `ValidationError` |
| `errors.InvalidInputError` | `InvalidInputError` |
| `errors.InvalidOutputError` | `InvalidOutputError` |
| `errors.ScriptError` | `ScriptError` |
| `errors.PsbtError` | `PsbtError` |
| `errors.EccError` | `EccError` |
| `errors.AddressError` | `AddressError` |
| `errors.SignatureError` | `SignatureError` |

---

## Error Handling Patterns

### Catching Library Errors

Since the library throws standard `Error`, `TypeError`, and `RangeError`, catch those types directly.

```typescript
try {
    // ... any library operation
} catch (error) {
    if (error instanceof TypeError) {
        console.error('Type/validation error:', (error as Error).message);
    } else if (error instanceof RangeError) {
        console.error('Value out of range:', (error as Error).message);
    } else if (error instanceof Error) {
        console.error('Error:', error.message);
    } else {
        throw error;
    }
}
```

### Catching by Error Message

When you need to distinguish between different failure modes from the library, check the error message.

```typescript
try {
    // ... address decoding
} catch (error) {
    if (error instanceof Error) {
        if (error.message.includes('has no matching Script')) {
            console.error('Unrecognized address format');
        } else if (error.message.includes('too short') || error.message.includes('too long')) {
            console.error('Address has wrong length');
        } else {
            console.error('Address error:', error.message);
        }
    }
}
```

### Wrapping Library Errors with Custom Classes

A common pattern is to catch the standard errors thrown by the library and wrap them in the exported custom error classes. This gives your application typed, categorized errors while preserving the original cause.

```typescript
import { address, AddressError, PsbtError, Psbt } from '@btc-vision/bitcoin';
import * as networks from '@btc-vision/bitcoin';

function decodeAddress(addr: string): object {
    try {
        return address.fromBase58Check(addr);
    } catch (error) {
        throw new AddressError(`Failed to decode address "${addr}": ${(error as Error).message}`);
    }
}

function finalizePsbt(psbt: Psbt): void {
    try {
        psbt.finalizeAllInputs();
    } catch (error) {
        throw new PsbtError(`PSBT finalization failed: ${(error as Error).message}`);
    }
}
```

### Using the `name` Property

Every custom error class sets a `name` property matching its class name. This is useful for logging and serialization contexts where `instanceof` is not available (for example, across worker boundaries).

```typescript
import { BitcoinError } from '@btc-vision/bitcoin';

function handleError(error: unknown): void {
    if (error instanceof BitcoinError) {
        switch (error.name) {
            case 'ValidationError':
                // handle validation
                break;
            case 'PsbtError':
                // handle PSBT
                break;
            default:
                // handle other BitcoinError subtypes
                break;
        }
    }
}
```

### Building an Application Error Layer

You can combine the library's custom error classes with your own error hierarchy.

```typescript
import { AddressError, ValidationError } from '@btc-vision/bitcoin';

class WalletError extends Error {
    constructor(message: string, public readonly cause?: Error) {
        super(message);
        this.name = 'WalletError';
    }
}

function validateUserAddress(addr: string): void {
    try {
        // ... decode and validate the address using the library
    } catch (error) {
        if (error instanceof TypeError || error instanceof Error) {
            // Wrap the standard library error in a domain-specific custom error
            throw new WalletError(`Invalid address: ${addr}`, error);
        }
        throw error;
    }
}
```

---

## Source

All error classes are defined in `src/errors.ts` and re-exported from the package entry point.
