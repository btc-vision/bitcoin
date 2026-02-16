# P2MR (Pay-to-Merkle-Root) - BIP 360

P2MR is a SegWit version 2 output type that commits directly to the Merkle root of a script tree, removing the quantum-vulnerable key-path spend found in P2TR (Taproot). There is no internal public key or key tweaking.

## Overview

| Property | Value |
|----------|-------|
| SegWit version | 2 (`OP_2` = `0x52`) |
| Address prefix | `bc1z` (mainnet), `tb1z` (testnet), `bcrt1z` (regtest) |
| BIP | 360 |
| Bech32 encoding | bech32m |
| Witness program | 32-byte Merkle root |
| Key-path spend | None (quantum-safe) |
| Script-path spend | Yes |

### Comparison with P2TR

| Aspect | P2TR (BIP 341) | P2MR (BIP 360) |
|--------|----------------|----------------|
| SegWit version | 1 (`OP_1`) | 2 (`OP_2`) |
| Address prefix | `bc1p` | `bc1z` |
| Key-path spend | Yes | No |
| Output commitment | `tweakKey(internalPubkey, merkleRoot)` | `merkleRoot` directly |
| Control block | `33 + 32*m` bytes (includes internal pubkey) | `1 + 32*m` bytes (no internal pubkey) |
| Control byte parity bit | 0 or 1 | Always 1 |

---

## Installation

```typescript
import {
    payments,
    rootHashFromPathP2MR,
    tapBranchHash,
    toHashTree,
    tapleafHash,
    findScriptPath,
} from '@btc-vision/bitcoin';

const { P2MR, p2mr } = payments;
```

---

## Class: P2MR

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

    // Properties
    get name(): 'p2mr';
    get network(): Network;
    get address(): string | undefined;
    get hash(): Bytes32 | undefined;
    get output(): Script | undefined;
    get redeem(): ScriptRedeem | undefined;
    get redeemVersion(): number;
    get witness(): Uint8Array[] | undefined;

    // Static factory methods
    static fromScriptTree(scriptTree: Taptree, network?: Network): P2MR;
    static fromAddress(address: string, network?: Network): P2MR;
    static fromOutput(output: Uint8Array, network?: Network): P2MR;
    static fromHash(hash: Bytes32, network?: Network): P2MR;

    toPayment(): P2MRPayment;
}
```

---

## Examples

### Creating from a Script Tree

```typescript
import { P2MR } from '@btc-vision/bitcoin';
import * as script from '@btc-vision/bitcoin/script';

// Single-leaf script tree
const scriptTree = {
    output: script.compile([script.opcodes.OP_1]),
};
const payment = P2MR.fromScriptTree(scriptTree);

console.log(payment.address); // bc1z...
console.log(payment.hash);    // 32-byte Merkle root
console.log(payment.output);  // OP_2 <32-byte hash>
```

### Creating from a Multi-Leaf Script Tree

```typescript
// Two-leaf tree
const scriptTree = [
    { output: script1 },
    { output: script2 },
];
const payment = P2MR.fromScriptTree(scriptTree);

// Three-leaf tree (nested)
const deepTree = [
    [
        { output: leafA },
        { output: leafB },
    ],
    { output: leafC },
];
const deep = P2MR.fromScriptTree(deepTree);
```

### Creating from an Address

```typescript
const payment = P2MR.fromAddress('bc1z4rf73uru6qdyrv9w3nq9f3dwqlqmec4sdwj03hexu7n7r7dkehjs592djq');
console.log(payment.hash);   // 32-byte Merkle root
console.log(payment.output); // OP_2 <32-byte hash>
```

### Creating from a Merkle Root Hash

```typescript
import { toBytes32 } from '@btc-vision/bitcoin';

const merkleRoot = toBytes32(rootHashBytes);
const payment = P2MR.fromHash(merkleRoot);

console.log(payment.address); // bc1z...
console.log(payment.output);  // OP_2 <32-byte hash>
```

### Creating from an Output Script

```typescript
const payment = P2MR.fromOutput(scriptPubKey);
console.log(payment.hash);    // 32-byte Merkle root
console.log(payment.address); // bc1z...
```

### Script-Path Spending (Witness Construction)

```typescript
// Define the tree and redeem script
const scriptTree = [
    { output: redeemScript },
    { output: otherScript },
];
const payment = new P2MR({
    scriptTree,
    redeem: { output: redeemScript },
});

// The witness contains the script and control block
console.log(payment.witness);
// [redeemScript, controlBlock]
// controlBlock = [version | 0x01, ...merklePath]
```

### Legacy Factory Function

```typescript
function p2mr(
    a: Omit<P2MRPayment, 'name'>,
    opts?: PaymentOpts
): P2MRPayment;
```

At least one of `address`, `output`, `hash`, `scriptTree`, or `witness` (length > 1) must be provided, otherwise `TypeError('Not enough data')` is thrown.

`PaymentOpts` supports both `validate` (default `true`) and `allowIncomplete` (default `false`).

```typescript
import { payments } from '@btc-vision/bitcoin';
const { p2mr } = payments;

const payment = p2mr({ scriptTree });
const fromHash = p2mr({ hash: merkleRoot });
const fromAddress = p2mr({ address: 'bc1z...' });
```

---

## Script Structure

```
Output:            OP_2 <32-byte merkle root>
Script-path witness: [script inputs..., script, control block]
Control block:     [version_byte | 0x01, merkle_path_hash_1, ..., merkle_path_hash_m]
```

The control block is significantly simpler than P2TR because there is no internal public key:

| Field | Size | Description |
|-------|------|-------------|
| Control byte | 1 byte | `leaf_version \| 0x01` (parity bit always 1) |
| Merkle path | `32 * m` bytes | Sibling hashes from leaf to root |

The total control block length is `1 + 32*m` where `0 <= m <= 128`.

---

## P2MR Utilities

### rootHashFromPathP2MR

Reconstructs the Merkle root from a P2MR control block and leaf hash. Unlike `rootHashFromPath` (P2TR), the merkle path starts at offset 1 since there is no internal public key.

```typescript
import { rootHashFromPathP2MR, tapleafHash, LEAF_VERSION_TAPSCRIPT } from '@btc-vision/bitcoin';

const leafHash = tapleafHash({
    output: redeemScript,
    version: LEAF_VERSION_TAPSCRIPT,
});
const merkleRoot = rootHashFromPathP2MR(controlBlock, leafHash);
```

### tapBranchHash

Computes the `TapBranch` tagged hash of two child hashes.

```typescript
import { tapBranchHash } from '@btc-vision/bitcoin';

const branchHash = tapBranchHash(leftChild, rightChild);
```

### Shared Taproot Utilities

P2MR reuses the same Merkle tree construction as P2TR (BIP 341):

```typescript
import {
    toHashTree,
    findScriptPath,
    tapleafHash,
    LEAF_VERSION_TAPSCRIPT,
    MAX_TAPTREE_DEPTH,
} from '@btc-vision/bitcoin';

// Build hash tree from script tree
const hashTree = toHashTree(scriptTree);
console.log(hashTree.hash); // Merkle root

// Get leaf hash for a specific script
const leafHash = tapleafHash({
    output: script,
    version: LEAF_VERSION_TAPSCRIPT,
});

// Find Merkle proof path
const path = findScriptPath(hashTree, leafHash);
```

---

## Address Encoding and Decoding

P2MR addresses use bech32m encoding with witness version 2.

### Encoding (Output Script to Address)

```typescript
import { address } from '@btc-vision/bitcoin';

// fromOutputScript auto-detects P2MR scripts
const addr = address.fromOutputScript(outputScript);
// Returns bc1z... for P2MR outputs
```

### Decoding (Address to Output Script)

```typescript
import { address } from '@btc-vision/bitcoin';

// toOutputScript auto-handles bc1z... addresses
const script = address.toOutputScript('bc1z...');
// Returns OP_2 <32-byte hash>
```

### Direct Bech32m Operations

```typescript
import { fromBech32, toBech32 } from '@btc-vision/bitcoin';

// Decode
const decoded = fromBech32('bc1z...');
// decoded.version === 2
// decoded.data === 32-byte merkle root

// Encode
const encoded = toBech32(merkleRoot, 2, 'bc');
```

---

## Script Detection

```typescript
import { isP2MR } from '@btc-vision/bitcoin';

// Check if a script is a P2MR output
if (isP2MR(scriptPubKey)) {
    console.log('This is a P2MR output');
}
```

---

## Type Definitions

### P2MRPayment

```typescript
interface P2MRPayment extends BasePayment {
    readonly name: 'p2mr';
    /** Merkle root of the script tree (= witness program). */
    readonly hash?: Bytes32 | undefined;
    /** Full taptree description (optional, dev-side). */
    readonly scriptTree?: Taptree | undefined;
    readonly redeemVersion?: number | undefined;
    readonly redeem?: ScriptRedeem | undefined;
}
```

### PaymentType

```typescript
const PaymentType = {
    P2PK: 'p2pk',
    P2PKH: 'p2pkh',
    P2SH: 'p2sh',
    P2MS: 'p2ms',
    P2WPKH: 'p2wpkh',
    P2WSH: 'p2wsh',
    P2TR: 'p2tr',
    P2MR: 'p2mr',   // <-- New
    P2OP: 'p2op',
    Embed: 'embed',
} as const;
```

---

## Security Considerations

P2MR eliminates the quantum-vulnerable key-path spend by committing directly to a Merkle root without any elliptic curve operations in the output. This provides quantum resistance for the locking mechanism while maintaining the efficient script tree structure from Taproot.

Key security properties:

- **No key-path spend**: Unlike P2TR, there is no way to spend using a single signature against a tweaked public key. All spends must reveal a script from the tree.
- **Control byte parity**: The parity bit is always 1, simplifying validation.
- **Same Merkle tree security**: Uses identical `TapLeaf` and `TapBranch` tagged hash construction as BIP 341, benefiting from the same cryptographic analysis.
- **32-byte witness program**: Same length as P2TR, preventing output-based discrimination.

---

## Differences from P2TR for Developers

If you are familiar with P2TR, here are the key differences when working with P2MR:

1. **No `internalPubkey` or `pubkey`**: P2MR has no concept of an internal key. The `hash` field IS the Merkle root directly.
2. **No `signature` getter**: There is no key-path spend, so there is no signature property.
3. **Simpler control block**: No 32-byte internal pubkey in the control block. Just `[version_byte, ...merkle_path]`.
4. **Factory methods**: Use `fromScriptTree()` and `fromHash()` instead of `fromInternalPubkey()`.
5. **Address prefix**: `bc1z` instead of `bc1p`.
