import type {
    PsbtInput,
    PsbtOutput,
    TapInternalKey,
    TapLeaf,
    TapLeafScript,
    TapScriptSig,
    TapTree,
} from 'bip174';
import {
    LEAF_VERSION_TAPSCRIPT,
    MAX_TAPTREE_DEPTH,
    rootHashFromPath,
    rootHashFromPathP2MR,
    tapleafHash,
    tweakKey,
} from '../payments/bip341.js';
import { p2tr } from '../payments/p2tr.js';
import { Transaction } from '../transaction.js';
import type { Bytes32, Tapleaf, Taptree, XOnlyPublicKey } from '../types.js';
import { isTapleaf, isTaptree } from '../types.js';
import { concat, equals } from '../io/index.js';
import {
    isP2MR,
    isP2TR,
    pubkeyPositionInScript,
    signatureBlocksAction,
    witnessStackToScriptWitness,
} from './psbtutils.js';

interface PsbtOutputWithScript extends PsbtOutput {
    script?: Uint8Array;
}

/**
 * Default tapscript finalizer. It searches for the `tapLeafHashToFinalize` if provided.
 * Otherwise it will search for the tapleaf that has at least one signature and has the shortest path.
 * @param inputIndex the position of the PSBT input.
 * @param input the PSBT input.
 * @param tapLeafHashToFinalize optional, if provided the finalizer will search for a tapleaf that has this hash
 *                              and will try to build the finalScriptWitness.
 * @returns the finalScriptWitness or throws an exception if no tapleaf found.
 */
export function tapScriptFinalizer(
    inputIndex: number,
    input: PsbtInput,
    tapLeafHashToFinalize?: Uint8Array,
): {
    finalScriptWitness: Uint8Array | undefined;
} {
    const tapLeaf = findTapLeafToFinalize(input, inputIndex, tapLeafHashToFinalize);

    try {
        const sigs = sortSignatures(input, tapLeaf);
        const witness = sigs
            .concat(new Uint8Array(tapLeaf.script))
            .concat(new Uint8Array(tapLeaf.controlBlock));
        return { finalScriptWitness: witnessStackToScriptWitness(witness) };
    } catch (err) {
        throw new Error(`Can not finalize taproot input #${inputIndex}: ${err}`, { cause: err });
    }
}

/**
 * Serializes a taproot (Schnorr) signature, optionally appending the sighash type byte.
 * If sighashType is SIGHASH_DEFAULT (0x00) or not provided, no byte is appended (per BIP 341).
 * Used for both P2TR key-path/script-path and P2MR script-path signatures.
 * @param sig - The 64-byte Schnorr signature.
 * @param sighashType - Optional sighash type. Omit or pass 0 for SIGHASH_DEFAULT.
 * @returns The serialized signature (64 or 65 bytes).
 */
export function serializeTaprootSignature(sig: Uint8Array, sighashType?: number): Uint8Array {
    const sighashTypeByte = sighashType ? new Uint8Array([sighashType]) : new Uint8Array(0);

    return concat([sig, sighashTypeByte]);
}

/**
 * Determines whether a PSBT input should be handled as a taproot-style input.
 * Returns true for both P2TR (SegWit v1, BIP 341) and P2MR (SegWit v2, BIP 360) inputs.
 * This is the gateway check that routes inputs to taproot signing and finalization logic.
 * @param input - The PSBT input to check.
 * @returns True if the input has taproot/P2MR fields or a P2TR/P2MR witnessUtxo script.
 */
export function isTaprootInput(input: PsbtInput): boolean {
    return (
        input &&
        !!(
            input.tapInternalKey ||
            input.tapMerkleRoot ||
            (input.tapLeafScript && input.tapLeafScript.length) ||
            (input.tapBip32Derivation && input.tapBip32Derivation.length) ||
            (input.witnessUtxo &&
                (isP2TR(new Uint8Array(input.witnessUtxo.script)) ||
                    isP2MR(new Uint8Array(input.witnessUtxo.script))))
        )
    );
}

/**
 * Checks if the input is spending a P2MR (Pay-to-Merkle-Root, BIP 360) output.
 * Requires `witnessUtxo` to be set on the input; returns false otherwise.
 * P2MR uses SegWit version 2 with scriptPubKey: `OP_2 <32-byte merkle_root>`.
 * @param input - The PSBT input to check.
 * @returns True if the witnessUtxo script is a valid P2MR output.
 */
export function isP2MRInput(input: PsbtInput): boolean {
    return !!(input.witnessUtxo && isP2MR(new Uint8Array(input.witnessUtxo.script)));
}

/**
 * Determines whether a PSBT output should be handled as a taproot-style output.
 * Returns true for both P2TR (BIP 341) and P2MR (BIP 360) outputs.
 * @param output - The PSBT output to check.
 * @param script - Optional output script to test against P2TR/P2MR patterns.
 * @returns True if the output has taproot fields or a P2TR/P2MR script.
 */
export function isTaprootOutput(output: PsbtOutput, script?: Uint8Array): boolean {
    return (
        output &&
        !!(
            output.tapInternalKey ||
            output.tapTree ||
            (output.tapBip32Derivation && output.tapBip32Derivation.length) ||
            (script && (isP2TR(script) || isP2MR(script)))
        )
    );
}

export function checkTaprootInputFields(
    inputData: PsbtInput,
    newInputData: PsbtInput,
    action: string,
): void {
    checkMixedTaprootAndNonTaprootInputFields(inputData, newInputData, action);
    checkIfTapLeafInTree(inputData, newInputData, action);
}

export function checkTaprootOutputFields(
    outputData: PsbtOutputWithScript,
    newOutputData: PsbtOutput,
    action: string,
): void {
    checkMixedTaprootAndNonTaprootOutputFields(outputData, newOutputData, action);
    checkTaprootScriptPubkey(outputData, newOutputData);
}

function checkTaprootScriptPubkey(
    outputData: PsbtOutputWithScript,
    newOutputData: PsbtOutput,
): void {
    if (!newOutputData.tapTree && !newOutputData.tapInternalKey) return;

    const tapInternalKey = newOutputData.tapInternalKey || outputData.tapInternalKey;
    const tapTree = newOutputData.tapTree || outputData.tapTree;

    if (tapInternalKey) {
        const scriptPubkey = outputData.script;
        const script = getTaprootScripPubkey(tapInternalKey, tapTree);
        if (scriptPubkey && !equals(scriptPubkey, script))
            throw new Error('Error adding output. Script or address missmatch.');
    }
}

function getTaprootScripPubkey(tapInternalKey: TapInternalKey, tapTree?: TapTree): Uint8Array {
    const scriptTree = tapTree && tapTreeFromList(tapTree.leaves);
    const { output } = p2tr({
        internalPubkey: new Uint8Array(tapInternalKey) as XOnlyPublicKey,
        scriptTree,
    });
    if (!output) throw new Error('Failed to generate taproot script pubkey');
    return output;
}

export function tweakInternalPubKey(inputIndex: number, input: PsbtInput): Uint8Array {
    const tapInternalKey = input.tapInternalKey;
    const tapInternalKeyBuf = tapInternalKey
        ? (new Uint8Array(tapInternalKey) as XOnlyPublicKey)
        : undefined;
    const tapMerkleRootBuf = input.tapMerkleRoot
        ? (new Uint8Array(input.tapMerkleRoot) as Bytes32)
        : undefined;
    const outputKey = tapInternalKeyBuf && tweakKey(tapInternalKeyBuf, tapMerkleRootBuf);

    if (!outputKey)
        throw new Error(
            `Cannot tweak tap internal key for input #${inputIndex}. Public key: ${
                tapInternalKeyBuf &&
                Array.from(tapInternalKeyBuf)
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('')
            }`,
        );
    return outputKey.x;
}

/**
 * Convert a binary tree to a BIP371 type list. Each element of the list is (according to BIP371):
 * One or more tuples representing the depth, leaf version, and script for a leaf in the Taproot tree,
 * allowing the entire tree to be reconstructed. The tuples must be in depth first search order so that
 * the tree is correctly reconstructed.
 * @param tree the binary tap tree
 * @returns a list of BIP 371 tapleaves
 */
export function tapTreeToList(tree: Taptree): TapLeaf[] {
    if (!isTaptree(tree))
        throw new Error('Cannot convert taptree to tapleaf list. Expecting a tapree structure.');
    return _tapTreeToList(tree);
}

/**
 * Convert a BIP371 TapLeaf list to a TapTree (binary).
 * @param leaves a list of tapleaves where each element of the list is (according to BIP371):
 * One or more tuples representing the depth, leaf version, and script for a leaf in the Taproot tree,
 * allowing the entire tree to be reconstructed. The tuples must be in depth first search order so that
 * the tree is correctly reconstructed.
 * @returns the corresponding taptree, or throws an exception if the tree cannot be reconstructed
 */
export function tapTreeFromList(leaves: TapLeaf[] = []): Taptree {
    const firstLeaf = leaves[0];
    if (leaves.length === 1 && firstLeaf && firstLeaf.depth === 0)
        return {
            output: new Uint8Array(firstLeaf.script),
            version: firstLeaf.leafVersion,
        };

    return insertLeavesInTree(leaves);
}

export function checkTaprootInputForSigs(input: PsbtInput, action: string): boolean {
    const sigs = extractTaprootSigs(input);
    return sigs.some((sig) => signatureBlocksAction(sig, decodeSchnorrSignature, action));
}

function decodeSchnorrSignature(signature: Uint8Array): {
    signature: Uint8Array;
    hashType: number;
} {
    return {
        signature: signature.subarray(0, 64),
        hashType: signature.subarray(64)[0] || Transaction.SIGHASH_DEFAULT,
    };
}

function extractTaprootSigs(input: PsbtInput): Uint8Array[] {
    const sigs: Uint8Array[] = [];
    if (input.tapKeySig) sigs.push(new Uint8Array(input.tapKeySig));
    if (input.tapScriptSig)
        sigs.push(...input.tapScriptSig.map((s) => new Uint8Array(s.signature)));
    if (!sigs.length) {
        const finalTapKeySig = getTapKeySigFromWitness(
            input.finalScriptWitness ? new Uint8Array(input.finalScriptWitness) : undefined,
        );
        if (finalTapKeySig) sigs.push(finalTapKeySig);
    }

    return sigs;
}

export function getTapKeySigFromWitness(finalScriptWitness?: Uint8Array): Uint8Array | undefined {
    if (!finalScriptWitness) return;
    const witness = finalScriptWitness.subarray(2);
    // todo: add schnorr signature validation
    if (witness.length === 64 || witness.length === 65) return witness;
    return undefined;
}

function _tapTreeToList(tree: Taptree, leaves: TapLeaf[] = [], depth = 0): TapLeaf[] {
    if (depth > MAX_TAPTREE_DEPTH) throw new Error('Max taptree depth exceeded.');
    if (!tree) return [];
    if (isTapleaf(tree)) {
        leaves.push({
            depth,
            leafVersion: tree.version || LEAF_VERSION_TAPSCRIPT,
            script: tree.output,
        });
        return leaves;
    }
    if (tree[0]) _tapTreeToList(tree[0], leaves, depth + 1);
    if (tree[1]) _tapTreeToList(tree[1], leaves, depth + 1);
    return leaves;
}

// Just like Taptree, but it accepts empty branches
type PartialTaptree = [PartialTaptree | Tapleaf, PartialTaptree | Tapleaf] | Tapleaf | undefined;

function insertLeavesInTree(leaves: TapLeaf[]): Taptree {
    let tree: PartialTaptree;
    for (const leaf of leaves) {
        tree = insertLeafInTree(leaf, tree);
        if (!tree) throw new Error(`No room left to insert tapleaf in tree`);
    }

    return tree as Taptree;
}

function insertLeafInTree(leaf: TapLeaf, tree?: PartialTaptree, depth = 0): PartialTaptree {
    if (depth > MAX_TAPTREE_DEPTH) throw new Error('Max taptree depth exceeded.');
    if (leaf.depth === depth) {
        if (!tree)
            return {
                output: new Uint8Array(leaf.script),
                version: leaf.leafVersion,
            };
        return;
    }

    if (isTapleaf(tree)) return;
    const leftSide = insertLeafInTree(leaf, tree && tree[0], depth + 1);
    if (leftSide) return [leftSide, tree && tree[1]];

    const rightSide = insertLeafInTree(leaf, tree && tree[1], depth + 1);
    if (rightSide) return [tree && tree[0], rightSide];
    return undefined;
}

function checkMixedTaprootAndNonTaprootInputFields(
    inputData: PsbtOutput,
    newInputData: PsbtInput,
    action: string,
): void {
    const isBadTaprootUpdate = isTaprootInput(inputData) && hasNonTaprootFields(newInputData);
    const isBadNonTaprootUpdate = hasNonTaprootFields(inputData) && isTaprootInput(newInputData);
    const hasMixedFields =
        inputData === newInputData &&
        isTaprootInput(newInputData) &&
        hasNonTaprootFields(newInputData); // todo: bad? use !===

    if (isBadTaprootUpdate || isBadNonTaprootUpdate || hasMixedFields)
        throw new Error(
            `Invalid arguments for Psbt.${action}. ` +
                `Cannot use both taproot and non-taproot fields.`,
        );
}

function checkMixedTaprootAndNonTaprootOutputFields(
    inputData: PsbtOutput,
    newInputData: PsbtOutput,
    action: string,
): void {
    const isBadTaprootUpdate = isTaprootOutput(inputData) && hasNonTaprootFields(newInputData);
    const isBadNonTaprootUpdate = hasNonTaprootFields(inputData) && isTaprootOutput(newInputData);
    const hasMixedFields =
        inputData === newInputData &&
        isTaprootOutput(newInputData) &&
        hasNonTaprootFields(newInputData);

    if (isBadTaprootUpdate || isBadNonTaprootUpdate || hasMixedFields)
        throw new Error(
            `Invalid arguments for Psbt.${action}. ` +
                `Cannot use both taproot and non-taproot fields.`,
        );
}

/**
 * Checks if the tap leaf is part of the tap tree for the given input data.
 * Throws an error if the tap leaf is not part of the tap tree.
 * @param inputData - The original PsbtInput data.
 * @param newInputData - The new PsbtInput data.
 * @param action - The action being performed.
 * @throws {Error} - If the tap leaf is not part of the tap tree.
 */
function checkIfTapLeafInTree(inputData: PsbtInput, newInputData: PsbtInput, action: string): void {
    const p2mrInput = isP2MRInput(inputData) || isP2MRInput(newInputData);
    if (newInputData.tapMerkleRoot) {
        const merkleRoot = new Uint8Array(newInputData.tapMerkleRoot);
        const newLeafsInTree = (newInputData.tapLeafScript || []).every((l) =>
            isTapLeafInTree(l, merkleRoot, p2mrInput),
        );
        const oldLeafsInTree = (inputData.tapLeafScript || []).every((l) =>
            isTapLeafInTree(l, merkleRoot, p2mrInput),
        );
        if (!newLeafsInTree || !oldLeafsInTree)
            throw new Error(`Invalid arguments for Psbt.${action}. Tapleaf not part of taptree.`);
    } else if (inputData.tapMerkleRoot) {
        const merkleRoot = new Uint8Array(inputData.tapMerkleRoot);
        const newLeafsInTree = (newInputData.tapLeafScript || []).every((l) =>
            isTapLeafInTree(l, merkleRoot, p2mrInput),
        );
        if (!newLeafsInTree)
            throw new Error(`Invalid arguments for Psbt.${action}. Tapleaf not part of taptree.`);
    }
}

/**
 * Checks if a TapLeafScript is present in a Merkle tree by recomputing the root
 * from the control block's merkle path.
 *
 * Handles both P2TR and P2MR control block formats:
 * - P2TR: 33 + 32*m bytes (1 control byte + 32-byte internal pubkey + merkle path)
 * - P2MR: 1 + 32*m bytes (1 control byte + merkle path, no internal pubkey)
 *
 * When `p2mr` is explicitly true, only the P2MR format is tried. When false and
 * the input type is unknown (witnessUtxo not yet set), both formats are tried as
 * their lengths overlap at 33, 65, 97... bytes. The merkle root is used to
 * disambiguate which interpretation is correct.
 *
 * @param tapLeaf - The TapLeafScript to check (includes script, leafVersion, controlBlock).
 * @param merkleRoot - The expected Merkle root. If not provided, returns true (no validation).
 * @param p2mr - If true, use P2MR control block format exclusively.
 * @returns True if the leaf's control block produces the expected merkle root.
 */
function isTapLeafInTree(tapLeaf: TapLeafScript, merkleRoot?: Uint8Array, p2mr = false): boolean {
    if (!merkleRoot) return true;

    const leafHash = tapleafHash({
        output: new Uint8Array(tapLeaf.script),
        version: tapLeaf.leafVersion,
    });

    const controlBlock = new Uint8Array(tapLeaf.controlBlock);

    if (p2mr) {
        return equals(rootHashFromPathP2MR(controlBlock, leafHash), merkleRoot);
    }

    // When the input type isn't known yet (witnessUtxo not set), try P2TR first,
    // then fall back to P2MR. Control block lengths overlap (33, 65, ...) between
    // P2TR (33 + 32*m) and P2MR (1 + 32*m), so we verify against the merkle root.
    const isValidP2TRLength = controlBlock.length >= 33 && (controlBlock.length - 33) % 32 === 0;
    const isValidP2MRLength = controlBlock.length >= 1 && (controlBlock.length - 1) % 32 === 0;

    if (isValidP2TRLength) {
        const rootHash = rootHashFromPath(controlBlock, leafHash);
        if (equals(rootHash, merkleRoot)) return true;
    }

    if (isValidP2MRLength) {
        const rootHash = rootHashFromPathP2MR(controlBlock, leafHash);
        if (equals(rootHash, merkleRoot)) return true;
    }

    return false;
}

/**
 * Sorts the signatures in the input's tapScriptSig array based on their position in the tapLeaf script.
 *
 * @param input - The PsbtInput object.
 * @param tapLeaf - The TapLeafScript object.
 * @returns An array of sorted signatures as Uint8Arrays.
 */
function sortSignatures(input: PsbtInput, tapLeaf: TapLeafScript): Uint8Array[] {
    const tapLeafScript = new Uint8Array(tapLeaf.script);
    const leafHash = tapleafHash({
        output: tapLeafScript,
        version: tapLeaf.leafVersion,
    });

    return (input.tapScriptSig || [])
        .filter((tss) => equals(new Uint8Array(tss.leafHash), leafHash))
        .map((tss) => addPubkeyPositionInScript(tapLeafScript, tss))
        .sort((t1, t2) => t2.positionInScript - t1.positionInScript)
        .map((t) => new Uint8Array(t.signature));
}

/**
 * Adds the position of a public key in a script to a TapScriptSig object.
 * @param script The script in which to find the position of the public key.
 * @param tss The TapScriptSig object to add the position to.
 * @returns A TapScriptSigWitPosition object with the added position.
 */
function addPubkeyPositionInScript(script: Uint8Array, tss: TapScriptSig): TapScriptSigWitPosition {
    return Object.assign(
        {
            positionInScript: pubkeyPositionInScript(new Uint8Array(tss.pubkey), script),
        },
        tss,
    ) as TapScriptSigWitPosition;
}

/**
 * Find tapleaf by hash, or get the signed tapleaf with the shortest path.
 */
function findTapLeafToFinalize(
    input: PsbtInput,
    inputIndex: number,
    leafHashToFinalize?: Uint8Array,
): TapLeafScript {
    const { tapScriptSig } = input;
    if (!tapScriptSig || !tapScriptSig.length)
        throw new Error(
            `Can not finalize taproot input #${inputIndex}. No tapleaf script signature provided.`,
        );
    const tapLeaf = (input.tapLeafScript || [])
        .sort((a, b) => a.controlBlock.length - b.controlBlock.length)
        .find((leaf) => canFinalizeLeaf(leaf, tapScriptSig, leafHashToFinalize));

    if (!tapLeaf)
        throw new Error(
            `Can not finalize taproot input #${inputIndex}. Signature for tapleaf script not found.`,
        );

    return tapLeaf;
}

/**
 * Determines whether a TapLeafScript can be finalized.
 *
 * @param leaf - The TapLeafScript to check.
 * @param tapScriptSig - The array of TapScriptSig objects.
 * @param hash - The optional hash to compare with the leaf hash.
 * @returns A boolean indicating whether the TapLeafScript can be finalized.
 */
function canFinalizeLeaf(
    leaf: TapLeafScript,
    tapScriptSig: TapScriptSig[],
    hash?: Uint8Array,
): boolean {
    const leafHash = tapleafHash({
        output: new Uint8Array(leaf.script),
        version: leaf.leafVersion,
    });
    const whiteListedHash = !hash || equals(hash, leafHash);
    return (
        whiteListedHash &&
        tapScriptSig.find((tss) => equals(new Uint8Array(tss.leafHash), leafHash)) !== undefined
    );
}

/**
 * Checks if the given PsbtInput or PsbtOutput has non-taproot fields.
 * Non-taproot fields include redeemScript, witnessScript, and bip32Derivation.
 * @param io The PsbtInput or PsbtOutput to check.
 * @returns A boolean indicating whether the given input or output has non-taproot fields.
 */
function hasNonTaprootFields(io: PsbtInput | PsbtOutput): boolean {
    return (
        io &&
        !!(io.redeemScript || io.witnessScript || (io.bip32Derivation && io.bip32Derivation.length))
    );
}

interface TapScriptSigWitPosition extends TapScriptSig {
    positionInScript: number;
}
