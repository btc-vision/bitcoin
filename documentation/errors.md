# Errors

The library provides a typed error hierarchy so that callers can distinguish between different failure categories using `instanceof` checks. Every error thrown by the library extends the base `BitcoinError` class, which itself extends the built-in `Error`.

## Overview

| Error class | Purpose |
|-------------|---------|
| `BitcoinError` | Base class for all library errors |
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

## BitcoinError

Base class for all errors originating from the library. All other error classes extend this one, so catching `BitcoinError` will catch every library-specific error.

| Property | Value |
|----------|-------|
| `name` | `'BitcoinError'` |
| Extends | `Error` |

### Constructor

```typescript
new BitcoinError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Human-readable description of the error |

The constructor calls `Error.captureStackTrace` (when available on V8 engines) to maintain a clean stack trace pointing to the call site rather than the error constructor itself.

### Example

```typescript
import { BitcoinError } from '@btc-vision/bitcoin';

try {
    // ... any library operation
} catch (error) {
    if (error instanceof BitcoinError) {
        console.log('Bitcoin library error:', error.message);
        console.log('Error type:', error.name);
    }
}
```

---

## ValidationError

Thrown when input data fails validation checks such as incorrect key lengths, values outside allowed ranges, or malformed data formats.

| Property | Value |
|----------|-------|
| `name` | `'ValidationError'` |
| Extends | `BitcoinError` |

### Constructor

```typescript
new ValidationError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the validation failure |

### When It Is Thrown

- A public key has an incorrect length
- A hash value does not match the expected size
- A numeric field is outside its valid range
- Required data is missing or has an unexpected format

### Example

```typescript
import { ValidationError } from '@btc-vision/bitcoin';

try {
    // ... operation that validates input data
} catch (error) {
    if (error instanceof ValidationError) {
        console.error('Validation failed:', error.message);
    }
}
```

---

## InvalidInputError

Thrown when a transaction input is malformed or references invalid data.

| Property | Value |
|----------|-------|
| `name` | `'InvalidInputError'` |
| Extends | `BitcoinError` |

### Constructor

```typescript
new InvalidInputError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the invalid input |

### When It Is Thrown

- An input index is out of range
- An input references a malformed previous output
- Required input fields are missing or inconsistent

### Example

```typescript
import { InvalidInputError } from '@btc-vision/bitcoin';

try {
    // ... adding or signing a transaction input
} catch (error) {
    if (error instanceof InvalidInputError) {
        console.error('Bad transaction input:', error.message);
    }
}
```

---

## InvalidOutputError

Thrown when a transaction output is malformed or contains invalid values.

| Property | Value |
|----------|-------|
| `name` | `'InvalidOutputError'` |
| Extends | `BitcoinError` |

### Constructor

```typescript
new InvalidOutputError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the invalid output |

### When It Is Thrown

- An output value exceeds the maximum allowed
- An output value is negative
- An output script is malformed or empty

### Example

```typescript
import { InvalidOutputError } from '@btc-vision/bitcoin';

try {
    // ... adding a transaction output
} catch (error) {
    if (error instanceof InvalidOutputError) {
        console.error('Bad transaction output:', error.message);
    }
}
```

---

## ScriptError

Thrown when a Bitcoin script cannot be compiled or decompiled.

| Property | Value |
|----------|-------|
| `name` | `'ScriptError'` |
| Extends | `BitcoinError` |

### Constructor

```typescript
new ScriptError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the script failure |

### When It Is Thrown

- A script contains an unknown or invalid opcode sequence
- Script compilation receives invalid chunk data
- Script decompilation encounters malformed bytecode

### Example

```typescript
import { ScriptError } from '@btc-vision/bitcoin';

try {
    // ... compiling or decompiling a script
} catch (error) {
    if (error instanceof ScriptError) {
        console.error('Script error:', error.message);
    }
}
```

---

## PsbtError

Thrown when a Partially Signed Bitcoin Transaction (PSBT) operation fails.

| Property | Value |
|----------|-------|
| `name` | `'PsbtError'` |
| Extends | `BitcoinError` |

### Constructor

```typescript
new PsbtError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the PSBT failure |

### When It Is Thrown

- Attempting to finalize an input that has not been signed
- Adding duplicate or conflicting data to a PSBT
- Deserializing a malformed PSBT binary
- Combining incompatible PSBTs

### Example

```typescript
import { PsbtError } from '@btc-vision/bitcoin';

try {
    // ... PSBT construction, signing, or finalization
} catch (error) {
    if (error instanceof PsbtError) {
        console.error('PSBT error:', error.message);
    }
}
```

---

## EccError

Thrown when the ECC (Elliptic Curve Cryptography) library is not initialized or a cryptographic operation fails.

| Property | Value |
|----------|-------|
| `name` | `'EccError'` |
| Extends | `BitcoinError` |

### Constructor

```typescript
new EccError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the ECC failure |

### When It Is Thrown

- Calling a function that requires ECC before calling `initEccLib()`
- An elliptic curve point operation produces an invalid result
- Key derivation or tweaking fails

### Example

```typescript
import { EccError } from '@btc-vision/bitcoin';

try {
    // ... operation requiring ECC (key tweaking, Taproot, etc.)
} catch (error) {
    if (error instanceof EccError) {
        console.error('ECC error:', error.message);
        console.error('Ensure initEccLib() was called before this operation.');
    }
}
```

---

## AddressError

Thrown when a Bitcoin address cannot be encoded or decoded.

| Property | Value |
|----------|-------|
| `name` | `'AddressError'` |
| Extends | `BitcoinError` |

### Constructor

```typescript
new AddressError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the address failure |

### When It Is Thrown

- An address has an invalid checksum
- An address uses an unrecognized prefix or version
- The decoded witness program has an incorrect length
- A bech32/bech32m string is malformed

### Example

```typescript
import { AddressError } from '@btc-vision/bitcoin';

try {
    // ... encoding or decoding an address
} catch (error) {
    if (error instanceof AddressError) {
        console.error('Address error:', error.message);
    }
}
```

---

## SignatureError

Thrown when a signature cannot be created or validated.

| Property | Value |
|----------|-------|
| `name` | `'SignatureError'` |
| Extends | `BitcoinError` |

### Constructor

```typescript
new SignatureError(message: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Description of the signature failure |

### When It Is Thrown

- A signature has an invalid DER or Schnorr format
- Signature verification fails against the expected public key
- A sighash type is invalid or unsupported

### Example

```typescript
import { SignatureError } from '@btc-vision/bitcoin';

try {
    // ... signing or verifying a transaction
} catch (error) {
    if (error instanceof SignatureError) {
        console.error('Signature error:', error.message);
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

### Catching All Library Errors

Because every error class extends `BitcoinError`, a single `instanceof` check catches them all.

```typescript
import { BitcoinError } from '@btc-vision/bitcoin';

try {
    // ... any library operation
} catch (error) {
    if (error instanceof BitcoinError) {
        console.error(`[${error.name}] ${error.message}`);
    } else {
        throw error; // re-throw non-library errors
    }
}
```

### Catching Specific Error Types

Use `instanceof` to handle different error categories separately.

```typescript
import {
    BitcoinError,
    AddressError,
    PsbtError,
    EccError,
} from '@btc-vision/bitcoin';

try {
    // ... complex operation involving addresses, PSBT, and ECC
} catch (error) {
    if (error instanceof EccError) {
        console.error('ECC not initialized or crypto failure:', error.message);
    } else if (error instanceof AddressError) {
        console.error('Invalid address:', error.message);
    } else if (error instanceof PsbtError) {
        console.error('PSBT problem:', error.message);
    } else if (error instanceof BitcoinError) {
        console.error('Other library error:', error.message);
    } else {
        throw error;
    }
}
```

### Using the `name` Property

Every error sets a `name` property matching its class name. This is useful for logging and serialization contexts where `instanceof` is not available (for example, across worker boundaries).

```typescript
import { BitcoinError } from '@btc-vision/bitcoin';

try {
    // ... some operation
} catch (error) {
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

### Wrapping Domain-Specific Errors

You can catch library errors and wrap them in your application's own error types while preserving the original cause.

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
        // ... decode and validate the address
    } catch (error) {
        if (error instanceof AddressError || error instanceof ValidationError) {
            throw new WalletError(`Invalid address: ${addr}`, error);
        }
        throw error;
    }
}
```

---

## Source

All error classes are defined in `src/errors.ts` and re-exported from the package entry point.
