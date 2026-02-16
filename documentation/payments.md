# Payments Reference

Complete reference for all Bitcoin payment types in the `@btc-vision/bitcoin` library.

Each payment type is implemented as a class with lazy-computed getters, static factory methods, and a legacy factory function for backwards compatibility.

---

## Overview

| Payment Type | Full Name | Class | Factory | Address Format | SegWit Version | BIP |
|---|---|---|---|---|---|---|
| P2PK | Pay-to-Public-Key | `P2PK` | `p2pk()` | None | N/A (legacy) | - |
| P2PKH | Pay-to-Public-Key-Hash | `P2PKH` | `p2pkh()` | `1...` (Base58Check) | N/A (legacy) | - |
| P2SH | Pay-to-Script-Hash | `P2SH` | `p2sh()` | `3...` (Base58Check) | N/A (legacy) | 16 |
| P2MS | Pay-to-Multisig | `P2MS` | `p2ms()` | None | N/A (legacy) | 11 |
| P2WPKH | Pay-to-Witness-Public-Key-Hash | `P2WPKH` | `p2wpkh()` | `bc1q...` (bech32) | 0 | 141 |
| P2WSH | Pay-to-Witness-Script-Hash | `P2WSH` | `p2wsh()` | `bc1q...` (bech32) | 0 | 141 |
| P2TR | Pay-to-Taproot | `P2TR` | `p2tr()` | `bc1p...` (bech32m) | 1 | 341 |
| P2MR | Pay-to-Merkle-Root | `P2MR` | `p2mr()` | `bc1z...` (bech32m) | 2 | 360 |
| P2OP | Pay-to-OPNet | `P2OP` | `p2op()` | bech32m (custom prefix) | 16 | - |
| Embed | OP_RETURN Data | `Embed` | `p2data()` | None | N/A | - |

---

## Import

```typescript
import {
    // Types and interfaces
    PaymentType,
    type BasePayment,
    type ScriptRedeem,
    type Payment,
    type PaymentCreator,
    type PaymentOpts,

    // Payment classes and factory functions
    P2PK, p2pk,
    P2PKH, p2pkh,
    P2SH, p2sh,
    P2MS, p2ms,
    P2WPKH, p2wpkh,
    P2WSH, p2wsh,
    P2TR, p2tr,
    P2MR, p2mr,
    P2OP, p2op,
    Embed, p2data,

    // Individual payment type interfaces
    type P2PKPayment,
    type P2PKHPayment,
    type P2SHPayment,
    type P2MSPayment,
    type P2WPKHPayment,
    type P2WSHPayment,
    type P2TRPayment,
    type P2MRPayment,
    type P2OPPayment,
    type P2OPPaymentParams,
    type EmbedPayment,

    // BIP341 Taproot utilities
    findScriptPath,
    LEAF_VERSION_TAPSCRIPT,
    MAX_TAPTREE_DEPTH,
    rootHashFromPath,
    rootHashFromPathP2MR,
    tapBranchHash,
    tapleafHash,
    toHashTree,
    tweakKey,
    type HashTree,
} from '@btc-vision/bitcoin';
```

---

## PaymentType Enum

`PaymentType` is a const object used as a discriminant for the `Payment` union type. Each payment class returns its corresponding `PaymentType` value from the `name` getter.

```typescript
const PaymentType = {
    P2PK: 'p2pk',
    P2PKH: 'p2pkh',
    P2SH: 'p2sh',
    P2MS: 'p2ms',
    P2WPKH: 'p2wpkh',
    P2WSH: 'p2wsh',
    P2TR: 'p2tr',
    P2MR: 'p2mr',
    P2OP: 'p2op',
    Embed: 'embed',
    ScriptRedeem: 'scriptRedeem',
} as const;

type PaymentType = (typeof PaymentType)[keyof typeof PaymentType];
```

---

## Common Interfaces

### BasePayment

The base interface shared by all payment types.

```typescript
interface BasePayment {
    readonly name?: string | undefined;
    readonly network?: Network | undefined;
    readonly output?: Script | undefined;
    readonly input?: Script | undefined;
    readonly address?: string | undefined;
    readonly witness?: Uint8Array[] | undefined;
    readonly redeem?: ScriptRedeem | undefined;
    readonly useHybrid?: boolean | undefined;
    readonly useUncompressed?: boolean | undefined;
}
```

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Discriminant label for the union type (e.g., `'p2pkh'`, `'p2tr'`). |
| `network` | `Network` | Network parameters (mainnet if omitted). |
| `output` | `Script` | Fully-assembled scriptPubKey. |
| `input` | `Script` | Raw scriptSig (legacy types only). |
| `address` | `string` | Human-readable address. |
| `witness` | `Uint8Array[]` | SegWit witness stack (empty for legacy). |
| `redeem` | `ScriptRedeem` | Script template for P2SH, P2WSH, P2TR, etc. |
| `useHybrid` | `boolean` | Use hybrid public key format (non-standard). |
| `useUncompressed` | `boolean` | Use uncompressed public key format (non-standard). |

### ScriptRedeem

Helper interface used by redeeming script-template outputs (P2SH, P2WSH, P2TR, P2MR).

```typescript
interface ScriptRedeem extends BasePayment {
    readonly output?: Script | undefined;
    readonly redeemVersion?: number | undefined;
    readonly network?: Network | undefined;
}
```

### PaymentOpts

Options passed to constructors and factory functions.

```typescript
interface PaymentOpts {
    readonly validate?: boolean;       // Validate inputs (default: true)
    readonly allowIncomplete?: boolean; // Allow incomplete signatures (default: false)
}
```

### PaymentCreator

Generic factory function type.

```typescript
type PaymentCreator = <T extends BasePayment>(a: T, opts?: PaymentOpts) => T;
```

### Payment (Union Type)

The discriminated union of all payment types.

```typescript
type Payment =
    | P2PKPayment
    | P2PKHPayment
    | P2SHPayment
    | P2MSPayment
    | P2WPKHPayment
    | P2WSHPayment
    | P2TRPayment
    | P2MRPayment
    | P2OPPayment
    | EmbedPayment
    | ScriptRedeem;
```

---

## P2PK (Pay-to-Public-Key)

P2PK is the simplest Bitcoin payment type. The output script contains a public key directly, and spending requires a single signature from that key. P2PK has no address format.

### Overview

| Property | Value |
|----------|-------|
| SegWit version | N/A (legacy) |
| Address format | None |
| Script size | 35 bytes (compressed) or 67 bytes (uncompressed) |

### Script Structure

```
Output:   {pubKey} OP_CHECKSIG
Input:    {signature}
Witness:  [] (empty)
```

### Class: P2PK

```typescript
class P2PK {
    static readonly NAME = 'p2pk';

    constructor(params: {
        pubkey?: Uint8Array;
        signature?: Uint8Array;
        output?: Uint8Array;
        input?: Uint8Array;
        network?: Network;
    }, opts?: PaymentOpts);

    // Getters
    get name(): 'p2pk';
    get network(): Network;
    get pubkey(): PublicKey | undefined;
    get signature(): Signature | undefined;
    get output(): Script | undefined;
    get input(): Script | undefined;
    get witness(): Uint8Array[] | undefined;

    // Static factory methods
    static fromPubkey(pubkey: PublicKey, network?: Network): P2PK;
    static fromOutput(output: Uint8Array, network?: Network): P2PK;
    static fromSignature(signature: Signature, pubkey?: PublicKey, network?: Network): P2PK;

    toPayment(): P2PKPayment;
}
```

### Factory Function

```typescript
function p2pk(a: Omit<P2PKPayment, 'name'>, opts?: PaymentOpts): P2PKPayment;
```

### P2PKPayment Interface

```typescript
interface P2PKPayment extends BasePayment {
    readonly name: 'p2pk';
    readonly pubkey?: PublicKey | undefined;
    readonly signature?: Signature | undefined;
}
```

### Examples

```typescript
import { P2PK, p2pk } from '@btc-vision/bitcoin';

// Create from public key (class)
const payment = P2PK.fromPubkey(pubkey);
console.log(payment.output); // {pubKey} OP_CHECKSIG

// Create from output script (class)
const decoded = P2PK.fromOutput(scriptPubKey);
console.log(decoded.pubkey); // extracted public key

// Create from signature for spending
const spender = P2PK.fromSignature(signature, pubkey);
console.log(spender.input); // {signature}

// Legacy factory function
const legacy = p2pk({ pubkey });
console.log(legacy.output);
```

---

## P2PKH (Pay-to-Public-Key-Hash)

P2PKH is the most common legacy Bitcoin payment type. The output script contains the hash of a public key, and spending requires both the full public key and a valid signature. Addresses start with `1` on mainnet.

### Overview

| Property | Value |
|----------|-------|
| SegWit version | N/A (legacy) |
| Address format | Base58Check (`1...` mainnet, `m...`/`n...` testnet) |
| Hash algorithm | RIPEMD160(SHA256(pubkey)) = 20 bytes |
| Script size | 25 bytes |

### Script Structure

```
Output:   OP_DUP OP_HASH160 {hash160(pubkey)} OP_EQUALVERIFY OP_CHECKSIG
Input:    {signature} {pubkey}
Witness:  [] (empty)
```

### Class: P2PKH

```typescript
class P2PKH {
    static readonly NAME = 'p2pkh';

    constructor(params: {
        address?: string;
        hash?: Uint8Array;
        pubkey?: Uint8Array;
        signature?: Uint8Array;
        output?: Uint8Array;
        input?: Uint8Array;
        network?: Network;
        useHybrid?: boolean;
        useUncompressed?: boolean;
    }, opts?: PaymentOpts);

    // Getters
    get name(): 'p2pkh';
    get network(): Network;
    get address(): string | undefined;
    get hash(): Bytes20 | undefined;
    get pubkey(): PublicKey | undefined;
    get signature(): Signature | undefined;
    get output(): Script | undefined;
    get input(): Script | undefined;
    get witness(): Uint8Array[] | undefined;

    // Static factory methods
    static fromPubkey(pubkey: PublicKey, network?: Network): P2PKH;
    static fromAddress(address: string, network?: Network): P2PKH;
    static fromHash(hash: Bytes20, network?: Network): P2PKH;
    static fromOutput(output: Uint8Array, network?: Network): P2PKH;

    toPayment(): P2PKHPayment;
}
```

### Factory Function

```typescript
function p2pkh(a: Omit<P2PKHPayment, 'name'>, opts?: PaymentOpts): P2PKHPayment;
```

### P2PKHPayment Interface

```typescript
interface P2PKHPayment extends BasePayment {
    readonly name: 'p2pkh';
    readonly hash?: Bytes20 | undefined;
    readonly pubkey?: PublicKey | undefined;
    readonly signature?: Signature | undefined;
}
```

### Examples

```typescript
import { P2PKH, p2pkh } from '@btc-vision/bitcoin';

// Create from public key
const payment = P2PKH.fromPubkey(pubkey);
console.log(payment.address); // 1BvBMSEYstWetq...
console.log(payment.hash);    // 20-byte hash
console.log(payment.output);  // OP_DUP OP_HASH160 {hash} OP_EQUALVERIFY OP_CHECKSIG

// Create from address
const fromAddr = P2PKH.fromAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
console.log(fromAddr.hash);   // 20-byte pubkey hash

// Create from 20-byte hash
const fromHash = P2PKH.fromHash(hash160);
console.log(fromHash.address);

// Legacy factory function
const legacy = p2pkh({ pubkey });
const fromAddrLegacy = p2pkh({ address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2' });
```

---

## P2SH (Pay-to-Script-Hash)

P2SH allows spending to be based on a hash of a script, with the actual script revealed only at spend time. This enables complex spending conditions while keeping addresses short. Addresses start with `3` on mainnet.

### Overview

| Property | Value |
|----------|-------|
| SegWit version | N/A (legacy, but can wrap SegWit) |
| Address format | Base58Check (`3...` mainnet, `2...` testnet) |
| Hash algorithm | HASH160(redeemScript) = 20 bytes |
| Script size | 23 bytes |
| BIP | 16 |

### Script Structure

```
Output:   OP_HASH160 {hash160(redeemScript)} OP_EQUAL
Input:    {redeemScriptSig...} {redeemScript}
Witness:  [] (or forwarded from wrapped SegWit)
```

### Dynamic Name

The `name` getter returns a dynamic string based on the nested redeem type:
- `'p2sh'` when no redeem type is known
- `'p2sh-p2wpkh'` when wrapping P2WPKH
- `'p2sh-p2wsh'` when wrapping P2WSH

### Class: P2SH

```typescript
class P2SH {
    static readonly NAME = 'p2sh';

    constructor(params: {
        address?: string;
        hash?: Uint8Array;
        output?: Uint8Array;
        input?: Uint8Array;
        redeem?: ScriptRedeem;
        witness?: Uint8Array[];
        network?: Network;
    }, opts?: PaymentOpts);

    // Getters
    get name(): string;          // Dynamic: 'p2sh' or 'p2sh-{redeemName}'
    get network(): Network;
    get address(): string | undefined;
    get hash(): Bytes20 | undefined;
    get output(): Script | undefined;
    get input(): Script | undefined;
    get redeem(): ScriptRedeem | undefined;
    get witness(): Uint8Array[] | undefined;

    // Static factory methods
    static fromRedeem(redeem: ScriptRedeem, network?: Network): P2SH;
    static fromAddress(address: string, network?: Network): P2SH;
    static fromHash(hash: Bytes20, network?: Network): P2SH;
    static fromOutput(output: Uint8Array, network?: Network): P2SH;

    toPayment(): P2SHPayment;
}
```

### Factory Function

```typescript
function p2sh(a: Omit<P2SHPayment, 'name'>, opts?: PaymentOpts): P2SHPayment;
```

### P2SHPayment Interface

```typescript
interface P2SHPayment extends BasePayment {
    readonly name: string;                       // Dynamic name
    readonly hash?: Bytes20 | undefined;
    readonly signatures?: Uint8Array[] | undefined;
}
```

### Examples

```typescript
import { P2SH, P2MS, p2sh, p2ms } from '@btc-vision/bitcoin';

// Wrap a multisig in P2SH (class)
const multisig = P2MS.fromPubkeys(2, [pubkey1, pubkey2, pubkey3]);
const p2shPayment = P2SH.fromRedeem({ output: multisig.output });
console.log(p2shPayment.address); // 3... address
console.log(p2shPayment.hash);    // 20-byte script hash

// Decode an existing P2SH output
const decoded = P2SH.fromOutput(scriptPubKey);
console.log(decoded.hash); // 20-byte script hash

// Create from address
const fromAddr = P2SH.fromAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy');

// Legacy factory function
const msig = p2ms({ m: 2, pubkeys: [pk1, pk2, pk3] });
const legacy = p2sh({ redeem: msig });
```

---

## P2MS (Pay-to-Multisig)

P2MS is a bare multisig script where M-of-N signatures are required to spend the output. The public keys are embedded directly in the output script. P2MS has no address format and is typically wrapped in P2SH or P2WSH.

### Overview

| Property | Value |
|----------|-------|
| SegWit version | N/A (legacy) |
| Address format | None |
| Max N | 16 |
| BIP | 11 |

### Script Structure

```
Output:   OP_{m} {pubKey1} {pubKey2} ... {pubKeyN} OP_{n} OP_CHECKMULTISIG
Input:    OP_0 {sig1} {sig2} ... {sigM}
Witness:  [] (empty)
```

### Dynamic Name

The `name` getter returns a dynamic string including the M-of-N parameters:
- `'p2ms'` when M and N are unknown
- `'p2ms(2 of 3)'` when M=2, N=3

### Class: P2MS

```typescript
class P2MS {
    static readonly NAME = 'p2ms';

    constructor(params: {
        m?: number;
        n?: number;
        pubkeys?: Uint8Array[];
        signatures?: Uint8Array[];
        output?: Uint8Array;
        input?: Uint8Array;
        network?: Network;
    }, opts?: PaymentOpts);

    // Getters
    get name(): string;          // Dynamic: 'p2ms' or 'p2ms(M of N)'
    get network(): Network;
    get m(): number | undefined;
    get n(): number | undefined;
    get pubkeys(): PublicKey[] | undefined;
    get signatures(): Signature[] | undefined;
    get output(): Script | undefined;
    get input(): Script | undefined;
    get witness(): Uint8Array[] | undefined;

    // Static factory methods
    static fromPubkeys(m: number, pubkeys: PublicKey[], network?: Network): P2MS;
    static fromOutput(output: Uint8Array, network?: Network): P2MS;
    static fromSignatures(
        signatures: Signature[],
        m?: number,
        pubkeys?: PublicKey[],
        network?: Network,
    ): P2MS;

    toPayment(): P2MSPayment;
}
```

### Factory Function

```typescript
function p2ms(a: Omit<P2MSPayment, 'name'>, opts?: PaymentOpts): P2MSPayment;
```

### P2MSPayment Interface

```typescript
interface P2MSPayment extends BasePayment {
    readonly name: string;                        // Dynamic name
    readonly m?: number | undefined;
    readonly n?: number | undefined;
    readonly pubkeys?: PublicKey[] | undefined;
    readonly signatures?: Signature[] | undefined;
}
```

### Examples

```typescript
import { P2MS, p2ms } from '@btc-vision/bitcoin';

// Create a 2-of-3 multisig (class)
const payment = P2MS.fromPubkeys(2, [pubkey1, pubkey2, pubkey3]);
console.log(payment.output);  // OP_2 {pk1} {pk2} {pk3} OP_3 OP_CHECKMULTISIG
console.log(payment.m);       // 2
console.log(payment.n);       // 3
console.log(payment.name);    // 'p2ms(2 of 3)'

// Decode an existing output
const decoded = P2MS.fromOutput(scriptPubKey);
console.log(decoded.pubkeys); // array of public keys
console.log(decoded.m);       // required signatures
console.log(decoded.n);       // total keys

// Create from signatures for spending
const spender = P2MS.fromSignatures([sig1, sig2], 2, [pk1, pk2, pk3]);
console.log(spender.input);   // OP_0 {sig1} {sig2}

// Legacy factory function
const legacy = p2ms({ m: 2, pubkeys: [pubkey1, pubkey2, pubkey3] });
```

---

## P2WPKH (Pay-to-Witness-Public-Key-Hash)

P2WPKH is the native SegWit version of P2PKH. The witness program is a 20-byte pubkey hash, and spending requires the signature and public key in the witness stack (not the scriptSig). Addresses use bech32 encoding with the `bc1q` prefix on mainnet.

### Overview

| Property | Value |
|----------|-------|
| SegWit version | 0 (`OP_0`) |
| Address format | bech32 (`bc1q...` mainnet, `tb1q...` testnet, `bcrt1q...` regtest) |
| Hash algorithm | RIPEMD160(SHA256(pubkey)) = 20 bytes |
| Script size | 22 bytes |
| BIP | 141, 143 |
| Key requirement | Compressed keys only (33 bytes) |

### Script Structure

```
Output:   OP_0 {hash160(pubkey)}
Input:    (empty)
Witness:  [{signature}, {pubkey}]
```

### Class: P2WPKH

```typescript
class P2WPKH {
    static readonly NAME = 'p2wpkh';

    constructor(params: {
        address?: string;
        hash?: Uint8Array;
        pubkey?: Uint8Array;
        signature?: Uint8Array;
        output?: Uint8Array;
        witness?: Uint8Array[];
        network?: Network;
    }, opts?: PaymentOpts);

    // Getters
    get name(): 'p2wpkh';
    get network(): Network;
    get address(): string | undefined;
    get hash(): Bytes20 | undefined;
    get pubkey(): PublicKey | undefined;
    get signature(): Signature | undefined;
    get output(): Script | undefined;
    get input(): Script | undefined;   // Always empty for native SegWit
    get witness(): Uint8Array[] | undefined;

    // Static factory methods
    static fromPubkey(pubkey: PublicKey, network?: Network): P2WPKH;
    static fromAddress(address: string, network?: Network): P2WPKH;
    static fromHash(hash: Bytes20, network?: Network): P2WPKH;
    static fromOutput(output: Uint8Array, network?: Network): P2WPKH;

    toPayment(): P2WPKHPayment;
}
```

### Factory Function

```typescript
function p2wpkh(a: Omit<P2WPKHPayment, 'name'>, opts?: PaymentOpts): P2WPKHPayment;
```

### P2WPKHPayment Interface

```typescript
interface P2WPKHPayment extends BasePayment {
    readonly name: 'p2wpkh';
    readonly hash?: Bytes20 | undefined;
    readonly pubkey?: PublicKey | undefined;
    readonly signature?: Signature | undefined;
}
```

### Examples

```typescript
import { P2WPKH, p2wpkh } from '@btc-vision/bitcoin';

// Create from public key (class)
const payment = P2WPKH.fromPubkey(pubkey);
console.log(payment.address); // bc1q...
console.log(payment.hash);    // 20-byte witness program
console.log(payment.output);  // OP_0 {20-byte hash}

// Create from bech32 address
const fromAddr = P2WPKH.fromAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
console.log(fromAddr.hash);   // 20-byte witness program

// Create from hash
const fromHash = P2WPKH.fromHash(hash160);
console.log(fromHash.address);

// Legacy factory function
const legacy = p2wpkh({ pubkey });
const fromAddrLegacy = p2wpkh({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' });
```

---

## P2WSH (Pay-to-Witness-Script-Hash)

P2WSH is the native SegWit version of P2SH. The witness program is a 32-byte SHA256 hash of the redeem script, and spending requires the witness stack with the script inputs and the script itself. Addresses use bech32 encoding.

### Overview

| Property | Value |
|----------|-------|
| SegWit version | 0 (`OP_0`) |
| Address format | bech32 (`bc1q...` mainnet, `tb1q...` testnet, `bcrt1q...` regtest) |
| Hash algorithm | SHA256(redeemScript) = 32 bytes |
| Script size | 34 bytes |
| BIP | 141, 143 |
| Max script size | 3600 bytes |
| Max non-push ops | 201 |

### Script Structure

```
Output:   OP_0 {sha256(redeemScript)}
Input:    (empty)
Witness:  [{scriptSig...}, {redeemScript}]
```

### Dynamic Name

The `name` getter returns a dynamic string based on the nested redeem type:
- `'p2wsh'` when no redeem type is known
- `'p2wsh-p2pk'` when wrapping P2PK

### Class: P2WSH

```typescript
class P2WSH {
    static readonly NAME = 'p2wsh';

    constructor(params: {
        address?: string;
        hash?: Uint8Array;
        output?: Uint8Array;
        redeem?: ScriptRedeem;
        witness?: Uint8Array[];
        network?: Network;
    }, opts?: PaymentOpts);

    // Getters
    get name(): string;          // Dynamic: 'p2wsh' or 'p2wsh-{redeemName}'
    get network(): Network;
    get address(): string | undefined;
    get hash(): Bytes32 | undefined;
    get output(): Script | undefined;
    get input(): Script | undefined;   // Always empty for native SegWit
    get redeem(): ScriptRedeem | undefined;
    get witness(): Uint8Array[] | undefined;

    // Static factory methods
    static fromRedeem(redeem: ScriptRedeem, network?: Network): P2WSH;
    static fromAddress(address: string, network?: Network): P2WSH;
    static fromHash(hash: Bytes32, network?: Network): P2WSH;
    static fromOutput(output: Uint8Array, network?: Network): P2WSH;

    toPayment(): P2WSHPayment;
}
```

### Factory Function

```typescript
function p2wsh(a: Omit<P2WSHPayment, 'name'>, opts?: PaymentOpts): P2WSHPayment;
```

### P2WSHPayment Interface

```typescript
interface P2WSHPayment extends BasePayment {
    readonly name: string;                         // Dynamic name
    readonly hash?: Bytes32 | undefined;
    readonly redeem?: ScriptRedeem | undefined;
}
```

### Examples

```typescript
import { P2WSH, P2MS, p2wsh, p2ms } from '@btc-vision/bitcoin';

// Wrap a multisig in P2WSH (class)
const multisig = P2MS.fromPubkeys(2, [pubkey1, pubkey2, pubkey3]);
const p2wshPayment = P2WSH.fromRedeem({ output: multisig.output });
console.log(p2wshPayment.address); // bc1q... (62-character bech32)
console.log(p2wshPayment.hash);    // 32-byte SHA256 hash

// Decode an existing output
const decoded = P2WSH.fromOutput(scriptPubKey);
console.log(decoded.hash); // 32-byte witness program

// Create from address
const fromAddr = P2WSH.fromAddress('bc1q...');

// Legacy factory function
const msig = p2ms({ m: 2, pubkeys: [pk1, pk2, pk3] });
const legacy = p2wsh({ redeem: msig });
```

---

## P2TR (Pay-to-Taproot)

P2TR is the Taproot output type (BIP 341). It supports both key-path spending (single Schnorr signature) and script-path spending (Merkle tree of scripts). Addresses use bech32m encoding with the `bc1p` prefix on mainnet.

### Overview

| Property | Value |
|----------|-------|
| SegWit version | 1 (`OP_1`) |
| Address format | bech32m (`bc1p...` mainnet, `tb1p...` testnet, `bcrt1p...` regtest) |
| BIP | 341, 342 |
| Key type | x-only public keys (32 bytes) |
| Key-path spend | Yes |
| Script-path spend | Yes |

### Script Structure

```
Output:              OP_1 {32-byte x-only tweaked pubkey}

Key-path witness:    [{schnorr_signature}]

Script-path witness: [{script inputs...}, {script}, {control block}]
Control block:       [{version | parity}, {32-byte internal pubkey}, {merkle path...}]
                     Size: 33 + 32*m bytes (0 <= m <= 128)
```

### Class: P2TR

```typescript
class P2TR {
    static readonly NAME = 'p2tr';

    constructor(params: {
        address?: string;
        pubkey?: Uint8Array;
        internalPubkey?: Uint8Array;
        hash?: Uint8Array;
        scriptTree?: Taptree;
        signature?: Uint8Array;
        output?: Uint8Array;
        witness?: Uint8Array[];
        redeem?: ScriptRedeem;
        redeemVersion?: number;
        network?: Network;
    }, opts?: PaymentOpts);

    // Getters
    get name(): 'p2tr';
    get network(): Network;
    get address(): string | undefined;
    get pubkey(): XOnlyPublicKey | undefined;             // Tweaked output pubkey
    get internalPubkey(): XOnlyPublicKey | undefined;     // Untweaked internal pubkey
    get hash(): Bytes32 | undefined;                       // Merkle root
    get signature(): SchnorrSignature | undefined;
    get output(): Script | undefined;
    get redeem(): ScriptRedeem | undefined;
    get redeemVersion(): number;                           // Default: 0xc0
    get witness(): Uint8Array[] | undefined;

    // Static factory methods
    static fromInternalPubkey(
        internalPubkey: XOnlyPublicKey,
        scriptTree?: Taptree,
        network?: Network,
    ): P2TR;
    static fromAddress(address: string, network?: Network): P2TR;
    static fromOutput(output: Uint8Array, network?: Network): P2TR;
    static fromSignature(
        signature: SchnorrSignature,
        internalPubkey?: XOnlyPublicKey,
        network?: Network,
    ): P2TR;

    toPayment(): P2TRPayment;
}
```

### Factory Function

```typescript
function p2tr(a: Omit<P2TRPayment, 'name'>, opts?: PaymentOpts): P2TRPayment;
```

### P2TRPayment Interface

```typescript
interface P2TRPayment extends BasePayment {
    readonly name: 'p2tr';
    readonly pubkey?: XOnlyPublicKey | undefined;
    readonly internalPubkey?: XOnlyPublicKey | undefined;
    readonly hash?: Bytes32 | undefined;
    readonly scriptTree?: Taptree | undefined;
    readonly signature?: SchnorrSignature | undefined;
    readonly redeemVersion?: number | undefined;
    readonly redeem?: ScriptRedeem | undefined;
}
```

### Examples

```typescript
import { P2TR, p2tr } from '@btc-vision/bitcoin';
import * as script from '@btc-vision/bitcoin/script';

// Key-path only (no scripts)
const keyOnly = P2TR.fromInternalPubkey(internalPubkey);
console.log(keyOnly.address);  // bc1p...
console.log(keyOnly.pubkey);   // 32-byte tweaked x-only pubkey
console.log(keyOnly.output);   // OP_1 {32-byte pubkey}

// With script tree
const scriptTree = [
    { output: script1 },
    { output: script2 },
];
const withScripts = P2TR.fromInternalPubkey(internalPubkey, scriptTree);
console.log(withScripts.address);

// Script-path spending (with witness construction)
const spending = new P2TR({
    internalPubkey,
    scriptTree,
    redeem: { output: script1 },
});
console.log(spending.witness);
// [script1, controlBlock]
// controlBlock = [version | parity, internalPubkey, ...merklePath]

// Decode from address
const fromAddr = P2TR.fromAddress('bc1p...');
console.log(fromAddr.pubkey); // 32-byte x-only pubkey

// Key-path spending with signature
const signed = P2TR.fromSignature(schnorrSignature, internalPubkey);
console.log(signed.witness); // [signature]

// Legacy factory function
const legacy = p2tr({ internalPubkey });
const withTree = p2tr({ internalPubkey, scriptTree });
```

---

## P2MR (Pay-to-Merkle-Root)

P2MR is a SegWit version 2 output type (BIP 360) that commits directly to the Merkle root of a script tree, removing the quantum-vulnerable key-path spend found in P2TR. There is no internal public key or key tweaking. Addresses use bech32m encoding with the `bc1z` prefix on mainnet.

### Overview

| Property | Value |
|----------|-------|
| SegWit version | 2 (`OP_2` = `0x52`) |
| Address format | bech32m (`bc1z...` mainnet, `tb1z...` testnet, `bcrt1z...` regtest) |
| BIP | 360 |
| Key-path spend | None (quantum-safe) |
| Script-path spend | Yes |
| Witness program | 32-byte Merkle root |

### Comparison with P2TR

| Aspect | P2TR (BIP 341) | P2MR (BIP 360) |
|--------|----------------|----------------|
| SegWit version | 1 (`OP_1`) | 2 (`OP_2`) |
| Address prefix | `bc1p` | `bc1z` |
| Key-path spend | Yes | No |
| Output commitment | `tweakKey(internalPubkey, merkleRoot)` | `merkleRoot` directly |
| Control block | `33 + 32*m` bytes (includes internal pubkey) | `1 + 32*m` bytes (no internal pubkey) |
| Control byte parity bit | 0 or 1 | Always 1 |

### Script Structure

```
Output:              OP_2 {32-byte merkle root}

Script-path witness: [{script inputs...}, {script}, {control block}]
Control block:       [{version_byte | 0x01}, {merkle_path...}]
                     Size: 1 + 32*m bytes (0 <= m <= 128)
```

### Class: P2MR

```typescript
class P2MR {
    static readonly NAME = 'p2mr';

    constructor(params: {
        address?: string;
        hash?: Uint8Array;
        scriptTree?: Taptree;
        output?: Uint8Array;
        witness?: Uint8Array[];
        redeem?: ScriptRedeem;
        redeemVersion?: number;
        network?: Network;
    }, opts?: PaymentOpts);

    // Getters
    get name(): 'p2mr';
    get network(): Network;
    get address(): string | undefined;
    get hash(): Bytes32 | undefined;       // Merkle root (= witness program)
    get output(): Script | undefined;
    get redeem(): ScriptRedeem | undefined;
    get redeemVersion(): number;           // Default: 0xc0
    get witness(): Uint8Array[] | undefined;

    // Static factory methods
    static fromScriptTree(scriptTree: Taptree, network?: Network): P2MR;
    static fromAddress(address: string, network?: Network): P2MR;
    static fromOutput(output: Uint8Array, network?: Network): P2MR;
    static fromHash(hash: Bytes32, network?: Network): P2MR;

    toPayment(): P2MRPayment;
}
```

### Factory Function

```typescript
function p2mr(a: Omit<P2MRPayment, 'name'>, opts?: PaymentOpts): P2MRPayment;
```

### P2MRPayment Interface

```typescript
interface P2MRPayment extends BasePayment {
    readonly name: 'p2mr';
    readonly hash?: Bytes32 | undefined;
    readonly scriptTree?: Taptree | undefined;
    readonly redeemVersion?: number | undefined;
    readonly redeem?: ScriptRedeem | undefined;
}
```

### Examples

```typescript
import { P2MR, p2mr } from '@btc-vision/bitcoin';
import * as script from '@btc-vision/bitcoin/script';

// Create from a script tree
const scriptTree = {
    output: script.compile([script.opcodes.OP_1]),
};
const payment = P2MR.fromScriptTree(scriptTree);
console.log(payment.address); // bc1z...
console.log(payment.hash);    // 32-byte Merkle root
console.log(payment.output);  // OP_2 {32-byte hash}

// Multi-leaf tree
const multiLeaf = [
    { output: script1 },
    { output: script2 },
];
const multi = P2MR.fromScriptTree(multiLeaf);

// Create from merkle root hash
const fromHash = P2MR.fromHash(merkleRoot);
console.log(fromHash.address); // bc1z...

// Create from address
const fromAddr = P2MR.fromAddress('bc1z...');
console.log(fromAddr.hash);    // 32-byte Merkle root

// Script-path spending
const spending = new P2MR({
    scriptTree: multiLeaf,
    redeem: { output: script1 },
});
console.log(spending.witness);
// [script1, controlBlock]
// controlBlock = [version | 0x01, ...merklePath]

// Legacy factory function
const legacy = p2mr({ scriptTree });
const legacyHash = p2mr({ hash: merkleRoot });
```

### P2MR Utilities

P2MR reuses the BIP 341 Merkle tree construction but with a simplified control block. Use `rootHashFromPathP2MR` instead of `rootHashFromPath` for P2MR:

```typescript
import {
    rootHashFromPathP2MR,
    tapleafHash,
    toHashTree,
    findScriptPath,
    tapBranchHash,
    LEAF_VERSION_TAPSCRIPT,
} from '@btc-vision/bitcoin';

// Compute leaf hash
const leafHash = tapleafHash({
    output: redeemScript,
    version: LEAF_VERSION_TAPSCRIPT,
});

// Reconstruct merkle root from control block
const merkleRoot = rootHashFromPathP2MR(controlBlock, leafHash);

// Build hash tree and find path
const hashTree = toHashTree(scriptTree);
const path = findScriptPath(hashTree, leafHash);
```

---

## P2OP (Pay-to-OPNet)

P2OP is a custom witness version 16 output type for the OPNet network. The witness program contains a deployment version byte followed by a hash160.

### Overview

| Property | Value |
|----------|-------|
| SegWit version | 16 (`OP_16`) |
| Address format | bech32m (custom OPNet prefix from `network.bech32Opnet`) |
| Witness program | 2-40 bytes (`{deploymentVersion:uint8}{hash160:20-bytes}`) |

### Script Structure

```
Output:   OP_16 {program}
          program = {deploymentVersion:uint8}{hash160:20-bytes|...}
```

### Class: P2OP

```typescript
class P2OP {
    static readonly NAME = 'p2op';

    constructor(params: {
        address?: string;
        program?: Uint8Array;
        deploymentVersion?: number;
        hash160?: Uint8Array;
        output?: Uint8Array;
        network?: Network;
    }, opts?: PaymentOpts);

    // Getters
    get name(): 'p2op';
    get network(): Network;
    get address(): string | undefined;
    get program(): Uint8Array | undefined;          // Full witness program (2-40 bytes)
    get deploymentVersion(): number | undefined;     // First byte of program
    get hash160(): Bytes20 | undefined;              // Remaining bytes of program
    get output(): Uint8Array | undefined;

    // Static factory methods
    static fromProgram(program: Uint8Array, network?: Network): P2OP;
    static fromParts(deploymentVersion: number, hash160: Uint8Array, network?: Network): P2OP;
    static fromAddress(address: string, network?: Network): P2OP;
    static fromOutput(output: Uint8Array, network?: Network): P2OP;

    toPayment(): P2OPPayment;
}
```

### Factory Function

```typescript
function p2op(a: {
    address?: string;
    program?: Uint8Array;
    deploymentVersion?: number;
    hash160?: Uint8Array;
    output?: Uint8Array;
    network?: Network;
}, opts?: PaymentOpts): P2OPPayment;
```

### P2OPPayment Interface

```typescript
interface P2OPPayment extends BasePayment {
    readonly name: 'p2op';
    readonly program?: Uint8Array | undefined;
    readonly deploymentVersion?: number | undefined;
    readonly hash160?: Bytes20 | undefined;
}
```

### P2OPPaymentParams Interface

`P2OPPaymentParams` is the input type for the `p2op()` factory function. It is identical to `P2OPPayment` except that `name` is omitted and `deploymentVersion` defaults to `0` if not provided.

```typescript
interface P2OPPaymentParams extends Omit<P2OPPayment, 'name' | 'deploymentVersion'> {
    readonly deploymentVersion?: number | undefined;
}
```

### Examples

```typescript
import { P2OP, p2op } from '@btc-vision/bitcoin';

// Create from witness program
const payment = P2OP.fromProgram(programBytes);
console.log(payment.address);           // bech32m OPNet address
console.log(payment.deploymentVersion); // first byte
console.log(payment.hash160);           // remaining bytes
console.log(payment.output);            // OP_16 {program}

// Create from deployment version and hash160
const fromParts = P2OP.fromParts(0, hash160Bytes);
console.log(fromParts.address);
console.log(fromParts.program);

// Create from address
const fromAddr = P2OP.fromAddress(opnetAddress);
console.log(fromAddr.program);

// Decode from output script
const decoded = P2OP.fromOutput(scriptPubKey);
console.log(decoded.deploymentVersion);
console.log(decoded.hash160);

// Legacy factory function
const legacy = p2op({ program: programBytes });
const legacyParts = p2op({ deploymentVersion: 0, hash160: hash160Bytes });
```

---

## Embed (OP_RETURN Data)

Embed payments use OP_RETURN to store arbitrary data in the blockchain. These outputs are provably unspendable and are used for data storage, timestamping, and metadata.

### Overview

| Property | Value |
|----------|-------|
| SegWit version | N/A |
| Address format | None |
| Spendable | No (provably unspendable) |

### Script Structure

```
Output:   OP_RETURN {data1} {data2} ...
```

### Class: Embed

```typescript
class Embed {
    static readonly NAME = 'embed';

    constructor(params: {
        data?: Uint8Array[];
        output?: Uint8Array;
        network?: Network;
    }, opts?: PaymentOpts);

    // Getters
    get name(): 'embed';
    get network(): Network;
    get data(): Uint8Array[];
    get output(): Script | undefined;

    // Static factory methods
    static fromData(data: Uint8Array[], network?: Network): Embed;
    static fromOutput(output: Uint8Array, network?: Network): Embed;

    toPayment(): EmbedPayment;
}
```

### Factory Function

```typescript
function p2data(a: Omit<EmbedPayment, 'name'>, opts?: PaymentOpts): EmbedPayment;
```

### EmbedPayment Interface

```typescript
interface EmbedPayment extends BasePayment {
    readonly name: 'embed';
    readonly data: Uint8Array[];
}
```

### Examples

```typescript
import { Embed, p2data } from '@btc-vision/bitcoin';

// Create from data chunks (class)
const payment = Embed.fromData([
    new TextEncoder().encode('Hello'),
    new TextEncoder().encode('Bitcoin'),
]);
console.log(payment.output); // OP_RETURN {data1} {data2}
console.log(payment.data);   // [Uint8Array, Uint8Array]

// Decode from output script
const decoded = Embed.fromOutput(scriptPubKey);
console.log(decoded.data);   // array of data chunks

// Legacy factory function
const legacy = p2data({ data: [new TextEncoder().encode('Hello')] });
const decodedLegacy = p2data({ output: scriptPubKey });
```

---

## Detecting Payment Types

The library provides factory-based detection functions for identifying script types from output scripts. These are located in `psbtutils` and work by attempting to parse the script with each payment factory, returning `true` on success and `false` on failure.

```typescript
import {
    isP2PK,
    isP2PKH,
    isP2MS,
    isP2WPKH,
    isP2WSHScript,
    isP2SHScript,
    isP2TR,
    isP2MR,
    isP2OP,
    isP2A,
} from '@btc-vision/bitcoin';
```

### Detection Functions

| Function | Detects | Script Pattern |
|----------|---------|----------------|
| `isP2PK(script)` | P2PK | `{pubkey} OP_CHECKSIG` |
| `isP2PKH(script)` | P2PKH | `OP_DUP OP_HASH160 {20-byte} OP_EQUALVERIFY OP_CHECKSIG` |
| `isP2MS(script)` | P2MS | `OP_m {pubkeys...} OP_n OP_CHECKMULTISIG` |
| `isP2WPKH(script)` | P2WPKH | `OP_0 {20-byte}` |
| `isP2WSHScript(script)` | P2WSH | `OP_0 {32-byte}` |
| `isP2SHScript(script)` | P2SH | `OP_HASH160 {20-byte} OP_EQUAL` |
| `isP2TR(script)` | P2TR | `OP_1 {32-byte}` |
| `isP2MR(script)` | P2MR | `OP_2 {32-byte}` |
| `isP2OP(script)` | P2OP | `OP_16 {2-40 bytes}` |
| `isP2A(script)` | P2A (Anchor) | `OP_1 {0x4e73}` (exactly 4 bytes) |

### How Detection Works

Each detection function is created via `isPaymentFactory`, which wraps the corresponding legacy factory function in a try/catch:

```typescript
function isPaymentFactory(payment: PaymentFunction): (script: Uint8Array) => boolean {
    return (script: Uint8Array): boolean => {
        try {
            payment({ output: script });
            return true;
        } catch {
            return false;
        }
    };
}
```

### Example Usage

```typescript
import { isP2PKH, isP2TR, isP2MR, isP2WPKH } from '@btc-vision/bitcoin';

function classifyOutput(scriptPubKey: Uint8Array): string {
    if (isP2PKH(scriptPubKey)) return 'P2PKH';
    if (isP2WPKH(scriptPubKey)) return 'P2WPKH';
    if (isP2TR(scriptPubKey)) return 'P2TR';
    if (isP2MR(scriptPubKey)) return 'P2MR';
    return 'Unknown';
}
```

---

## Class vs. Factory Function Pattern

Every payment type exposes two APIs:

### Class API (recommended for new code)

```typescript
// Static factory methods return the class instance
const payment = P2PKH.fromPubkey(pubkey);
const address = payment.address;  // lazy-computed getter
```

### Legacy Factory Function

```typescript
// Factory functions return a plain payment object
const payment = p2pkh({ pubkey });
const address = payment.address;  // pre-computed property
```

Both APIs accept the same parameters and produce equivalent results. The class API is preferred for new code because:

1. Static factory methods are more discoverable and type-safe.
2. Getters are lazy-computed (only calculated when accessed).
3. The class instance can be extended.

The `toPayment()` method on each class converts the instance to a plain payment object, which is what the factory functions return internally.

---

## Common Patterns

### Wrapping Scripts in P2SH

```typescript
import { P2SH, P2MS, P2WPKH } from '@btc-vision/bitcoin';

// P2SH-P2MS (multisig in P2SH)
const multisig = P2MS.fromPubkeys(2, [pk1, pk2, pk3]);
const p2shMultisig = P2SH.fromRedeem({ output: multisig.output });

// P2SH-P2WPKH (wrapped SegWit)
const segwit = P2WPKH.fromPubkey(pubkey);
const p2shSegwit = P2SH.fromRedeem({ output: segwit.output });
```

### Wrapping Scripts in P2WSH

```typescript
import { P2WSH, P2MS } from '@btc-vision/bitcoin';

// P2WSH-P2MS (multisig in P2WSH)
const multisig = P2MS.fromPubkeys(2, [pk1, pk2, pk3]);
const p2wshMultisig = P2WSH.fromRedeem({ output: multisig.output });
```

### Converting Between Representations

```typescript
import { P2PKH } from '@btc-vision/bitcoin';

// Address -> Hash -> Output
const fromAddr = P2PKH.fromAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
const hash = fromAddr.hash;
const output = fromAddr.output;

// Output -> Hash -> Address
const fromOutput = P2PKH.fromOutput(scriptPubKey);
const address = fromOutput.address;

// All getters are cross-derived lazily
```

### Disabling Validation

```typescript
import { P2PKH } from '@btc-vision/bitcoin';

// Skip validation for performance
const payment = new P2PKH(
    { address: untrustedAddress },
    { validate: false },
);
```

### Allowing Incomplete Signatures

```typescript
import { P2MS } from '@btc-vision/bitcoin';

// Allow OP_0 placeholders for missing signatures
const payment = new P2MS(
    { m: 2, pubkeys: [pk1, pk2, pk3], signatures: [sig1, placeholder] },
    { allowIncomplete: true },
);
```
