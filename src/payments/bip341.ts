import * as bcrypto from '../crypto.js';
import { getEccLib } from '../ecc/context.js';
import { alloc, compare, concat, equals, varuint } from '../io/index.js';
import type { Bytes32, Tapleaf, Taptree, XOnlyPublicKey } from '../types.js';
import { isTapleaf } from '../types.js';

export const LEAF_VERSION_TAPSCRIPT = 0xc0;
export const MAX_TAPTREE_DEPTH = 128;

interface HashLeaf {
    hash: Bytes32;
}

interface HashBranch {
    hash: Bytes32;
    left: HashTree;
    right: HashTree;
}

interface TweakedPublicKey {
    parity: number;
    x: XOnlyPublicKey;
}

const isHashBranch = (ht: HashTree): ht is HashBranch => 'left' in ht && 'right' in ht;

/**
 * Binary tree representing leaf, branch, and root node hashes of a Taptree.
 * Each node contains a hash, and potentially left and right branch hashes.
 * This tree is used for 2 purposes: Providing the root hash for tweaking,
 * and calculating merkle inclusion proofs when constructing a control block.
 */
export type HashTree = HashLeaf | HashBranch;

/**
 * Calculates the root hash from a given control block and leaf hash.
 * @param controlBlock - The control block.
 * @param leafHash - The leaf hash.
 * @returns The root hash.
 * @throws {TypeError} If the control block length is less than 33.
 */
export function rootHashFromPath(controlBlock: Uint8Array, leafHash: Uint8Array): Bytes32 {
    if (controlBlock.length < 33)
        throw new TypeError(
            `The control-block length is too small. Got ${controlBlock.length}, expected min 33.`,
        );
    const m = (controlBlock.length - 33) / 32;

    let kj = leafHash;
    for (let j = 0; j < m; j++) {
        const ej = controlBlock.subarray(33 + 32 * j, 65 + 32 * j);
        if (compare(kj, ej) < 0) {
            kj = tapBranchHash(kj, ej);
        } else {
            kj = tapBranchHash(ej, kj);
        }
    }

    return kj as Bytes32;
}

/**
 * Calculates the root hash from a P2MR control block and leaf hash.
 * P2MR control blocks have no internal pubkey, so the merkle path starts at offset 1.
 * @param controlBlock - The P2MR control block: [control_byte (1)] [merkle_path (32*m)]
 * @param leafHash - The leaf hash.
 * @returns The root hash.
 * @throws {TypeError} If the control block length is less than 1.
 */
export function rootHashFromPathP2MR(controlBlock: Uint8Array, leafHash: Uint8Array): Bytes32 {
    if (controlBlock.length < 1)
        throw new TypeError(
            `The control-block length is too small. Got ${controlBlock.length}, expected min 1.`,
        );
    const m = (controlBlock.length - 1) / 32;

    let kj = leafHash;
    for (let j = 0; j < m; j++) {
        const ej = controlBlock.subarray(1 + 32 * j, 33 + 32 * j);
        if (compare(kj, ej) < 0) {
            kj = tapBranchHash(kj, ej);
        } else {
            kj = tapBranchHash(ej, kj);
        }
    }

    return kj as Bytes32;
}

/**
 * Build a hash tree of merkle nodes from the scripts binary tree.
 * @param scriptTree - the tree of scripts to pairwise hash.
 */
export function toHashTree(scriptTree: Taptree): HashTree {
    if (isTapleaf(scriptTree)) return { hash: tapleafHash(scriptTree) };

    const hashes = [toHashTree(scriptTree[0]), toHashTree(scriptTree[1])];
    hashes.sort((a, b) => compare(a.hash, b.hash));
    const left = hashes[0] as HashTree;
    const right = hashes[1] as HashTree;

    return {
        hash: tapBranchHash(left.hash, right.hash),
        left,
        right,
    };
}

/**
 * Given a HashTree, finds the path from a particular hash to the root.
 * @param node - the root of the tree
 * @param hash - the hash to search for
 * @returns - array of sibling hashes, from leaf (inclusive) to root
 * (exclusive) needed to prove inclusion of the specified hash. undefined if no
 * path is found
 */
export function findScriptPath(node: HashTree, hash: Bytes32): Bytes32[] | undefined {
    if (isHashBranch(node)) {
        const leftPath = findScriptPath(node.left, hash);
        if (leftPath !== undefined) return [...leftPath, node.right.hash];

        const rightPath = findScriptPath(node.right, hash);
        if (rightPath !== undefined) return [...rightPath, node.left.hash];
    } else if (equals(node.hash, hash)) {
        return [];
    }

    return undefined;
}

export function tapleafHash(leaf: Tapleaf): Bytes32 {
    const version = leaf.version || LEAF_VERSION_TAPSCRIPT;
    return bcrypto.taggedHash(
        'TapLeaf',
        concat([new Uint8Array([version]), serializeScript(leaf.output)]),
    );
}

export function tapTweakHash(pubKey: XOnlyPublicKey, h: Bytes32 | undefined): Bytes32 {
    return bcrypto.taggedHash('TapTweak', h ? concat([pubKey, h]) : pubKey);
}

export function tweakKey(pubKey: XOnlyPublicKey, h: Bytes32 | undefined): TweakedPublicKey | null {
    if (!(pubKey instanceof Uint8Array)) return null;
    if (pubKey.length !== 32) return null;
    if (h && h.length !== 32) return null;

    const tweakHash = tapTweakHash(pubKey, h);

    const res = getEccLib().xOnlyPointAddTweak(pubKey, tweakHash);
    if (!res || res.xOnlyPubkey === null) return null;

    return {
        parity: res.parity,
        x: new Uint8Array(res.xOnlyPubkey) as XOnlyPublicKey,
    };
}

/**
 * Computes the TapBranch tagged hash of two child hashes.
 *
 * @param a - First child hash (left branch).
 * @param b - Second child hash (right branch).
 * @returns The 32-byte TapBranch hash.
 */
export function tapBranchHash(a: Uint8Array, b: Uint8Array): Bytes32 {
    return bcrypto.taggedHash('TapBranch', concat([a, b]));
}

function serializeScript(s: Uint8Array): Uint8Array {
    const varintLen = varuint.encodingLength(s.length);
    const buffer = alloc(varintLen);
    varuint.encode(s.length, buffer);
    return concat([buffer, s]);
}
