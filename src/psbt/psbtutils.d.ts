/// <reference types="node" />
import { PartialSig, PsbtInput } from 'bip174/src/lib/interfaces';
export declare const isP2MS: (script: Buffer) => boolean;
export declare const isP2PK: (script: Buffer) => boolean;
export declare const isP2PKH: (script: Buffer) => boolean;
export declare const isP2WPKH: (script: Buffer) => boolean;
export declare const isP2WSHScript: (script: Buffer) => boolean;
export declare const isP2SHScript: (script: Buffer) => boolean;
export declare const isP2TR: (script: Buffer) => boolean;
/**
 * Converts a witness stack to a script witness.
 * @param witness The witness stack to convert.
 * @returns The script witness as a Buffer.
 */
/**
 * Converts a witness stack to a script witness.
 * @param witness The witness stack to convert.
 * @returns The converted script witness.
 */
export declare function witnessStackToScriptWitness(witness: Buffer[]): Buffer;
export interface UncompressedPublicKey {
    hybrid: Buffer;
    uncompressed: Buffer;
}
/**
 * Converts an existing real Bitcoin public key (compressed or uncompressed)
 * to its "hybrid" form (prefix 0x06/0x07), then derives a P2PKH address from it.
 *
 * @param realPubKey - 33-byte compressed (0x02/0x03) or 65-byte uncompressed (0x04) pubkey
 * @returns Buffer
 */
export declare function decompressPublicKey(realPubKey: Uint8Array | Buffer): UncompressedPublicKey;
/****************************************
 * Convert bigint -> 32-byte Buffer
 ****************************************/
export declare function bigIntTo32Bytes(num: bigint): Buffer;
/**
 * Compare two potential pubkey Buffers, treating hybrid keys (0x06/0x07)
 * as equivalent to uncompressed (0x04).
 */
export declare function pubkeysMatch(a: Buffer, b: Buffer): boolean;
/**
 * Finds the position of a public key in a script.
 * @param pubkey The public key to search for.
 * @param script The script to search in.
 * @returns The index of the public key in the script, or -1 if not found.
 * @throws {Error} If there is an unknown script error.
 */
export declare function pubkeyPositionInScript(pubkey: Buffer, script: Buffer): number;
/**
 * Checks if a public key is present in a script.
 * @param pubkey The public key to check.
 * @param script The script to search in.
 * @returns A boolean indicating whether the public key is present in the script.
 */
export declare function pubkeyInScript(pubkey: Buffer, script: Buffer): boolean;
/**
 * Checks if an input contains a signature for a specific action.
 * @param input - The input to check.
 * @param action - The action to check for.
 * @returns A boolean indicating whether the input contains a signature for the specified action.
 */
export declare function checkInputForSig(input: PsbtInput, action: string): boolean;
type SignatureDecodeFunc = (buffer: Buffer) => {
    signature: Buffer;
    hashType: number;
};
/**
 * Determines if a given action is allowed for a signature block.
 * @param signature - The signature block.
 * @param signatureDecodeFn - The function used to decode the signature.
 * @param action - The action to be checked.
 * @returns True if the action is allowed, false otherwise.
 */
export declare function signatureBlocksAction(signature: Buffer, signatureDecodeFn: SignatureDecodeFunc, action: string): boolean;
/**
 * Retrieves the partial signatures (Psigs) from the input's final scripts.
 * Psigs are extracted from both the final scriptSig and final scriptWitness of the input.
 * Only canonical script signatures are considered.
 *
 * @param input - The PsbtInput object representing the input.
 * @returns An array of PartialSig objects containing the extracted Psigs.
 */
export declare function getPsigsFromInputFinalScripts(input: PsbtInput): PartialSig[];
export {};
