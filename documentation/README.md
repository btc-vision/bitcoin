# @btc-vision/bitcoin Documentation

Comprehensive documentation for the `@btc-vision/bitcoin` library — a high-performance Bitcoin library with full support for legacy, SegWit, Taproot, and quantum-safe P2MR transactions.

## Quick Start

```bash
npm install @btc-vision/bitcoin
```

```typescript
import {
    networks,
    address,
    payments,
    script,
    crypto,
    Transaction,
    Psbt,
    initEccLib,
} from '@btc-vision/bitcoin';
```

---

## Table of Contents

### Core Modules

| Document | Description |
|----------|-------------|
| [Networks](./networks.md) | Supported networks (Bitcoin, testnet, regtest, Dogecoin, Litecoin, etc.) |
| [Types](./types.md) | Branded types, type guards, and assertion helpers |
| [Errors](./errors.md) | Error class hierarchy and handling patterns |

### Encoding & Addressing

| Document | Description |
|----------|-------------|
| [Address](./address.md) | Address encoding/decoding (Base58Check, Bech32, Bech32m) |
| [I/O Utilities](./io.md) | Hex, Base64, Base58Check, buffer utilities, varuint |

### Script & Cryptography

| Document | Description |
|----------|-------------|
| [Script](./script.md) | Script compilation, decompilation, opcodes reference |
| [Cryptography](./crypto.md) | SHA-256, RIPEMD-160, Hash160, Hash256, tagged hashes |
| [ECC](./ecc.md) | Elliptic curve initialization, public key utilities |

### Payment Types

| Document | Description |
|----------|-------------|
| [Payments](./payments.md) | All payment types overview (P2PK, P2PKH, P2SH, P2MS, P2WPKH, P2WSH, P2TR, P2MR, P2OP, Embed) |
| [P2MR](./p2mr.md) | Pay-to-Merkle-Root (BIP 360) — quantum-safe script tree commitments |
| [Taproot](./taproot.md) | BIP 341 utilities — hash trees, leaf hashing, key tweaking, control blocks |

### Transactions & PSBT

| Document | Description |
|----------|-------------|
| [Transaction](./transaction.md) | Transaction class — construction, serialization, signing data |
| [PSBT](./psbt.md) | Partially Signed Bitcoin Transactions (BIP 174) — signing, finalizing, extracting |
| [Block](./block.md) | Block parsing, proof-of-work validation, merkle root verification |

### Performance

| Document | Description |
|----------|-------------|
| [Workers](./workers.md) | Parallel signing with Web Workers, worker_threads, and Worklets |

---

## Supported Payment Types

| Type | Class | Factory | Address | SegWit | Description |
|------|-------|---------|---------|--------|-------------|
| P2PK | `P2PK` | `p2pk()` | None | No | Pay to Public Key |
| P2PKH | `P2PKH` | `p2pkh()` | `1...` | No | Pay to Public Key Hash |
| P2SH | `P2SH` | `p2sh()` | `3...` | No | Pay to Script Hash |
| P2MS | `P2MS` | `p2ms()` | None | No | Pay to Multisig |
| P2WPKH | `P2WPKH` | `p2wpkh()` | `bc1q...` | v0 | Pay to Witness Public Key Hash |
| P2WSH | `P2WSH` | `p2wsh()` | `bc1q...` | v0 | Pay to Witness Script Hash |
| P2TR | `P2TR` | `p2tr()` | `bc1p...` | v1 | Pay to Taproot (BIP 341) |
| P2MR | `P2MR` | `p2mr()` | `bc1z...` | v2 | Pay to Merkle Root (BIP 360) |
| P2OP | `P2OP` | `p2op()` | `opnet1...` | v16 | Pay to OPNet |
| Embed | `Embed` | `p2data()` | None | N/A | OP_RETURN data embedding |

---

## Supported Networks

| Network | Mainnet | Testnet | Regtest |
|---------|---------|---------|---------|
| Bitcoin | `networks.bitcoin` | `networks.testnet` | `networks.regtest` |
| Dogecoin | `networks.dogecoin` | `networks.dogecoinTestnet` | — |
| Litecoin | `networks.litecoin` | `networks.litecoinTestnet` | — |
| Bitcoin Cash | `networks.bitcoinCash` | `networks.bitcoinCashTestnet` | — |
| Dash | `networks.dash` | `networks.dashTestnet` | — |

---

## Architecture

```
@btc-vision/bitcoin
├── address        — Address encoding/decoding
├── crypto         — Hash functions (SHA-256, RIPEMD-160, tagged hashes)
├── ecc            — Elliptic curve context and key utilities
├── errors         — Error class hierarchy
├── io             — Binary I/O, hex, base64, base58check
├── networks       — Network configurations
├── payments       — Payment type classes (P2PKH, P2TR, P2MR, etc.)
│   ├── bip341     — Taproot tree utilities
│   └── types      — Payment interfaces and union types
├── psbt           — PSBT construction, signing, finalization
├── script         — Script compilation, opcodes
├── transaction    — Raw transaction class
├── types          — Branded types and type guards
└── workers        — Parallel signing (Web Workers, worker_threads)
```
