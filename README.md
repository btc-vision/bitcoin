# @btc-vision/bitcoin

![Bitcoin](https://img.shields.io/badge/Bitcoin-000?style=for-the-badge&logo=bitcoin&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![NodeJS](https://img.shields.io/badge/Node%20js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![NPM](https://img.shields.io/badge/npm-CB3837?style=for-the-badge&logo=npm&logoColor=white)

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

## Overview

A client-side Bitcoin library for Node.js and browsers, written in TypeScript. Provides low-level transaction handling, PSBT (Partially Signed Bitcoin Transactions), address encoding/decoding, payment script creation, and cryptographic operations across multiple networks.

This is a modernized fork of [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib) with significant API changes:

- **Branded types** (`Bytes32`, `PrivateKey`, `PublicKey`, `Satoshi`, etc.) for compile-time safety
- **Modular PSBT architecture** split into composable classes (`PsbtCache`, `PsbtSigner`, `PsbtFinalizer`, `PsbtTransaction`)
- **Worker-based parallel signing** for both Node.js (`worker_threads`) and browsers (Web Workers)
- **Native `Uint8Array`** throughout (no Node.js `Buffer` dependency)
- **`bigint` for satoshi values** instead of `number` to prevent precision loss
- **Structured error hierarchy** with typed error classes
- **Granular sub-path exports** for tree-shaking
- **Multi-chain support** including Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, and Dash

> **Breaking Changes from bitcoinjs-lib**
>
> This library has undergone massive API-breaking changes. Transaction values use `bigint` (as `Satoshi`), all byte buffers are `Uint8Array` with branded type wrappers, the ECC library must be explicitly initialized, and key management has been moved to [`@btc-vision/ecpair`](https://github.com/btc-vision/ecpair) and [`@btc-vision/bip32`](https://github.com/btc-vision/bip32).

## Installation

```bash
npm install @btc-vision/bitcoin
# Key management libraries (separate packages)
npm install @btc-vision/ecpair @btc-vision/bip32
# ECC backend
npm install tiny-secp256k1
```

Requires Node.js >= 24.0.0.

## Quick Start

### Initialize the ECC Library

The ECC library must be initialized before using Taproot, signing, or any elliptic curve operations.
Two backends are available:

**Noble (recommended for browsers)** -- pure JS, no WASM dependency:

```typescript
import { initEccLib } from '@btc-vision/bitcoin';
import { createNobleBackend } from '@btc-vision/ecpair';

initEccLib(createNobleBackend());
```

**tiny-secp256k1** -- WASM-based, faster in Node.js:

```typescript
import { initEccLib } from '@btc-vision/bitcoin';
import { createLegacyBackend } from '@btc-vision/ecpair';
import * as tinysecp from 'tiny-secp256k1';

initEccLib(createLegacyBackend(tinysecp));
```

### Create a Key Pair

```typescript
import { ECPairSigner, createNobleBackend } from '@btc-vision/ecpair';
import { networks } from '@btc-vision/bitcoin';

const backend = createNobleBackend();

// Random key pair
const keyPair = ECPairSigner.makeRandom(backend, networks.bitcoin);

// From WIF
const imported = ECPairSigner.fromWIF(
    backend,
    'L2uPYXe17xSTqbCjZvL2DsyXPCbXspvcu5mHLDYUgzdUbZGSKrSr',
    networks.bitcoin,
);
```

### Generate Addresses

```typescript
import { payments, networks } from '@btc-vision/bitcoin';

// P2PKH (Legacy)
const { address: legacy } = payments.p2pkh({ pubkey: keyPair.publicKey });

// P2WPKH (Native SegWit)
const { address: segwit } = payments.p2wpkh({ pubkey: keyPair.publicKey });

// P2TR (Taproot) - requires ECC initialization
import { toXOnly } from '@btc-vision/bitcoin';
const { address: taproot } = payments.p2tr({
    internalPubkey: toXOnly(keyPair.publicKey),
});

// P2SH-P2WPKH (Wrapped SegWit)
const { address: wrapped } = payments.p2sh({
    redeem: payments.p2wpkh({ pubkey: keyPair.publicKey }),
});

// P2SH Multisig (2-of-3)
const { address: multisig } = payments.p2sh({
    redeem: payments.p2ms({ m: 2, pubkeys: [pubkey1, pubkey2, pubkey3] }),
});
```

### Create and Sign a Transaction (PSBT)

```typescript
import { Psbt, networks } from '@btc-vision/bitcoin';
import { fromHex } from '@btc-vision/bitcoin';
import type { Satoshi } from '@btc-vision/bitcoin';

const psbt = new Psbt({ network: networks.bitcoin });

// Add input
psbt.addInput({
    hash: '7d067b4a697a09d2c3cff7d4d9506c9955e93bff41bf82d439da7d030382bc3e',
    index: 0,
    nonWitnessUtxo: fromHex('0200000001...'),
    sighashType: 1,
});

// Add output (values are bigint)
psbt.addOutput({
    address: '1KRMKfeZcmosxALVYESdPNez1AP1mEtywp',
    value: 80_000n as Satoshi,
});

// Sign, finalize, and extract
psbt.signInput(0, keyPair);
psbt.finalizeAllInputs();
const txHex = psbt.extractTransaction().toHex();
```

### Async Signing

```typescript
await psbt.signInputAsync(0, keyPair);
await psbt.signAllInputsAsync(keyPair);
```

### Parse a Transaction

```typescript
import { Transaction } from '@btc-vision/bitcoin';

const tx = Transaction.fromHex('0200000001...');
console.log(tx.version);     // 2
console.log(tx.ins.length);  // number of inputs
console.log(tx.outs.length); // number of outputs
console.log(tx.toHex());     // round-trip back to hex
```

### Decode and Encode Addresses

```typescript
import { address, networks } from '@btc-vision/bitcoin';

// Decode any address to its output script
const outputScript = address.toOutputScript(
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    networks.bitcoin,
);

// Convert output script back to address
const addr = address.fromOutputScript(outputScript, networks.bitcoin);

// Low-level Base58Check
const { hash, version } = address.fromBase58Check('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH');
const encoded = address.toBase58Check(hash, version);

// Low-level Bech32
const decoded = address.fromBech32('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
const bech32Addr = address.toBech32(decoded.data, decoded.version, 'bc');
```

### Parallel Signing with Workers

For high-throughput signing across many inputs, use the worker pool.

#### Sign a PSBT in parallel

`signPsbtParallel` analyzes inputs, distributes signing across workers, and applies signatures back to the PSBT:

```typescript
import { Psbt, networks } from '@btc-vision/bitcoin';
import { signPsbtParallel, createSigningPool } from '@btc-vision/bitcoin/workers';

// Create a platform-appropriate pool (Node.js worker_threads or Web Workers)
const pool = await createSigningPool({ workerCount: 4 });
pool.preserveWorkers();

// Build your PSBT as usual
const psbt = new Psbt({ network: networks.bitcoin });
psbt.addInput({ /* ... */ });
psbt.addInput({ /* ... */ });
psbt.addOutput({ /* ... */ });

// Sign all signable inputs in parallel — replaces signAllInputs / signAllInputsAsync
const result = await signPsbtParallel(psbt, keyPair, pool);

if (result.success) {
    console.log(`Signed ${result.signatures.size} inputs in ${result.durationMs}ms`);
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
}

// Shut down when done (or keep the pool alive for future PSBTs)
await pool.shutdown();
```

You can also pass a config object instead of a pool instance. A temporary pool will be created and
destroyed automatically:

```typescript
const result = await signPsbtParallel(psbt, keyPair, { workerCount: 4 });
```

#### Low-level batch signing

For manual control over sighash computation and task construction:

```typescript
import { createSigningPool, SignatureType } from '@btc-vision/bitcoin/workers';

const pool = await createSigningPool({ workerCount: 4 });
pool.preserveWorkers();

const tasks = [
    {
        taskId: 'input-0',
        inputIndex: 0,
        hash: sighash0,
        signatureType: SignatureType.ECDSA,
        sighashType: 0x01,
    },
    {
        taskId: 'input-1',
        inputIndex: 1,
        hash: sighash1,
        signatureType: SignatureType.Schnorr,
        sighashType: 0x00,
    },
];

const result = await pool.signBatch(tasks, keyPair);
if (result.success) {
    console.log(`Signed ${result.signatures.size} inputs in ${result.durationMs}ms`);
}

await pool.shutdown();
```

## API Reference

### Exports

The library provides granular sub-path exports for tree-shaking:

```typescript
import { ... } from '@btc-vision/bitcoin';          // Full API
import { ... } from '@btc-vision/bitcoin/address';   // Address encoding/decoding
import { ... } from '@btc-vision/bitcoin/script';    // Script compile/decompile
import { ... } from '@btc-vision/bitcoin/crypto';    // Hash functions
import { ... } from '@btc-vision/bitcoin/transaction';// Transaction class
import { ... } from '@btc-vision/bitcoin/psbt';      // PSBT classes
import { ... } from '@btc-vision/bitcoin/networks';  // Network definitions
import { ... } from '@btc-vision/bitcoin/payments';   // Payment creators
import { ... } from '@btc-vision/bitcoin/io';        // Binary I/O utilities
import { ... } from '@btc-vision/bitcoin/ecc';       // ECC context
import { ... } from '@btc-vision/bitcoin/types';     // Type definitions & guards
import { ... } from '@btc-vision/bitcoin/errors';    // Error classes
import { ... } from '@btc-vision/bitcoin/workers';   // Parallel signing
```

### Branded Types

Values use branded types to prevent accidental misuse:

```typescript
import type {
    Bytes32,           // 32-byte Uint8Array (tx hashes, witness programs)
    Bytes20,           // 20-byte Uint8Array (pubkey hashes)
    PublicKey,         // Compressed/uncompressed public key
    XOnlyPublicKey,    // 32-byte x-only pubkey (Taproot)
    PrivateKey,        // 32-byte private key
    Satoshi,           // bigint value (0 to 21e14)
    Signature,         // DER-encoded ECDSA signature
    SchnorrSignature,  // 64-byte Schnorr signature
    Script,            // Compiled script bytes
} from '@btc-vision/bitcoin';

// Type guards
import {
    isBytes32, isBytes20, isPoint, isSatoshi,
    isPrivateKey, isSignature, isSchnorrSignature,
    isXOnlyPublicKey, isScript,
} from '@btc-vision/bitcoin';

// Conversion helpers (throw on invalid input)
import { toBytes32, toBytes20, toSatoshi } from '@btc-vision/bitcoin';
```

### Payment Types

| Type | Function | Class | Description |
|------|----------|-------|-------------|
| P2PK | `p2pk()` | `P2PK` | Pay-to-Public-Key |
| P2PKH | `p2pkh()` | `P2PKH` | Pay-to-Public-Key-Hash (Legacy) |
| P2SH | `p2sh()` | `P2SH` | Pay-to-Script-Hash |
| P2MS | `p2ms()` | `P2MS` | Pay-to-Multisig |
| P2WPKH | `p2wpkh()` | `P2WPKH` | SegWit v0 Public Key Hash |
| P2WSH | `p2wsh()` | `P2WSH` | SegWit v0 Script Hash |
| P2TR | `p2tr()` | `P2TR` | Taproot (SegWit v1) |
| P2OP | `p2op()` | `P2OP` | OPNet (SegWit v16) |
| Embed | `p2data()` | `Embed` | OP_RETURN data |

### Network Support

| Network | Constant | Bech32 Prefix |
|---------|----------|---------------|
| Bitcoin Mainnet | `networks.bitcoin` | `bc` |
| Bitcoin Testnet | `networks.testnet` | `tb` |
| Bitcoin Regtest | `networks.regtest` | `bcrt` |
| Dogecoin | `networks.dogecoin` | - |
| Litecoin | `networks.litecoin` | `ltc` |
| Bitcoin Cash | `networks.bitcoinCash` | `bitcoincash` |
| Dash | `networks.dash` | - |

### Error Handling

All errors extend `BitcoinError`:

```typescript
import {
    BitcoinError,      // Base class
    ValidationError,   // Input validation failures
    InvalidInputError, // Invalid transaction input
    InvalidOutputError,// Invalid transaction output
    ScriptError,       // Script operation failures
    PsbtError,         // PSBT operation failures
    EccError,          // ECC library not initialized
    AddressError,      // Address encoding/decoding failures
    SignatureError,    // Signature operation failures
} from '@btc-vision/bitcoin';

try {
    psbt.signInput(0, signer);
} catch (err) {
    if (err instanceof PsbtError) {
        // Handle PSBT-specific error
    }
}
```

### Utility Functions

```typescript
import {
    toHex, fromHex, isHex,       // Hex encoding
    concat, equals, compare,      // Buffer operations
    clone, reverse, reverseCopy,  // Buffer manipulation
    alloc, xor, isZero,           // Buffer utilities
    fromUtf8, toUtf8,             // UTF-8 conversion
    toXOnly,                       // Compress pubkey to x-only (32 bytes)
    decompressPublicKey,           // Decompress compressed pubkey
} from '@btc-vision/bitcoin';
```

### Crypto Functions

```typescript
import { sha256, sha1, ripemd160, hash160, hash256, taggedHash } from '@btc-vision/bitcoin';

const h = hash160(publicKey);         // RIPEMD160(SHA256(data))
const d = hash256(data);              // SHA256(SHA256(data))
const t = taggedHash('TapLeaf', data); // BIP340 tagged hash
```

## Browser Usage

The library ships with a browser-optimized build via the `browser` conditional export. Bundlers that support the `exports` field in `package.json` (Vite, Webpack 5+, esbuild) will automatically resolve to the browser build.

For browser environments, use `createNobleBackend()` -- it is pure JavaScript with no WASM dependency. The `tiny-secp256k1` backend requires WebAssembly support and is better suited for Node.js.

## React Native

The library works in React Native with Hermes 0.76+ (BigInt and `crypto.getRandomValues()` required). The core library (PSBT, transactions, addresses, crypto) is pure JS and runs on the main thread. Parallel signing uses `react-native-worklets` when available, otherwise falls back to sequential execution automatically.

### Metro Configuration

Add `react-native` to the condition names in your `metro.config.js`:

```javascript
const config = {
    resolver: {
        unstable_conditionNames: ['react-native', 'import', 'default'],
    },
};
```

### Usage

Usage is identical to Node.js and browsers:

```typescript
import { initEccLib, Psbt, networks } from '@btc-vision/bitcoin';
import { createNobleBackend, ECPairSigner } from '@btc-vision/ecpair';

// Initialize ECC (pure JS Noble backend — no WASM needed)
const backend = createNobleBackend();
initEccLib(backend);

// Create key pair, build PSBT, sign — same API as Node.js/browser
const keyPair = ECPairSigner.fromWIF(backend, wif, networks.bitcoin);
const psbt = new Psbt({ network: networks.bitcoin });
// ... add inputs/outputs ...
psbt.signAllInputs(keyPair);
```

### Parallel Signing

`signPsbtParallel()` and `createSigningPool()` support true parallel signing in React Native via [`react-native-worklets`](https://github.com/margelo/react-native-worklets) (Software Mansion, v0.7+). Each worklet runtime gets its own ECC module instance and signing tasks are distributed round-robin across runtimes.

Install the optional peer dependency to enable parallel signing:

```bash
npm install react-native-worklets
```

Usage is identical to Node.js/browser — `createSigningPool()` detects worklets automatically:

```typescript
import { signPsbtParallel, createSigningPool } from '@btc-vision/bitcoin/workers';

// Automatically uses WorkletSigningPool if react-native-worklets is installed,
// otherwise falls back to SequentialSigningPool (main-thread, one-by-one)
const pool = await createSigningPool({ workerCount: 4 });
pool.preserveWorkers();

const result = await signPsbtParallel(psbt, keyPair, pool);
await pool.shutdown();
```

You can also import `WorkletSigningPool` directly for explicit control:

```typescript
import { WorkletSigningPool } from '@btc-vision/bitcoin/workers';

const pool = WorkletSigningPool.getInstance({ workerCount: 4 });
pool.preserveWorkers();
await pool.initialize();

const result = await pool.signBatch(tasks, keyPair);
await pool.shutdown();
```

If `react-native-worklets` is not installed, `createSigningPool()` returns a `SequentialSigningPool` that signs inputs one-by-one on the main thread using the same API.

### Requirements

- **Hermes 0.76+** (React Native 0.76+) for BigInt and `crypto.getRandomValues()` support
- **`react-native-worklets` >= 0.7.0** (optional) for parallel signing across worklet runtimes
- `react-native-quick-crypto` is **not** required — the core library uses `@noble/hashes` and `@noble/curves` (pure JS)
- A future `@btc-vision/react-native-secp256k1` Nitro Module would provide native C++ performance via `initEccLib(createNativeBackend())`

## Running Tests

```bash
npm test                    # Full suite (lint + build + test)
npm run unit                # Unit tests only
npm run integration         # Integration tests
npm run test:browser        # Browser tests (Playwright)
npm run bench               # Benchmarks
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## License

[MIT](LICENSE)

## Links

- [GitHub](https://github.com/btc-vision/bitcoin)
- [npm](https://www.npmjs.com/package/@btc-vision/bitcoin)
- [API Documentation](https://bitcoinjs.github.io/bitcoinjs-lib/)
