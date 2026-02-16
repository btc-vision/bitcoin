# BIP 341 Taproot Utilities

The `bip341.ts` module provides low-level primitives for constructing and verifying Taproot (BIP 341) Merkle script trees. These utilities are shared by both P2TR (SegWit v1) and P2MR (SegWit v2) payment types. The module handles tree hashing, key tweaking, Merkle proof generation, and root reconstruction from control blocks.

## Overview

| Property | Value |
|----------|-------|
| BIP | 341 |
| Module | `src/payments/bip341.ts` |
| Leaf version constant | `LEAF_VERSION_TAPSCRIPT` = `0xc0` |
| Max tree depth | `MAX_TAPTREE_DEPTH` = `128` |
| Tagged hash prefixes | `TapLeaf`, `TapBranch`, `TapTweak` |
| Used by | P2TR (`p2tr.ts`), P2MR (`p2mr.ts`) |

---

## Constants

```typescript
import {
    LEAF_VERSION_TAPSCRIPT,
    MAX_TAPTREE_DEPTH,
} from '@btc-vision/bitcoin';
```

| Constant | Value | Description |
|----------|-------|-------------|
| `LEAF_VERSION_TAPSCRIPT` | `0xc0` (192) | Default leaf version for Tapscript leaves. Encoded in the control byte as `leaf_version \| parity_bit`. Must satisfy `(version & 0xfe) === version` (even, lowest bit reserved for parity). |
| `MAX_TAPTREE_DEPTH` | `128` | Maximum depth of a Taproot Merkle tree. The Merkle proof path length `m` must satisfy `0 <= m <= 128`. |

---

## Type Definitions

### Tapleaf

A single script leaf in the tree. Defined in `src/types.ts`.

```typescript
interface Tapleaf {
    readonly output: Uint8Array;   // compiled script bytes
    readonly version?: number;     // leaf version (defaults to LEAF_VERSION_TAPSCRIPT)
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `output` | `Uint8Array` | Yes | The compiled Bitcoin script for this leaf. |
| `version` | `number` | No | Leaf version. Defaults to `0xc0`. Must satisfy `(version & 0xfe) === version`. |

### Taptree

A recursive binary tree of script leaves. Defined in `src/types.ts`.

```typescript
type Taptree = [Taptree | Tapleaf, Taptree | Tapleaf] | Tapleaf;
```

A `Taptree` is either:
- A single `Tapleaf` (a leaf node), or
- A two-element tuple `[left, right]` where each element is itself a `Taptree` or `Tapleaf` (a branch node).

### HashTree

The hashed representation of a `Taptree`. Defined in `src/payments/bip341.ts`.

> **Note:** `HashLeaf`, `HashBranch`, and `HashTree` are **not exported from the main `@btc-vision/bitcoin` entry point**. The `HashTree` type is re-exported from `@btc-vision/bitcoin` via the payments barrel export, but `HashLeaf` and `HashBranch` are internal types. In practice, you interact with `HashTree` values returned by `toHashTree()` and passed to `findScriptPath()`.

```typescript
interface HashLeaf {
    hash: Bytes32;
}

interface HashBranch {
    hash: Bytes32;
    left: HashTree;
    right: HashTree;
}

type HashTree = HashLeaf | HashBranch;
```

A `HashTree` is produced by `toHashTree()` and consumed by `findScriptPath()`. Each node contains a 32-byte hash. Branch nodes additionally store references to their left and right children, which enables recursive path-finding for Merkle proof construction.

### TweakedPublicKey

The result of tweaking an internal public key with a Merkle root. This interface is **not exported from the main `@btc-vision/bitcoin` entry point**. It is defined internally in `src/payments/bip341.ts` and used as the return type of `tweakKey()`.

```typescript
interface TweakedPublicKey {
    parity: number;    // 0 or 1
    x: XOnlyPublicKey; // 32-byte x-only tweaked pubkey
}
```

---

## Taptree Structure

A Taptree is a binary tree where scripts live at the leaves. The tree is hashed bottom-up: each leaf is tagged-hashed individually, and each pair of siblings is combined via a branch hash. The root hash is used to tweak the internal public key (P2TR) or serves directly as the witness program (P2MR).

```
              Root Hash
             /         \
        Branch AB     Branch CD
        /      \       /      \
    Leaf A   Leaf B  Leaf C  Leaf D
```

Each leaf hash is computed as:

```
tapleafHash = TaggedHash("TapLeaf", [version_byte] || [varint(script.length)] || script)
```

Each branch hash is computed by sorting the two children lexicographically, then:

```
tapBranchHash = TaggedHash("TapBranch", sorted_left || sorted_right)
```

The lexicographic sorting ensures the tree is canonical -- swapping left and right children produces the same root hash. This means the tree structure matters only for proof length, not for commitment identity.

### Depth and Proof Cost

The depth of a leaf in the tree determines the length of its Merkle proof. A leaf at depth `d` requires `d` sibling hashes (each 32 bytes) in the control block. Frequently-used scripts should be placed closer to the root to minimize witness size.

```
Depth 0: 1 leaf   -> 0 proof hashes ->  0 bytes of Merkle path
Depth 1: 2 leaves -> 1 proof hash   -> 32 bytes of Merkle path
Depth 2: 4 leaves -> 2 proof hashes -> 64 bytes of Merkle path
Depth 3: 8 leaves -> 3 proof hashes -> 96 bytes of Merkle path
```

---

## Functions

### toHashTree()

Builds a `HashTree` from a `Taptree` by recursively hashing leaves and branches.

```typescript
function toHashTree(scriptTree: Taptree): HashTree;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `scriptTree` | `Taptree` | The binary tree of script leaves. |
| **Returns** | `HashTree` | The hashed tree with `hash`, `left`, and `right` at each branch. |

**Algorithm:**

1. If the node is a `Tapleaf`, compute its `tapleafHash` and return a `HashLeaf`.
2. If the node is a branch `[left, right]`, recursively compute `toHashTree(left)` and `toHashTree(right)`.
3. Sort the two child hashes lexicographically (byte comparison).
4. Compute `tapBranchHash(sortedLeft.hash, sortedRight.hash)`.
5. Return a `HashBranch` with the combined hash and ordered children.

```typescript
import { toHashTree, tapleafHash } from '@btc-vision/bitcoin';
import * as script from '@btc-vision/bitcoin/script';

const scriptTree = [
    { output: script.compile([script.opcodes.OP_1]) },
    { output: script.compile([script.opcodes.OP_2]) },
];

const hashTree = toHashTree(scriptTree);
console.log(hashTree.hash); // 32-byte Merkle root
```

---

### tapleafHash()

Computes the tagged hash of a single script leaf.

```typescript
function tapleafHash(leaf: Tapleaf): Bytes32;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `leaf` | `Tapleaf` | Object with `output` (script bytes) and optional `version`. |
| **Returns** | `Bytes32` | 32-byte `TapLeaf` tagged hash. |

**Computation:**

```
TaggedHash("TapLeaf", [version] || [compact_size(script.length)] || script)
```

Where `version` defaults to `LEAF_VERSION_TAPSCRIPT` (`0xc0`) if not specified on the leaf.

```typescript
import { tapleafHash, LEAF_VERSION_TAPSCRIPT } from '@btc-vision/bitcoin';

const leaf = {
    output: redeemScript,
    version: LEAF_VERSION_TAPSCRIPT,
};

const hash = tapleafHash(leaf);
// hash is a 32-byte Bytes32
```

---

### tapBranchHash()

Computes the tagged hash of two child hashes (a branch node).

```typescript
function tapBranchHash(a: Uint8Array, b: Uint8Array): Bytes32;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `a` | `Uint8Array` | First child hash (left branch). |
| `b` | `Uint8Array` | Second child hash (right branch). |
| **Returns** | `Bytes32` | 32-byte `TapBranch` tagged hash. |

**Computation:**

```
TaggedHash("TapBranch", a || b)
```

Note: The caller is responsible for passing `a` and `b` in the correct (sorted) order. The `toHashTree()` function handles sorting automatically, but if you call `tapBranchHash` directly, you must sort the inputs lexicographically yourself.

```typescript
import { tapBranchHash, tapleafHash } from '@btc-vision/bitcoin';

const hashA = tapleafHash({ output: scriptA });
const hashB = tapleafHash({ output: scriptB });

// Sort before hashing (compare returns < 0 if hashA < hashB)
const branch = (compare(hashA, hashB) < 0)
    ? tapBranchHash(hashA, hashB)
    : tapBranchHash(hashB, hashA);
```

---

### tapTweakHash()

Computes the tweak hash used to derive the output public key from an internal key.

```typescript
function tapTweakHash(pubKey: XOnlyPublicKey, h: Bytes32 | undefined): Bytes32;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `pubKey` | `XOnlyPublicKey` | 32-byte x-only internal public key. |
| `h` | `Bytes32 \| undefined` | Merkle root hash, or `undefined` for key-path-only (no script tree). |
| **Returns** | `Bytes32` | 32-byte `TapTweak` tagged hash. |

**Computation:**

```
If h is defined:   TaggedHash("TapTweak", pubKey || h)
If h is undefined: TaggedHash("TapTweak", pubKey)
```

When no script tree is present, the tweak commits only to the internal public key. This is the key-path-only case for P2TR.

---

### tweakKey()

Tweaks an internal x-only public key with an optional Merkle root to produce the output public key.

```typescript
function tweakKey(
    pubKey: XOnlyPublicKey,
    h: Bytes32 | undefined,
): TweakedPublicKey | null;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `pubKey` | `XOnlyPublicKey` | 32-byte x-only internal public key. |
| `h` | `Bytes32 \| undefined` | Merkle root hash, or `undefined` for key-path-only. |
| **Returns** | `TweakedPublicKey \| null` | The tweaked public key and parity, or `null` on failure. |

**Algorithm:**

1. Validate that `pubKey` is a 32-byte `Uint8Array`.
2. If `h` is provided, validate it is 32 bytes.
3. Compute `tweakHash = tapTweakHash(pubKey, h)`.
4. Call the ECC library's `xOnlyPointAddTweak(pubKey, tweakHash)`.
5. Return `{ parity, x }` where `x` is the new x-only output key.

The parity bit is encoded in the control block's first byte (lowest bit) so the verifier can reconstruct the full point.

```typescript
import { tweakKey, toHashTree } from '@btc-vision/bitcoin';
import type { XOnlyPublicKey } from '@btc-vision/bitcoin';

const hashTree = toHashTree(scriptTree);
const tweaked = tweakKey(internalPubkey, hashTree.hash);

if (tweaked) {
    console.log(tweaked.x);      // 32-byte output pubkey
    console.log(tweaked.parity); // 0 or 1
}
```

---

### rootHashFromPath()

Reconstructs the Merkle root from a **P2TR** control block and a leaf hash by walking up the Merkle proof path.

```typescript
function rootHashFromPath(
    controlBlock: Uint8Array,
    leafHash: Uint8Array,
): Bytes32;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `controlBlock` | `Uint8Array` | The P2TR control block (minimum 33 bytes). |
| `leafHash` | `Uint8Array` | The leaf hash being verified. |
| **Returns** | `Bytes32` | The reconstructed 32-byte Merkle root. |
| **Throws** | `TypeError` | If `controlBlock.length < 33`. |

**P2TR control block layout:**

```
[control_byte (1)] [internal_pubkey (32)] [merkle_path (32 * m)]
```

The Merkle path starts at byte offset 33. For each 32-byte sibling hash `ej` in the path, the function computes:

```
if kj < ej:  kj = tapBranchHash(kj, ej)
else:        kj = tapBranchHash(ej, kj)
```

Where `kj` starts as `leafHash` and ends as the Merkle root after processing all `m` sibling hashes.

```typescript
import { rootHashFromPath, tapleafHash } from '@btc-vision/bitcoin';

const leafHash = tapleafHash({ output: redeemScript });
const merkleRoot = rootHashFromPath(controlBlock, leafHash);
```

---

### rootHashFromPathP2MR()

Reconstructs the Merkle root from a **P2MR** control block and a leaf hash. P2MR control blocks have no internal public key, so the Merkle path starts at byte offset 1 instead of 33.

```typescript
function rootHashFromPathP2MR(
    controlBlock: Uint8Array,
    leafHash: Uint8Array,
): Bytes32;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `controlBlock` | `Uint8Array` | The P2MR control block (minimum 1 byte). |
| `leafHash` | `Uint8Array` | The leaf hash being verified. |
| **Returns** | `Bytes32` | The reconstructed 32-byte Merkle root. |
| **Throws** | `TypeError` | If `controlBlock.length < 1`. |

**P2MR control block layout:**

```
[control_byte (1)] [merkle_path (32 * m)]
```

The algorithm is identical to `rootHashFromPath`, except the path extraction starts at offset 1 instead of 33, and `m = (controlBlock.length - 1) / 32`.

```typescript
import { rootHashFromPathP2MR, tapleafHash } from '@btc-vision/bitcoin';

const leafHash = tapleafHash({ output: redeemScript });
const merkleRoot = rootHashFromPathP2MR(controlBlock, leafHash);
```

---

### findScriptPath()

Finds the Merkle proof path for a specific leaf hash within a `HashTree`. Returns the array of sibling hashes needed to prove inclusion of the leaf in the tree.

```typescript
function findScriptPath(
    node: HashTree,
    hash: Bytes32,
): Bytes32[] | undefined;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `node` | `HashTree` | The root of the hash tree (from `toHashTree()`). |
| `hash` | `Bytes32` | The leaf hash to search for. |
| **Returns** | `Bytes32[] \| undefined` | Array of sibling hashes from leaf to root, or `undefined` if not found. |

**Algorithm:**

1. If `node` is a branch, recursively search the left subtree.
2. If found on the left, append the right sibling's hash and return.
3. Otherwise, recursively search the right subtree.
4. If found on the right, append the left sibling's hash and return.
5. If `node` is a leaf and its hash matches, return an empty array `[]`.
6. If no match is found anywhere, return `undefined`.

The returned array of sibling hashes is ordered from leaf level (index 0) to just below the root (last index). This is the Merkle path that goes into the control block.

```typescript
import { toHashTree, findScriptPath, tapleafHash } from '@btc-vision/bitcoin';

const hashTree = toHashTree(scriptTree);
const leafHash = tapleafHash({ output: targetScript });

const path = findScriptPath(hashTree, leafHash);
if (path) {
    console.log(`Proof length: ${path.length} hashes (${path.length * 32} bytes)`);
    // path[0] = sibling at leaf level
    // path[path.length - 1] = sibling just below root
}
```

---

## Differences Between P2TR and P2MR Control Block Handling

Both P2TR and P2MR use the same Merkle tree construction (`toHashTree`, `tapleafHash`, `tapBranchHash`, `findScriptPath`). The difference lies in how the control block is structured and how the root hash is used.

| Aspect | P2TR (BIP 341) | P2MR (BIP 360) |
|--------|----------------|----------------|
| SegWit version | 1 (`OP_1`) | 2 (`OP_2`) |
| Control block minimum size | 33 bytes | 1 byte |
| Control block layout | `[ctrl_byte] [internal_pubkey (32)] [path...]` | `[ctrl_byte] [path...]` |
| Total control block size | `33 + 32*m` bytes | `1 + 32*m` bytes |
| Internal pubkey in control block | Yes (bytes 1-32) | No |
| Root hash function | `rootHashFromPath()` | `rootHashFromPathP2MR()` |
| Merkle path offset | Byte 33 | Byte 1 |
| Key-path spend | Yes (single Schnorr signature) | No |
| Output commitment | `tweakKey(internalPubkey, merkleRoot).x` | `merkleRoot` directly |
| Control byte parity bit | 0 or 1 (from tweaked key parity) | Always 1 |
| Address prefix | `bc1p` | `bc1z` |

### Why the Difference?

P2TR embeds the internal public key in the control block so the verifier can:
1. Extract the internal pubkey from the control block.
2. Reconstruct the Merkle root from the leaf hash and proof path.
3. Tweak the internal pubkey with the root to derive the expected output pubkey.
4. Compare against the output pubkey in the scriptPubKey.

P2MR eliminates the internal pubkey entirely. The output IS the Merkle root, so the verifier only needs to:
1. Reconstruct the Merkle root from the leaf hash and proof path.
2. Compare directly against the witness program in the scriptPubKey.

This removal of the key-path spend eliminates the quantum-vulnerable elliptic curve operation from the spending path.

---

## Step-by-Step Example: Building a Script Tree

This example walks through building a 3-leaf script tree, computing all hashes, constructing the control block, and spending via the script path.

### 1. Define the Script Tree

```typescript
import {
    toHashTree,
    findScriptPath,
    tapleafHash,
    tapBranchHash,
    tweakKey,
    LEAF_VERSION_TAPSCRIPT,
} from '@btc-vision/bitcoin';
import * as script from '@btc-vision/bitcoin/script';
import type { Taptree, XOnlyPublicKey } from '@btc-vision/bitcoin';
import { concat } from '@btc-vision/bitcoin';

// Three scripts: a checksig, a timelock, and a hash preimage check
const scriptA = script.fromASM('<pubkeyA> OP_CHECKSIG');
const scriptB = script.fromASM('OP_10 OP_CHECKSEQUENCEVERIFY OP_DROP <pubkeyB> OP_CHECKSIG');
const scriptC = script.fromASM('OP_SHA256 <hash> OP_EQUAL');

// Arrange as a binary tree:
//        root
//       /    \
//    branch   leafC
//    /    \
// leafA  leafB

const scriptTree: Taptree = [
    [
        { output: scriptA },
        { output: scriptB },
    ],
    { output: scriptC },
];
```

### 2. Build the Hash Tree

```typescript
const hashTree = toHashTree(scriptTree);

// Individual leaf hashes
const hashA = tapleafHash({ output: scriptA });
const hashB = tapleafHash({ output: scriptB });
const hashC = tapleafHash({ output: scriptC });

// hashTree.hash is the Merkle root
console.log(hashTree.hash); // 32-byte root hash
```

The tree structure after hashing (children sorted lexicographically):

```
                hashTree.hash
               /              \
    tapBranchHash(hashA, hashB)   hashC
         /           \
      hashA        hashB
```

### 3. Find a Merkle Proof Path

```typescript
// Find the proof path for scriptB
const leafHashB = tapleafHash({ output: scriptB });
const pathB = findScriptPath(hashTree, leafHashB);

if (pathB) {
    // pathB = [hashA, hashC]
    //   pathB[0] = sibling of leafB at depth 2 (which is hashA)
    //   pathB[1] = sibling of the branch at depth 1 (which is hashC)
    console.log(`Path length: ${pathB.length}`); // 2
}
```

### 4. Construct the P2TR Control Block

```typescript
// Tweak the internal pubkey with the Merkle root
const internalPubkey: XOnlyPublicKey = /* 32-byte x-only key */;
const tweaked = tweakKey(internalPubkey, hashTree.hash);

if (tweaked && pathB) {
    const controlByte = LEAF_VERSION_TAPSCRIPT | tweaked.parity; // 0xc0 | parity
    const controlBlock = concat([
        new Uint8Array([controlByte]),
        internalPubkey,          // 32 bytes
        ...pathB,                // 32 bytes per sibling
    ]);
    // controlBlock length = 1 + 32 + (2 * 32) = 97 bytes

    // The witness for spending via scriptB:
    const witness = [
        /* scriptB inputs (e.g., signature) */,
        scriptB,       // the script being executed
        controlBlock,  // Merkle proof + internal pubkey
    ];
}
```

### 5. Construct the P2MR Control Block

For P2MR, there is no internal pubkey in the control block, and the Merkle root is the witness program directly.

```typescript
if (pathB) {
    const controlByte = LEAF_VERSION_TAPSCRIPT | 0x01; // parity always 1 for P2MR
    const controlBlock = concat([
        new Uint8Array([controlByte]),
        ...pathB,                // 32 bytes per sibling (no internal pubkey)
    ]);
    // controlBlock length = 1 + (2 * 32) = 65 bytes

    // The witness for spending via scriptB:
    const witness = [
        /* scriptB inputs (e.g., signature) */,
        scriptB,       // the script being executed
        controlBlock,  // Merkle proof only
    ];
}
```

### 6. Verify: Reconstruct the Root from the Control Block

```typescript
import { rootHashFromPath, rootHashFromPathP2MR } from '@btc-vision/bitcoin';

// P2TR verification
const reconstructedRootP2TR = rootHashFromPath(p2trControlBlock, leafHashB);
// Then: tweakKey(extractedInternalPubkey, reconstructedRootP2TR) must equal the output pubkey

// P2MR verification
const reconstructedRootP2MR = rootHashFromPathP2MR(p2mrControlBlock, leafHashB);
// Then: reconstructedRootP2MR must equal the witness program directly
```

---

## Tagged Hash Reference

All hashing in BIP 341 uses tagged hashes as defined in BIP 340. A tagged hash is:

```
TaggedHash(tag, msg) = SHA256(SHA256(tag) || SHA256(tag) || msg)
```

The `SHA256(tag) || SHA256(tag)` prefix is precomputed for each known tag.

| Tag | Used By | Input |
|-----|---------|-------|
| `TapLeaf` | `tapleafHash()` | `[version_byte] \|\| [compact_size(script.length)] \|\| script` |
| `TapBranch` | `tapBranchHash()` | `left_hash \|\| right_hash` (sorted) |
| `TapTweak` | `tapTweakHash()` | `internal_pubkey \|\| merkle_root` (or just `internal_pubkey`) |

---

## Type Guard Functions

The `types.ts` module provides type guards for runtime validation of tree structures.

> **Note:** `isTapleaf` and `isTaptree` are **not re-exported from the main `@btc-vision/bitcoin` entry point**. Import them from the subpath:
>
> ```typescript
> import { isTapleaf, isTaptree } from '@btc-vision/bitcoin/types';
> ```

### isTapleaf()

```typescript
function isTapleaf(value: unknown): value is Tapleaf;
```

Returns `true` if `value` is an object with an `output` property that is a `Uint8Array`, and an optional `version` that satisfies `(version & 0xfe) === version`.

### isTaptree()

```typescript
function isTaptree(value: unknown): value is Taptree;
```

Returns `true` if `value` is either a valid `Tapleaf` or a two-element array where both elements are valid `Taptree` nodes. This check is recursive.

---

## API Summary

| Function | Input | Output | Description |
|----------|-------|--------|-------------|
| `toHashTree(scriptTree)` | `Taptree` | `HashTree` | Builds the full hashed Merkle tree. |
| `tapleafHash(leaf)` | `Tapleaf` | `Bytes32` | Computes a single leaf hash. |
| `tapBranchHash(a, b)` | Two `Uint8Array` | `Bytes32` | Computes a branch hash from two children. |
| `tapTweakHash(pubKey, h)` | `XOnlyPublicKey`, `Bytes32?` | `Bytes32` | Computes the tweak scalar. |
| `tweakKey(pubKey, h)` | `XOnlyPublicKey`, `Bytes32?` | `TweakedPublicKey \| null` | Tweaks the internal key to get the output key. |
| `rootHashFromPath(cb, leaf)` | P2TR control block, leaf hash | `Bytes32` | Reconstructs root from P2TR control block. |
| `rootHashFromPathP2MR(cb, leaf)` | P2MR control block, leaf hash | `Bytes32` | Reconstructs root from P2MR control block. |
| `findScriptPath(node, hash)` | `HashTree`, `Bytes32` | `Bytes32[] \| undefined` | Finds the Merkle proof path for a leaf. |
| `isTapleaf(value)` | `unknown` | `boolean` | Type guard for `Tapleaf`. |
| `isTaptree(value)` | `unknown` | `boolean` | Type guard for `Taptree`. |
