# PSBT (Partially Signed Bitcoin Transaction) - BIP 174

PSBT is a standardized binary format for unsigned and partially signed Bitcoin transactions. It allows multiple participants (wallets, hardware signers, coordinators) to collaboratively construct, sign, and finalize a transaction without requiring direct access to each other's private keys. This library implements BIP 174 with extensions for BIP 371 (Taproot).

## Overview

| Property | Value |
|----------|-------|
| BIP | 174 (base), 371 (Taproot extensions) |
| Format | Binary with base64/hex serialization |
| Module entry | `src/psbt.ts` |
| Internal modules | `PsbtCache`, `PsbtSigner`, `PsbtFinalizer`, `PsbtTransaction` |
| Supported script types | P2PKH, P2WPKH, P2SH, P2WSH, P2SH-P2WSH, P2TR, P2MR, P2MS, P2PK, P2OP, P2A |

### BIP 174 Roles

The PSBT specification defines six roles that the `Psbt` class fulfills:

| Role | Description | Methods |
|------|-------------|---------|
| **Creator** | Creates a new empty PSBT | `new Psbt()` |
| **Updater** | Adds inputs, outputs, and metadata | `addInput()`, `addOutput()`, `updateInput()`, `updateOutput()`, `updateGlobal()` |
| **Signer** | Signs inputs with private keys | `signInput()`, `signAllInputs()`, `signInputAsync()`, `signAllInputsAsync()` |
| **Combiner** | Merges multiple PSBTs for the same transaction | `combine()` |
| **Input Finalizer** | Constructs final scriptSigs and witnesses | `finalizeInput()`, `finalizeAllInputs()` |
| **Transaction Extractor** | Produces the final signed transaction | `extractTransaction()` |

---

## Installation

```typescript
import {
    Psbt,
    // Types
    type PsbtOpts,
    type PsbtOptsOptional,
    type PsbtInputExtended,
    type PsbtOutputExtended,
    type Signer,
    type SignerAsync,
    type HDSigner,
    type HDSignerAsync,
    type ValidateSigFunction,
    type FinalScriptsFunc,
    type FinalTaprootScriptsFunc,
    type AllScriptType,
    type PsbtTxInput,
    type PsbtTxOutput,
    // Utilities
    getFinalScripts,
    prepareFinalScripts,
    PsbtCache,
    PsbtSigner,
    PsbtFinalizer,
    PsbtTransaction,
    transactionFromBuffer,
} from '@btc-vision/bitcoin';
```

---

## Class: Psbt

### Constructor

```typescript
class Psbt {
    constructor(opts?: PsbtOptsOptional, data?: PsbtBaseExtended);
}
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `opts` | `PsbtOptsOptional` | `{}` | Configuration options (network, maximumFeeRate, version) |
| `data` | `PsbtBaseExtended` | `new PsbtBase(new PsbtTransaction())` | Pre-existing PSBT data (used internally by deserialization) |

If `opts.version` is `3`, the transaction version is set to TRUC (Topologically Restricted Until Confirmation). Otherwise, if no inputs exist, the version defaults to `2`.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `inputCount` | `number` | Number of inputs in the PSBT |
| `version` | `number` | Transaction version (get/set) |
| `locktime` | `number` | Transaction locktime (get/set) |
| `txInputs` | `PsbtTxInput[]` | Read-only cloned array of transaction inputs |
| `txOutputs` | `PsbtTxOutput[]` | Read-only cloned array of transaction outputs with decoded addresses |
| `maximumFeeRate` | `number` | Current maximum fee rate in satoshis per byte |
| `data` | `PsbtBaseExtended` | The underlying BIP 174 data structure |

### Static Deserialization Methods

```typescript
// From base64 string
static fromBase64(data: string, opts?: PsbtOptsOptional): Psbt;

// From hex string
static fromHex(data: string, opts?: PsbtOptsOptional): Psbt;

// From binary buffer
static fromBuffer(buffer: Uint8Array, opts?: PsbtOptsOptional): Psbt;
```

All deserialization methods check for duplicate inputs and detect existing signatures.

---

## Creating a PSBT

### addInput

```typescript
addInput(inputData: PsbtInputExtended, checkPartialSigs?: boolean): this;
addInputs(inputDatas: PsbtInputExtended[], checkPartialSigs?: boolean): this;
```

Adds one or more inputs to the PSBT. Each input requires at minimum a `hash` (the TXID of the previous transaction) and an `index` (the output index being spent).

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `inputData` | `PsbtInputExtended` | (required) | Input data with at least `hash` and `index` |
| `checkPartialSigs` | `boolean` | `true` | Whether to check if existing signatures prevent modification |

**PsbtInputExtended fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hash` | `string \| Bytes32` | Yes | Previous transaction hash (TXID) |
| `index` | `number` | Yes | Output index in the previous transaction |
| `sequence` | `number` | No | Input sequence number |
| `witnessUtxo` | `{ script: Script; value: bigint }` | Conditional | UTXO data for segwit inputs |
| `nonWitnessUtxo` | `Uint8Array` | Conditional | Full previous transaction for non-segwit inputs |
| `redeemScript` | `Uint8Array` | No | Redeem script for P2SH inputs |
| `witnessScript` | `Uint8Array` | No | Witness script for P2WSH inputs |
| `bip32Derivation` | `Bip32Derivation[]` | No | BIP 32 derivation paths for HD signing |
| `tapInternalKey` | `Uint8Array` | No | Taproot internal key (32 bytes, x-only) |
| `tapMerkleRoot` | `Uint8Array` | No | Taproot Merkle root |
| `tapLeafScript` | `TapLeafScript[]` | No | Taproot leaf scripts with control blocks |
| `tapBip32Derivation` | `TapBip32Derivation[]` | No | Taproot BIP 32 derivation paths |
| `sighashType` | `number` | No | Sighash type for this input |
| `isPayToAnchor` | `boolean` | No | Whether this is a Pay-to-Anchor input |

**Example:**

```typescript
const psbt = new Psbt();

// Add a segwit input
psbt.addInput({
    hash: 'abc123...', // TXID as hex string
    index: 0,
    witnessUtxo: {
        script: Buffer.from('0014...', 'hex'), // scriptPubKey
        value: 100000n, // in satoshis (bigint)
    },
});

// Add a non-segwit input
psbt.addInput({
    hash: txidBuffer, // TXID as Uint8Array (reversed)
    index: 1,
    nonWitnessUtxo: fullPreviousTxBuffer,
});
```

### addOutput

```typescript
addOutput(outputData: PsbtOutputExtended, checkPartialSigs?: boolean): this;
addOutputs(outputDatas: PsbtOutputExtended[], checkPartialSigs?: boolean): this;
```

Adds one or more outputs. Each output requires a `value` and either an `address` or a `script`.

**PsbtOutputExtended** is a union of two forms:

```typescript
// Address-based output
interface PsbtOutputExtendedAddress {
    readonly address: string;
    readonly value: Satoshi; // bigint
}

// Script-based output
interface PsbtOutputExtendedScript {
    readonly script: Script; // Uint8Array
    readonly value: Satoshi; // bigint
}
```

**Example:**

```typescript
// Output by address
psbt.addOutput({
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    value: 50000n,
});

// Output by script
psbt.addOutput({
    script: outputScript,
    value: 50000n,
});
```

---

## Signing

The PSBT class provides both synchronous and asynchronous signing methods. Async methods are useful for hardware wallets and remote signing services.

### signInput / signInputAsync

```typescript
signInput(inputIndex: number, keyPair: Signer | HDSigner, sighashTypes?: number[]): this;

signInputAsync(
    inputIndex: number,
    keyPair: Signer | SignerAsync | HDSigner | HDSignerAsync,
    sighashTypes?: number[],
): Promise<void>;
```

Signs a specific input. The method automatically detects whether the input is a Taproot input and routes to the appropriate signing logic.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `inputIndex` | `number` | (required) | Index of the input to sign |
| `keyPair` | `Signer \| HDSigner` | (required) | Key pair with signing capability |
| `sighashTypes` | `number[]` | `[SIGHASH_ALL]` | Allowed sighash types |

### signAllInputs / signAllInputsAsync

```typescript
signAllInputs(keyPair: Signer | HDSigner, sighashTypes?: number[]): this;

signAllInputsAsync(
    keyPair: Signer | SignerAsync | HDSigner | HDSignerAsync,
    sighashTypes?: number[],
): Promise<void>;
```

Attempts to sign every input with the provided key pair. Silently skips inputs that do not match the key. Throws only if no inputs were signed at all.

### signTaprootInput / signTaprootInputAsync

```typescript
signTaprootInput(
    inputIndex: number,
    keyPair: Signer | HDSigner,
    tapLeafHashToSign?: Uint8Array,
    sighashTypes?: number[],
): this;

signTaprootInputAsync(
    inputIndex: number,
    keyPair: Signer | SignerAsync | HDSigner | HDSignerAsync,
    tapLeafHash?: Uint8Array,
    sighashTypes?: number[],
): Promise<void>;
```

Explicitly signs a Taproot input. Throws if the input is not a Taproot input. The optional `tapLeafHashToSign` restricts signing to a specific tap leaf.

**Default sighash types:**
- Non-Taproot: `[Transaction.SIGHASH_ALL]`
- Taproot: `[Transaction.SIGHASH_DEFAULT]`

### HD Signing

```typescript
signInputHD(inputIndex: number, hdKeyPair: HDSigner, sighashTypes?: number[]): this;
signInputHDAsync(inputIndex: number, hdKeyPair: HDSigner | HDSignerAsync, sighashTypes?: number[]): Promise<void>;

signAllInputsHD(hdKeyPair: HDSigner, sighashTypes?: number[]): this;
signAllInputsHDAsync(hdKeyPair: HDSigner | HDSignerAsync, sighashTypes?: number[]): Promise<void>;
```

Signs using an HD key pair. The method derives child keys from `bip32Derivation` data in each input and signs with the derived keys.

**Example:**

```typescript
import { ECPairSigner, createNobleBackend } from '@btc-vision/ecpair';
import { networks } from '@btc-vision/bitcoin';

const backend = createNobleBackend();

// Synchronous signing
const keyPair = ECPairSigner.fromWIF(backend, 'L1...', networks.bitcoin);
psbt.signAllInputs(keyPair);

// Async signing (e.g., hardware wallet)
await psbt.signAllInputsAsync(hardwareWalletSigner);

// HD signing
const hdRoot = bip32.fromSeed(seed);
psbt.signAllInputsHD(hdRoot);
```

---

## Finalizing

Finalization constructs the final `scriptSig` and/or `witness` for each input from the collected partial signatures. After finalization, PSBT metadata no longer needed is cleared.

### finalizeAllInputs

```typescript
finalizeAllInputs(): this;
```

Finalizes every input. Throws if any input cannot be finalized.

### finalizeInput

```typescript
finalizeInput(
    inputIndex: number,
    finalScriptsFunc?: FinalScriptsFunc | FinalTaprootScriptsFunc,
    canRunChecks?: boolean,
): this;
```

Finalizes a specific input. Automatically detects Taproot inputs and routes to the appropriate finalizer.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `inputIndex` | `number` | (required) | Input index to finalize |
| `finalScriptsFunc` | `FinalScriptsFunc \| FinalTaprootScriptsFunc` | `getFinalScripts` or `tapScriptFinalizer` | Custom finalization function |
| `canRunChecks` | `boolean` | `true` | Whether to verify signatures can produce a valid final script |

### finalizeTaprootInput

```typescript
finalizeTaprootInput(
    inputIndex: number,
    tapLeafHashToFinalize?: Bytes32,
    finalScriptsFunc?: FinalTaprootScriptsFunc,
): this;
```

Explicitly finalizes a Taproot input. If a `tapKeySig` is present, it creates a key-path spend witness. Otherwise, it uses the `finalScriptsFunc` to construct a script-path spend.

**Example:**

```typescript
// Finalize all inputs
psbt.finalizeAllInputs();

// Finalize a specific input with custom logic
psbt.finalizeInput(0, myCustomFinalizer);

// Finalize a Taproot input for a specific leaf
psbt.finalizeTaprootInput(0, leafHash);
```

---

## getFinalScripts and prepareFinalScripts

These standalone functions handle the construction of final scripts during finalization.

### getFinalScripts

```typescript
function getFinalScripts(
    inputIndex: number,
    input: PsbtInput,
    script: Script,
    isSegwit: boolean,
    isP2SH: boolean,
    isP2WSH: boolean,
    canRunChecks?: boolean,
    solution?: Uint8Array[],
): {
    finalScriptSig: Script | undefined;
    finalScriptWitness: Uint8Array | undefined;
};
```

The default finalization function. It classifies the script, checks that enough signatures are present (via `canFinalize`), and delegates to `prepareFinalScripts`.

### prepareFinalScripts

```typescript
function prepareFinalScripts(
    script: Uint8Array,
    scriptType: string,
    partialSig: PartialSig[],
    isSegwit: boolean,
    isP2SH: boolean,
    isP2WSH: boolean,
    solution?: Uint8Array[],
): {
    finalScriptSig: Script | undefined;
    finalScriptWitness: Uint8Array | undefined;
};
```

Constructs the final `scriptSig` and/or `witness` from partial signatures. Handles P2PKH, P2PK, P2WPKH, P2MS (multisig), and nonstandard scripts. Wraps the result in P2SH or P2WSH as needed.

---

## Extracting

### extractTransaction

```typescript
extractTransaction(disableFeeCheck?: boolean, disableOutputChecks?: boolean): Transaction;
```

Extracts the final signed `Transaction` object from the PSBT.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `disableFeeCheck` | `boolean` | `false` | Skip fee rate validation |
| `disableOutputChecks` | `boolean` | `false` | Skip output amount validation; filters out inputs with partial sigs |

**Validation:**
- All inputs must be finalized (have `finalScriptSig` or `finalScriptWitness`)
- Unless `disableFeeCheck` is `true`, the fee rate must be below `maximumFeeRate`
- Unless `disableOutputChecks` is `true`, output amounts must not exceed input amounts

```typescript
const tx = psbt.extractTransaction();
const txHex = tx.toHex(); // Ready to broadcast
```

### getFeeRate / getFee

```typescript
getFeeRate(disableOutputChecks?: boolean): number; // satoshis per vbyte
getFee(disableOutputChecks?: boolean): number;     // total fee in satoshis
```

Compute the fee rate and total fee of the finalized PSBT. Both require all inputs to be finalized.

---

## Serialization

### toBuffer / toHex / toBase64

```typescript
toBuffer(): Uint8Array;
toHex(): string;
toBase64(): string;
```

Serializes the PSBT to binary, hex, or base64 format. Throws if the cache is in an unsafe state (e.g., `unsafeSignNonSegwit` was used).

### clone

```typescript
clone(): Psbt;
```

Creates a deep copy of the PSBT by serializing to buffer and deserializing.

### combine

```typescript
combine(...those: Psbt[]): this;
```

Merges other PSBTs into this one. All PSBTs must share the same unsigned transaction. The calling PSBT takes precedence on conflicts.

**Example:**

```typescript
// Serialize for transport
const base64 = psbt.toBase64();

// Deserialize
const restored = Psbt.fromBase64(base64);

// Clone
const copy = psbt.clone();

// Combine partial signatures from multiple signers
const combined = psbt1.combine(psbt2, psbt3);
```

---

## Validation

### validateSignaturesOfAllInputs

```typescript
validateSignaturesOfAllInputs(validator: ValidateSigFunction): boolean;
```

Validates signatures for every input. Returns `true` only if all inputs pass validation.

### validateSignaturesOfInput

```typescript
validateSignaturesOfInput(
    inputIndex: number,
    validator: ValidateSigFunction,
    pubkey?: PublicKey,
): boolean;
```

Validates signatures for a specific input. Optionally filters to signatures for a specific pubkey. Automatically handles both standard and Taproot inputs.

**ValidateSigFunction:**

```typescript
type ValidateSigFunction = (
    pubkey: PublicKey,
    msghash: MessageHash,
    signature: Uint8Array,
) => boolean;
```

The `msghash` is a 32-byte hash of the signing preimage. The `signature` is a 64-byte compact signature (r, s, 32 bytes each).

**Example:**

```typescript
import * as ecc from 'tiny-secp256k1';

const validator = (pubkey, msghash, signature) => {
    return ecc.verify(msghash, pubkey, signature);
};

const isValid = psbt.validateSignaturesOfAllInputs(validator);
```

### inputHasPubkey / outputHasPubkey

```typescript
inputHasPubkey(inputIndex: number, pubkey: PublicKey): boolean;
outputHasPubkey(outputIndex: number, pubkey: PublicKey): boolean;
```

Checks if a public key is referenced in the script of a specific input or output.

### inputHasHDKey / outputHasHDKey

```typescript
inputHasHDKey(inputIndex: number, root: HDSigner): boolean;
outputHasHDKey(outputIndex: number, root: HDSigner): boolean;
```

Checks if an HD key pair's derivation path is present in the BIP 32 derivation data of a specific input or output.

### getInputType

```typescript
getInputType(inputIndex: number): AllScriptType;
```

Returns the script type of a specific input as a compound string such as `'witnesspubkeyhash'`, `'p2sh-witnesspubkeyhash'`, `'p2wsh-multisig'`, `'p2sh-p2wsh-pubkeyhash'`, etc.

---

## Updating

### updateInput / updateOutput / updateGlobal

```typescript
updateInput(inputIndex: number, updateData: PsbtInputUpdate): this;
updateOutput(outputIndex: number, updateData: PsbtOutputUpdate): this;
updateGlobal(updateData: PsbtGlobalUpdate): this;
```

Updates metadata on existing inputs, outputs, or global fields. Validates Taproot fields to prevent mixing Taproot and non-Taproot data.

### setVersion / setLocktime / setInputSequence

```typescript
setVersion(version: number): this;
setVersionTRUC(): this;                               // Sets version to TRUC (v3)
setLocktime(locktime: number): this;
setInputSequence(inputIndex: number, sequence: number): this;
setMaximumFeeRate(satoshiPerByte: number): void;
```

All setters validate that the value is a 32-bit unsigned integer and that existing signatures permit the modification (based on sighash flags).

### addUnknownKeyVal

```typescript
addUnknownKeyValToGlobal(keyVal: KeyValue): this;
addUnknownKeyValToInput(inputIndex: number, keyVal: KeyValue): this;
addUnknownKeyValToOutput(outputIndex: number, keyVal: KeyValue): this;
```

Adds proprietary or unknown key-value pairs for custom extensions.

### clearFinalizedInput

```typescript
clearFinalizedInput(inputIndex: number): this;
```

Clears finalization data from a specific input, allowing re-finalization.

---

## Signer Interfaces

All signer interfaces are re-exported from `@btc-vision/ecpair`.

### Signer

```typescript
interface Signer {
    readonly publicKey: PublicKey;             // SEC1-encoded (33 or 65 bytes)
    readonly network?: Network | undefined;
    sign(hash: MessageHash, lowR?: boolean): Signature;
    signSchnorr?(hash: MessageHash): SchnorrSignature;  // Required for Taproot
}
```

### SignerAsync

```typescript
interface SignerAsync {
    readonly publicKey: PublicKey;
    readonly network?: Network | undefined;
    sign(hash: MessageHash, lowR?: boolean): Promise<Signature>;
    signSchnorr?(hash: MessageHash): Promise<SchnorrSignature>;
}
```

### HDSigner

```typescript
interface HDSigner {
    readonly publicKey: PublicKey;
    readonly fingerprint: Uint8Array;          // First 4 bytes of hash160(publicKey)
    derivePath(path: string): HDSigner;
    sign(hash: MessageHash): Uint8Array;
}
```

### HDSignerAsync

```typescript
interface HDSignerAsync {
    readonly publicKey: PublicKey;
    readonly fingerprint: Uint8Array;
    derivePath(path: string): HDSignerAsync;
    sign(hash: MessageHash): Promise<Uint8Array>;
}
```

### TaprootHashCheckSigner

A minimal signer interface used by `checkTaprootHashesForSig`. It only requires `publicKey` and optionally `signSchnorr`.

```typescript
interface TaprootHashCheckSigner {
    readonly publicKey: Uint8Array;
    signSchnorr?(hash: Uint8Array): Uint8Array | Promise<Uint8Array>;
}
```

---

## Options and Configuration

### PsbtOpts

```typescript
interface PsbtOpts {
    readonly network: Network;
    maximumFeeRate: number;  // Satoshis per byte; default 5000
}
```

### PsbtOptsOptional

```typescript
interface PsbtOptsOptional {
    readonly network?: Network | undefined;
    readonly maximumFeeRate?: number | undefined;
    readonly version?: 1 | 2 | 3 | undefined;  // 3 = TRUC version
}
```

**Default options:**

```typescript
const DEFAULT_OPTS: PsbtOpts = {
    network: bitcoin,       // mainnet
    maximumFeeRate: 5000,   // 5000 sat/vB
};
```

---

## Script Type Detection

The `psbtutils` module provides factory functions for detecting script types. Each returns a boolean.

```typescript
import {
    isP2MS,       // Pay-to-Multisig
    isP2PK,       // Pay-to-PubKey
    isP2PKH,      // Pay-to-PubKeyHash
    isP2WPKH,     // Pay-to-Witness-PubKeyHash
    isP2WSHScript,// Pay-to-Witness-ScriptHash
    isP2SHScript, // Pay-to-ScriptHash
    isP2TR,       // Pay-to-Taproot (BIP 341)
    isP2MR,       // Pay-to-Merkle-Root (BIP 360)
    isP2OP,       // Pay-to-OP_NET
    isP2A,        // Pay-to-Anchor
} from '@btc-vision/bitcoin';
```

### isP2A (Pay-to-Anchor)

P2A is detected by a fixed 4-byte pattern:

```
OP_1 (0x51) PUSH2 (0x02) 0x4e 0x73
```

### classifyScript

```typescript
function classifyScript(script: Uint8Array): ScriptType;
```

Returns one of: `'witnesspubkeyhash'`, `'pubkeyhash'`, `'multisig'`, `'pubkey'`, `'nonstandard'`.

### AllScriptType

The complete union of compound script types returned by `getInputType()`:

```typescript
type AllScriptType =
    | 'witnesspubkeyhash'
    | 'pubkeyhash'
    | 'multisig'
    | 'pubkey'
    | 'nonstandard'
    | 'p2sh-witnesspubkeyhash'
    | 'p2sh-pubkeyhash'
    | 'p2sh-multisig'
    | 'p2sh-pubkey'
    | 'p2sh-nonstandard'
    | 'p2wsh-pubkeyhash'
    | 'p2wsh-multisig'
    | 'p2wsh-pubkey'
    | 'p2wsh-nonstandard'
    | 'p2sh-p2wsh-pubkeyhash'
    | 'p2sh-p2wsh-multisig'
    | 'p2sh-p2wsh-pubkey'
    | 'p2sh-p2wsh-nonstandard';
```

---

## BIP 371 Taproot Extensions

The `bip371` module provides Taproot-specific utilities for PSBT construction and finalization.

### isTaprootInput

```typescript
function isTaprootInput(input: PsbtInput): boolean;
```

Returns `true` if the input has any Taproot-specific fields: `tapInternalKey`, `tapMerkleRoot`, `tapLeafScript`, `tapBip32Derivation`, or a P2TR or P2MR `witnessUtxo` script.

### isTaprootOutput

```typescript
function isTaprootOutput(output: PsbtOutput, script?: Uint8Array): boolean;
```

Returns `true` if the output has Taproot-specific fields: `tapInternalKey`, `tapTree`, `tapBip32Derivation`, or a P2TR or P2MR script.

### isP2MRInput

```typescript
function isP2MRInput(input: PsbtInput): boolean;
```

Returns `true` if the input specifically has a P2MR (Pay-to-Merkle-Root) `witnessUtxo` script. Unlike `isTaprootInput` which matches both P2TR and P2MR, this function only matches P2MR inputs.

### checkTaprootInputForSigs

```typescript
function checkTaprootInputForSigs(input: PsbtInput, action: string): boolean;
```

Checks whether a Taproot input has existing signatures (from `tapKeySig`, `tapScriptSig`, or `finalScriptWitness`) that would block the given action. Extracts all Taproot signatures from the input and checks each against the action using Schnorr signature decoding.

### checkTaprootHashesForSig (Psbt method)

```typescript
checkTaprootHashesForSig(
    inputIndex: number,
    input: PsbtInput,
    keyPair: Signer | SignerAsync | HDSigner | HDSignerAsync | TaprootHashCheckSigner,
    tapLeafHashToSign?: Uint8Array,
    allowedSighashTypes?: number[],
): { hash: MessageHash; leafHash?: Bytes32 }[];
```

A public method on the `Psbt` class. Validates that the key pair has a `signSchnorr` method and retrieves all Taproot hashes that need to be signed for the given input and key pair. Throws if no hashes are found for the provided key. Used internally by Taproot signing methods and can be called directly for advanced use cases.

### checkTaprootInputFields

```typescript
function checkTaprootInputFields(
    inputData: PsbtInput,
    newInputData: PsbtInput,
    action: string,
): void;
```

Validates that Taproot and non-Taproot fields are not mixed in the same input. Also verifies that any `tapLeafScript` entries belong to the tap tree (if a `tapMerkleRoot` is provided). Throws on validation failure.

### checkTaprootOutputFields

```typescript
function checkTaprootOutputFields(
    outputData: PsbtOutput,
    newOutputData: PsbtOutput,
    action: string,
): void;
```

Validates that Taproot and non-Taproot fields are not mixed in the same output. Also verifies that the `tapInternalKey` and `tapTree` produce a script pubkey matching the output script.

### serializeTaprootSignature

```typescript
function serializeTaprootSignature(sig: Uint8Array, sighashType?: number): Uint8Array;
```

Serializes a Schnorr signature with an optional sighash type byte appended. If `sighashType` is `SIGHASH_DEFAULT` (0) or undefined, no extra byte is appended (the signature is 64 bytes). Otherwise the sighash byte is appended (65 bytes).

### tapScriptFinalizer

```typescript
function tapScriptFinalizer(
    inputIndex: number,
    input: PsbtInput,
    tapLeafHashToFinalize?: Uint8Array,
): { finalScriptWitness: Uint8Array | undefined };
```

The default Taproot script-path finalizer. It:

1. Searches for a tap leaf matching `tapLeafHashToFinalize` (if provided)
2. Otherwise selects the signed tap leaf with the shortest control block (shortest Merkle proof path)
3. Sorts signatures by their public key position in the leaf script (reverse order for OP_CHECKSIGADD compatibility)
4. Constructs the witness: `[...signatures, script, controlBlock]`

### tweakInternalPubKey

```typescript
function tweakInternalPubKey(inputIndex: number, input: PsbtInput): Uint8Array;
```

Tweaks the `tapInternalKey` with the `tapMerkleRoot` to produce the output key. Used internally during Taproot signing.

### tapTreeToList / tapTreeFromList

```typescript
function tapTreeToList(tree: Taptree): TapLeaf[];
function tapTreeFromList(leaves?: TapLeaf[]): Taptree;
```

Converts between the binary `Taptree` structure and the flat `TapLeaf[]` list format (BIP 371). The list format uses depth-first search ordering for tree reconstruction.

---

## FinalScriptsFunc and FinalTaprootScriptsFunc

These function types allow custom finalization logic to be injected.

### FinalScriptsFunc

```typescript
type FinalScriptsFunc = (
    inputIndex: number,
    input: PsbtInput,
    script: Script,
    isSegwit: boolean,
    isP2SH: boolean,
    isP2WSH: boolean,
    canRunChecks: boolean,
) => {
    finalScriptSig: Script | undefined;
    finalScriptWitness: Uint8Array | undefined;
};
```

Used for non-Taproot inputs. Receives the classified script and wrapping flags. Must return either `finalScriptSig`, `finalScriptWitness`, or both.

### FinalTaprootScriptsFunc

```typescript
type FinalTaprootScriptsFunc = (
    inputIndex: number,
    input: PsbtInput,
    tapLeafHashToFinalize?: Bytes32,
) => {
    finalScriptWitness: Uint8Array | undefined;
};
```

Used for Taproot inputs. Must construct and return the `finalScriptWitness`.

---

## witnessStackToScriptWitness

```typescript
function witnessStackToScriptWitness(witness: Uint8Array[]): Uint8Array;
```

Converts a witness stack (array of `Uint8Array` items) into the serialized script witness format used in `finalScriptWitness`. The format is:

```
[varint:numItems] [varint:item1Len] [item1] [varint:item2Len] [item2] ...
```

The inverse operation is `scriptWitnessToWitnessStack`:

```typescript
function scriptWitnessToWitnessStack(buffer: Uint8Array): Uint8Array[];
```

---

## Internal Architecture

### PsbtCache

The `PsbtCache` class manages all computed and cached values for a PSBT instance.

```typescript
class PsbtCache {
    readonly nonWitnessUtxoTxCache: Transaction[];   // Cached decoded non-witness transactions
    readonly nonWitnessUtxoBufCache: Uint8Array[];   // Cached raw non-witness transaction buffers
    readonly txInCache: Record<string, number>;      // Cached transaction input lookups
    readonly tx: Transaction;
    unsafeSignNonSegwit: boolean;                    // Flag for unsafe non-segwit signing
    hasSignatures: boolean;
    fee: number | undefined;
    feeRate: number | undefined;
    extractedTx: Transaction | undefined;
    prevOuts: readonly PrevOut[] | undefined;        // Cached for Taproot signing
    signingScripts: readonly Script[] | undefined;   // Cached for Taproot signing
    values: readonly Satoshi[] | undefined;           // Cached for Taproot signing
    taprootHashCache: TaprootHashCache | undefined;  // Cached intermediate hashes

    constructor(tx: Transaction);
    invalidate(scope: 'full' | 'outputs'): void;
    addNonWitnessTxCache(input, inputIndex, txFromBuffer): void;
    getNonWitnessUtxoTx(input, inputIndex, txFromBuffer): Transaction;
    getScriptFromUtxo(inputIndex, input, txFromBuffer): Script;
    getScriptAndAmountFromUtxo(inputIndex, input, txFromBuffer): { script, value };
    computeFee(inputs, disableOutputChecks?, txFromBuffer?): number;
    computeFeeRate(inputs, disableOutputChecks?, txFromBuffer?): number;
    checkFees(opts): void;
    pubkeyInInput(pubkey, input, inputIndex, txFromBuffer): boolean;
    pubkeyInOutput(pubkey, output, outputIndex): boolean;
    redeemFromFinalScriptSig(finalScript): Uint8Array | undefined;
    redeemFromFinalWitnessScript(finalScript): Uint8Array | undefined;
    finalizeAndComputeAmounts(inputs, tx, mustFinalize, disableOutputChecks?, txFromBuffer?): { fee, feeRate };
    getScriptFromInput(inputIndex, input, txFromBuffer): GetScriptReturn;
    getPrevoutTaprootKey(inputIndex, input, txFromBuffer): XOnlyPublicKey | null;
}
```

**Cache invalidation scopes:**
- `'full'`: Clears everything including `prevOuts`, `signingScripts`, and `values` (used when inputs change)
- `'outputs'`: Clears `fee`, `feeRate`, `extractedTx`, and `taprootHashCache` (used when outputs or version/locktime change)

### PsbtSigner

The `PsbtSigner` class wraps all signing-related logic.

```typescript
class PsbtSigner {
    getHashAndSighashType(inputs, inputIndex, pubkey, sighashTypes): { hash, sighashType };
    getHashForSig(inputIndex, input, forValidate, sighashTypes?): { script, hash, sighashType };
    getTaprootHashesForSig(inputIndex, input, inputs, pubkey, tapLeafHashToSign?, allowedSighashTypes?): HashForSig[];
    getAllTaprootHashesForSig(inputIndex, input, inputs): HashForSig[];
    trimTaprootSig(signature): Uint8Array;          // Trims 65-byte sig to 64 bytes
    getSignersFromHD(inputIndex, inputs, hdKeyPair): HDSigner[];
    bip32DerivationIsMine(root): (d: Bip32Derivation) => boolean;
}
```

### PsbtFinalizer

The `PsbtFinalizer` class wraps finalization logic.

```typescript
class PsbtFinalizer {
    getFinalScripts(inputIndex, input, script, isSegwit, isP2SH, isP2WSH, canRunChecks?, solution?): FinalScriptsResult;
    getScriptFromInput(inputIndex, input): GetScriptReturn;
}
```

### PsbtTransaction

Implements the `ITransaction` interface required by the `bip174` library. Wraps a `Transaction` object.

```typescript
class PsbtTransaction {
    tx: Transaction;
    constructor(buffer?: Uint8Array);
    getInputOutputCounts(): { inputCount: number; outputCount: number };
    addInput(input: TransactionInput): void;
    addOutput(output: PsbtTxOutput): void;
    toBuffer(): Uint8Array;
}
```

When no buffer is provided, a default empty version-2 transaction is used: `[02 00 00 00] [00] [00] [00 00 00 00]`.

---

## Validation Utilities

### check32Bit

```typescript
function check32Bit(num: number): void;
```

Validates that a number is a non-negative 32-bit integer. Throws on invalid values.

### isFinalized

```typescript
function isFinalized(input: PsbtInput): boolean;
```

Returns `true` if the input has either `finalScriptSig` or `finalScriptWitness`.

### checkInputsForPartialSig

```typescript
function checkInputsForPartialSig(
    inputs: PsbtInput[],
    action: string,
    hasSignaturesCache?: boolean,
): void;
```

Checks if existing signatures would be invalidated by the specified action (e.g., `'addInput'`, `'addOutput'`, `'setVersion'`). Uses the `hasSignatures` cache flag for O(1) fast-path when no signatures exist.

Sighash-based logic:
- `SIGHASH_ANYONECANPAY`: allows `addInput`
- `SIGHASH_NONE` / `SIGHASH_SINGLE`: allows `addOutput` and `setInputSequence`
- `SIGHASH_ALL`: does not allow any modification

### checkScriptForPubkey

```typescript
function checkScriptForPubkey(pubkey: PublicKey, script: Script, action: string): void;
```

Throws if the public key is not found in the script. Used during signing to prevent signing with the wrong key.

### checkPartialSigSighashes

```typescript
function checkPartialSigSighashes(input: PsbtInput): void;
```

Validates that all partial signatures in an input have sighash types matching the input's `sighashType` field.

### checkTxForDupeIns

```typescript
function checkTxForDupeIns(tx: Transaction, cache: PsbtCache): void;
```

Checks all transaction inputs for duplicates (same TXID and output index).

### checkRedeemScript / checkWitnessScript

```typescript
const checkRedeemScript: (idx, scriptPubKey, redeemScript, ioType) => void;
const checkWitnessScript: (idx, scriptPubKey, witnessScript, ioType) => void;
```

Validate that a redeem or witness script produces the expected scriptPubKey when wrapped in P2SH or P2WSH.

---

## Utility Functions

### pubkeyPositionInScript

```typescript
function pubkeyPositionInScript(pubkey: Uint8Array, script: Uint8Array): number;
```

Finds the position of a public key in a script. Checks against the raw pubkey, its x-only form, its hash160, uncompressed form, and hybrid form. Returns `-1` if not found.

### pubkeyInScript

```typescript
function pubkeyInScript(pubkey: Uint8Array, script: Uint8Array): boolean;
```

Returns `true` if the public key is found in the script (delegates to `pubkeyPositionInScript`).

### checkInputForSig

```typescript
function checkInputForSig(input: PsbtInput, action: string): boolean;
```

Checks whether an input already has a signature that would block the given action.

### getMeaningfulScript

```typescript
function getMeaningfulScript(
    script: Uint8Array,
    index: number,
    ioType: 'input' | 'output',
    redeemScript?: Uint8Array,
    witnessScript?: Uint8Array,
): {
    meaningfulScript: Uint8Array;
    type: 'p2sh' | 'p2wsh' | 'p2sh-p2wsh' | 'raw';
};
```

Unwraps P2SH, P2WSH, and P2SH-P2WSH scripts to reveal the underlying meaningful script. Validates that redeem and witness scripts match the scriptPubKey.

### sighashTypeToString

```typescript
function sighashTypeToString(sighashType: number): string;
```

Converts a sighash type integer to a human-readable string like `'SIGHASH_ALL'`, `'SIGHASH_ANYONECANPAY | SIGHASH_SINGLE'`, etc.

### compressPubkey

```typescript
function compressPubkey(pubkey: Uint8Array): Uint8Array;
```

Compresses a 65-byte uncompressed public key to 33 bytes. Returns a copy if already compressed.

### range

```typescript
function range(n: number): number[];
```

Creates an array `[0, 1, 2, ..., n-1]`.

---

## Complete Workflow Examples

### Standard P2WPKH Transaction

```typescript
import { Psbt, networks } from '@btc-vision/bitcoin';
import { ECPairSigner, createNobleBackend } from '@btc-vision/ecpair';

const backend = createNobleBackend();

// 1. Create
const psbt = new Psbt({ network: networks.bitcoin });

// 2. Add inputs
psbt.addInput({
    hash: 'previousTxId...', // TXID hex string
    index: 0,
    witnessUtxo: {
        script: Buffer.from('0014ab68025513c3dbd2f7b92a94e0581f5d50f654e7', 'hex'),
        value: 100000n,
    },
});

// 3. Add outputs
psbt.addOutput({
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    value: 90000n,
});

// 4. Sign
const keyPair = ECPairSigner.fromWIF(backend, 'L1...', networks.bitcoin);
psbt.signAllInputs(keyPair);

// 5. Validate (recommended before finalizing)
const validator = (pubkey, msghash, signature) => {
    return keyPair.verify(msghash, signature);
};
psbt.validateSignaturesOfAllInputs(validator);

// 6. Finalize
psbt.finalizeAllInputs();

// 7. Extract
const tx = psbt.extractTransaction();
const rawTx = tx.toHex(); // Ready to broadcast
```

### Taproot Key-Path Spend

```typescript
import { Psbt } from '@btc-vision/bitcoin';

const psbt = new Psbt();

psbt.addInput({
    hash: 'previousTxId...',
    index: 0,
    witnessUtxo: {
        script: taprootOutputScript, // OP_1 <32-byte x-only pubkey>
        value: 50000n,
    },
    tapInternalKey: internalPubkeyXOnly, // 32-byte x-only public key
});

psbt.addOutput({
    address: 'bc1p...',
    value: 40000n,
});

// Sign with Schnorr-capable signer
psbt.signInput(0, taprootKeyPair); // Uses SIGHASH_DEFAULT by default
psbt.finalizeInput(0);

const tx = psbt.extractTransaction();
```

### Taproot Script-Path Spend

```typescript
import { Psbt } from '@btc-vision/bitcoin';

const psbt = new Psbt();

psbt.addInput({
    hash: 'previousTxId...',
    index: 0,
    witnessUtxo: {
        script: taprootOutputScript,
        value: 50000n,
    },
    tapInternalKey: internalPubkeyXOnly,
    tapMerkleRoot: merkleRoot,
    tapLeafScript: [
        {
            controlBlock: controlBlockBuffer,
            script: leafScriptBuffer,
            leafVersion: 0xc0, // LEAF_VERSION_TAPSCRIPT
        },
    ],
});

psbt.addOutput({
    address: 'bc1q...',
    value: 40000n,
});

// Sign the specific tap leaf
psbt.signTaprootInput(0, taprootKeyPair, leafHash);

// Finalize using the default tap script finalizer
psbt.finalizeTaprootInput(0);

const tx = psbt.extractTransaction();
```

### Multi-Party Signing (PSBT Combiner Pattern)

```typescript
import { Psbt } from '@btc-vision/bitcoin';

// Coordinator creates the PSBT
const psbt = new Psbt();
psbt.addInput({ hash: '...', index: 0, witnessUtxo: { script: p2wshScript, value: 100000n } });
psbt.addOutput({ address: 'bc1q...', value: 90000n });

// Serialize and send to signers
const psbtBase64 = psbt.toBase64();

// Signer A
const psbtA = Psbt.fromBase64(psbtBase64);
psbtA.signInput(0, signerA);

// Signer B
const psbtB = Psbt.fromBase64(psbtBase64);
psbtB.signInput(0, signerB);

// Coordinator combines
const combined = Psbt.fromBase64(psbtBase64);
combined.combine(psbtA, psbtB);

// Finalize and extract
combined.finalizeAllInputs();
const tx = combined.extractTransaction();
```

### Async Signing with Hardware Wallet

```typescript
import { Psbt } from '@btc-vision/bitcoin';

const psbt = new Psbt();
// ... add inputs and outputs ...

// Hardware wallet implements SignerAsync
const hardwareSigner: SignerAsync = {
    publicKey: hwPublicKey,
    async sign(hash) {
        // Communicate with hardware device
        return await hardwareDevice.signECDSA(hash);
    },
    async signSchnorr(hash) {
        return await hardwareDevice.signSchnorr(hash);
    },
};

await psbt.signAllInputsAsync(hardwareSigner);
psbt.finalizeAllInputs();
const tx = psbt.extractTransaction();
```

### Custom Finalization Function

```typescript
import { Psbt, type FinalScriptsFunc } from '@btc-vision/bitcoin';

const customFinalizer: FinalScriptsFunc = (
    inputIndex, input, script, isSegwit, isP2SH, isP2WSH, canRunChecks
) => {
    // Custom logic to construct final scripts
    const witness = [input.partialSig[0].signature, input.partialSig[0].pubkey];
    return {
        finalScriptSig: undefined,
        finalScriptWitness: witnessStackToScriptWitness(witness),
    };
};

psbt.finalizeInput(0, customFinalizer);
```

---

## Error Handling

Common errors thrown by the PSBT module:

| Error | Cause |
|-------|-------|
| `"Invalid arguments for Psbt.addInput"` | Missing `hash` or `index` |
| `"Invalid arguments for Psbt.addOutput"` | Missing `value` or both `address` and `script` |
| `"Can not modify transaction, signatures exist."` | Attempting to add input/output after signing with `SIGHASH_ALL` |
| `"Need Signer to sign input"` | Null or missing key pair |
| `"Need Schnorr Signer to sign taproot input"` | Signer lacks `signSchnorr` method |
| `"No inputs were signed"` | Key pair did not match any input |
| `"Not finalized"` | Calling `extractTransaction` before finalizing |
| `"Can not finalize input #N"` | Missing required signatures for the script type |
| `"Duplicate input detected."` | Same TXID:vout added twice |
| `"Warning: You are paying around X in fees..."` | Fee rate exceeds `maximumFeeRate` |
| `"Not BIP174 compliant, can not export"` | Attempting to serialize after `unsafeSignNonSegwit` |
| `"Cannot use both taproot and non-taproot fields."` | Mixing Taproot and legacy fields in the same input/output |
| `"Sighash type is not allowed."` | Input sighash type not in the allowed list |
| `"P2WPKH or P2SH can not be contained within P2WSH"` | Invalid witness script wrapping |

---

## Security Considerations

- **Always validate signatures** before finalizing with `validateSignaturesOfAllInputs()`. The finalizer constructs scripts from partial data and does not re-validate cryptographic correctness.
- **Fee rate protection**: The default `maximumFeeRate` of 5000 sat/vB prevents accidental overpayment. Adjust with `setMaximumFeeRate()` if higher rates are intentional.
- **Non-segwit signing risk**: Signing non-segwit inputs with only `witnessUtxo` (no `nonWitnessUtxo`) is unsafe because a malicious node could lie about the input amount. The library blocks this by default; the `unsafeSignNonSegwit` flag bypasses this check but prevents BIP 174 serialization.
- **Sighash type whitelisting**: Pass explicit `sighashTypes` arrays to signing methods to prevent unintended sighash usage.
- **Duplicate input detection**: The library automatically checks for duplicate inputs (same TXID and output index) to prevent double-spend construction errors.
