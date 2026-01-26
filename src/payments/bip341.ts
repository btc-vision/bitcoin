import * as bcrypto from '../crypto.js';
import { getEccLib } from '../ecc/context.js';
import { concat, compare, equals, alloc } from '../io/index.js';
import { varuint } from '../bufferutils.js';
import { isTapleaf, Tapleaf, Taptree } from '../types.js';

export const LEAF_VERSION_TAPSCRIPT = 0xc0;
export const MAX_TAPTREE_DEPTH = 128;

interface HashLeaf {
    hash: Uint8Array;
}

interface HashBranch {
    hash: Uint8Array;
    left: HashTree;
    right: HashTree;
}

interface TweakedPublicKey {
    parity: number;
    x: Uint8Array;
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
export function rootHashFromPath(controlBlock: Uint8Array, leafHash: Uint8Array): Uint8Array {
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

    return kj;
}

/**
 * Build a hash tree of merkle nodes from the scripts binary tree.
 * @param scriptTree - the tree of scripts to pairwise hash.
 */
export function toHashTree(scriptTree: Taptree): HashTree {
    if (isTapleaf(scriptTree)) return { hash: tapleafHash(scriptTree) };

    const hashes = [toHashTree(scriptTree[0]), toHashTree(scriptTree[1])];
    hashes.sort((a, b) => compare(a.hash, b.hash));
    const [left, right] = hashes;

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
export function findScriptPath(node: HashTree, hash: Uint8Array): Uint8Array[] | undefined {
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

export function tapleafHash(leaf: Tapleaf): Uint8Array {
    const version = leaf.version || LEAF_VERSION_TAPSCRIPT;
    return bcrypto.taggedHash(
        'TapLeaf',
        concat([new Uint8Array([version]), serializeScript(leaf.output)]),
    );
}

export function tapTweakHash(pubKey: Uint8Array, h: Uint8Array | undefined): Uint8Array {
    return bcrypto.taggedHash('TapTweak', h ? concat([pubKey, h]) : pubKey);
}

export function tweakKey(pubKey: Uint8Array, h: Uint8Array | undefined): TweakedPublicKey | null {
    if (!(pubKey instanceof Uint8Array)) return null;
    if (pubKey.length !== 32) return null;
    if (h && h.length !== 32) return null;

    const tweakHash = tapTweakHash(pubKey, h);

    const res = getEccLib().xOnlyPointAddTweak(pubKey, tweakHash);
    if (!res || res.xOnlyPubkey === null) return null;

    return {
        parity: res.parity,
        x: new Uint8Array(res.xOnlyPubkey),
    };
}

function tapBranchHash(a: Uint8Array, b: Uint8Array): Uint8Array {
    return bcrypto.taggedHash('TapBranch', concat([a, b]));
}

function serializeScript(s: Uint8Array): Uint8Array {
    const varintLen = varuint.encodingLength(s.length);
    const buffer = alloc(varintLen);
    varuint.encode(s.length, buffer);
    return concat([buffer, s]);
}
