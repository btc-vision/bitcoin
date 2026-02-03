/**
 * Pay-to-Taproot (P2TR) payment class.
 *
 * P2TR is the Taproot output type (BIP341). It supports both key-path spending
 * (single signature) and script-path spending (merkle tree of scripts).
 *
 * @packageDocumentation
 */

import { bech32m } from 'bech32';
import { fromBech32 } from '../bech32utils.js';
import { bitcoin as BITCOIN_NETWORK, type Network } from '../networks.js';
import * as bscript from '../script.js';
import {
    type Bytes32,
    isXOnlyPublicKey,
    type SchnorrSignature,
    type Script,
    stacksEqual,
    TAPLEAF_VERSION_MASK,
    type Taptree,
    type XOnlyPublicKey,
} from '../types.js';
import {
    findScriptPath,
    type HashTree,
    LEAF_VERSION_TAPSCRIPT,
    rootHashFromPath,
    tapleafHash,
    toHashTree,
    tweakKey,
} from './bip341.js';
import { concat, equals } from '../io/index.js';
import { type P2TRPayment, type PaymentOpts, PaymentType, type ScriptRedeem } from './types.js';

const OPS = bscript.opcodes;
const TAPROOT_WITNESS_VERSION = 0x01;
const ANNEX_PREFIX = 0x50;

/**
 * Pay-to-Taproot (P2TR) payment class.
 *
 * Creates locking scripts of the form: `OP_1 {x-only pubkey}`
 *
 * Key-path spending witness: `[signature]`
 * Script-path spending witness: `[script inputs..., script, control block]`
 *
 * @example
 * ```typescript
 * import { P2TR } from '@btc-vision/bitcoin';
 *
 * // Key-path only (no scripts)
 * const keyOnly = P2TR.fromInternalPubkey(internalPubkey);
 * console.log(keyOnly.address); // bc1p... address
 *
 * // With script tree
 * const withScripts = P2TR.fromInternalPubkey(internalPubkey, scriptTree);
 *
 * // Decode an existing output
 * const decoded = P2TR.fromOutput(scriptPubKey);
 * console.log(decoded.pubkey); // 32-byte x-only pubkey
 * ```
 */
export class P2TR {
    // Static public fields
    static readonly NAME = PaymentType.P2TR;

    // Private instance fields
    readonly #network: Network;
    readonly #opts: Required<PaymentOpts>;

    // Input data (provided by user)
    #inputAddress?: string | undefined;
    #inputPubkey?: Uint8Array | undefined;
    #inputInternalPubkey?: Uint8Array | undefined;
    #inputHash?: Uint8Array | undefined;
    #inputScriptTree?: Taptree | undefined;
    #inputSignature?: Uint8Array | undefined;
    #inputOutput?: Uint8Array | undefined;
    #inputWitness?: Uint8Array[] | undefined;
    #inputRedeem?: ScriptRedeem | undefined;
    #inputRedeemVersion?: number | undefined;

    // Cached computed values
    #address?: string | undefined;
    #pubkey?: XOnlyPublicKey | undefined;
    #internalPubkey?: XOnlyPublicKey | undefined;
    #hash?: Bytes32 | undefined;
    #signature?: SchnorrSignature | undefined;
    #output?: Script | undefined;
    #redeem?: ScriptRedeem | undefined;
    #redeemVersion?: number | undefined;
    #witness?: Uint8Array[] | undefined;

    // Cache flags
    #addressComputed = false;
    #pubkeyComputed = false;
    #internalPubkeyComputed = false;
    #hashComputed = false;
    #signatureComputed = false;
    #outputComputed = false;
    #redeemComputed = false;
    #redeemVersionComputed = false;
    #witnessComputed = false;

    // Decoded address cache
    #decodedAddress?: { version: number; prefix: string; data: Uint8Array } | undefined;
    #decodedAddressComputed = false;

    // Witness without annex
    #witnessWithoutAnnex?: Uint8Array[] | undefined;
    #witnessWithoutAnnexComputed = false;

    // Hash tree cache
    #hashTree?: HashTree | undefined;
    #hashTreeComputed = false;

    /**
     * Creates a new P2TR payment instance.
     *
     * @param params - Payment parameters
     * @param params.address - Bech32m encoded address (bc1p...)
     * @param params.pubkey - x-only output pubkey (32 bytes)
     * @param params.internalPubkey - x-only internal pubkey (32 bytes)
     * @param params.hash - Merkle root (32 bytes, or empty for key-path only)
     * @param params.scriptTree - Full script tree definition
     * @param params.signature - Schnorr signature (for key-path spending)
     * @param params.output - The scriptPubKey
     * @param params.witness - The witness stack
     * @param params.redeem - Redeem script for script-path spending
     * @param params.redeemVersion - Leaf version (defaults to LEAF_VERSION_TAPSCRIPT)
     * @param params.network - Network parameters (defaults to mainnet)
     * @param opts - Payment options
     * @param opts.validate - Whether to validate inputs (default: true)
     *
     * @throws {TypeError} If validation is enabled and data is invalid
     */
    constructor(
        params: {
            address?: string | undefined;
            pubkey?: Uint8Array | undefined;
            internalPubkey?: Uint8Array | undefined;
            hash?: Uint8Array | undefined;
            scriptTree?: Taptree | undefined;
            signature?: Uint8Array | undefined;
            output?: Uint8Array | undefined;
            witness?: Uint8Array[] | undefined;
            redeem?: ScriptRedeem | undefined;
            redeemVersion?: number | undefined;
            network?: Network | undefined;
        },
        opts?: PaymentOpts,
    ) {
        this.#network = params.network ?? BITCOIN_NETWORK;
        this.#opts = {
            validate: opts?.validate ?? true,
            allowIncomplete: opts?.allowIncomplete ?? false,
        };

        // Store input data
        this.#inputAddress = params.address;
        this.#inputPubkey = params.pubkey;
        this.#inputInternalPubkey = params.internalPubkey;
        this.#inputHash = params.hash;
        this.#inputScriptTree = params.scriptTree;
        this.#inputSignature = params.signature;
        this.#inputOutput = params.output;
        this.#inputWitness = params.witness;
        this.#inputRedeem = params.redeem;
        this.#inputRedeemVersion = params.redeemVersion;

        // Validate if requested
        if (this.#opts.validate) {
            this.#validate();
        }
    }

    // Public getters

    /**
     * Payment type discriminant.
     */
    get name(): typeof PaymentType.P2TR {
        return PaymentType.P2TR;
    }

    /**
     * Network parameters.
     */
    get network(): Network {
        return this.#network;
    }

    /**
     * Bech32m encoded address (bc1p... for mainnet).
     */
    get address(): string | undefined {
        if (!this.#addressComputed) {
            this.#address = this.#computeAddress();
            this.#addressComputed = true;
        }
        return this.#address;
    }

    /**
     * x-only output pubkey (32 bytes).
     * This is the tweaked pubkey that appears in the output.
     */
    get pubkey(): XOnlyPublicKey | undefined {
        if (!this.#pubkeyComputed) {
            this.#pubkey = this.#computePubkey();
            this.#pubkeyComputed = true;
        }
        return this.#pubkey;
    }

    /**
     * x-only internal pubkey (32 bytes).
     * This is the untweaked pubkey before adding the merkle root tweak.
     */
    get internalPubkey(): XOnlyPublicKey | undefined {
        if (!this.#internalPubkeyComputed) {
            this.#internalPubkey = this.#computeInternalPubkey();
            this.#internalPubkeyComputed = true;
        }
        return this.#internalPubkey;
    }

    /**
     * Merkle root hash (32 bytes).
     * Present when a script tree is defined.
     */
    get hash(): Bytes32 | undefined {
        if (!this.#hashComputed) {
            this.#hash = this.#computeHash();
            this.#hashComputed = true;
        }
        return this.#hash;
    }

    /**
     * Schnorr signature (for key-path spending).
     */
    get signature(): SchnorrSignature | undefined {
        if (!this.#signatureComputed) {
            this.#signature = this.#computeSignature();
            this.#signatureComputed = true;
        }
        return this.#signature;
    }

    /**
     * The scriptPubKey: `OP_1 {32-byte x-only pubkey}`
     */
    get output(): Script | undefined {
        if (!this.#outputComputed) {
            this.#output = this.#computeOutput();
            this.#outputComputed = true;
        }
        return this.#output;
    }

    /**
     * Redeem script information (for script-path spending).
     */
    get redeem(): ScriptRedeem | undefined {
        if (!this.#redeemComputed) {
            this.#redeem = this.#computeRedeem();
            this.#redeemComputed = true;
        }
        return this.#redeem;
    }

    /**
     * Leaf version (defaults to LEAF_VERSION_TAPSCRIPT = 0xc0).
     */
    get redeemVersion(): number {
        if (!this.#redeemVersionComputed) {
            this.#redeemVersion = this.#computeRedeemVersion();
            this.#redeemVersionComputed = true;
        }
        return this.#redeemVersion ?? LEAF_VERSION_TAPSCRIPT;
    }

    /**
     * Witness stack.
     * Key-path: `[signature]`
     * Script-path: `[script inputs..., script, control block]`
     */
    get witness(): Uint8Array[] | undefined {
        if (!this.#witnessComputed) {
            this.#witness = this.#computeWitness();
            this.#witnessComputed = true;
        }
        return this.#witness;
    }

    // Static factory methods

    /**
     * Creates a P2TR payment from an internal pubkey (key-path only).
     *
     * @param internalPubkey - x-only internal pubkey (32 bytes)
     * @param scriptTree - Optional script tree
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2TR payment instance
     *
     * @example
     * ```typescript
     * // Key-path only
     * const p2tr = P2TR.fromInternalPubkey(internalPubkey);
     *
     * // With script tree
     * const withScripts = P2TR.fromInternalPubkey(internalPubkey, scriptTree);
     * ```
     */
    static fromInternalPubkey(
        internalPubkey: XOnlyPublicKey,
        scriptTree?: Taptree,
        network?: Network,
    ): P2TR {
        return new P2TR({ internalPubkey, scriptTree, network });
    }

    /**
     * Creates a P2TR payment from a bech32m address.
     *
     * @param address - Bech32m encoded address (bc1p...)
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2TR payment instance
     */
    static fromAddress(address: string, network?: Network): P2TR {
        return new P2TR({ address, network });
    }

    /**
     * Creates a P2TR payment from a scriptPubKey.
     *
     * @param output - The scriptPubKey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2TR payment instance
     */
    static fromOutput(output: Uint8Array, network?: Network): P2TR {
        return new P2TR({ output, network });
    }

    /**
     * Creates a P2TR payment from a signature (for key-path spending).
     *
     * @param signature - Schnorr signature
     * @param internalPubkey - x-only internal pubkey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2TR payment instance
     */
    static fromSignature(
        signature: SchnorrSignature,
        internalPubkey?: XOnlyPublicKey,
        network?: Network,
    ): P2TR {
        return new P2TR({ signature, internalPubkey, network });
    }

    // Private helper methods

    /**
     * Converts to a plain P2TRPayment object for backwards compatibility.
     *
     * @returns A P2TRPayment object
     */
    toPayment(): P2TRPayment {
        return {
            name: this.name,
            network: this.network,
            address: this.address,
            pubkey: this.pubkey,
            internalPubkey: this.internalPubkey,
            hash: this.hash,
            scriptTree: this.#inputScriptTree,
            signature: this.signature,
            output: this.output,
            redeem: this.redeem,
            redeemVersion: this.redeemVersion,
            witness: this.witness,
        };
    }

    #getDecodedAddress(): { version: number; prefix: string; data: Uint8Array } | undefined {
        if (!this.#decodedAddressComputed) {
            if (this.#inputAddress) {
                const decoded = fromBech32(this.#inputAddress);
                if (decoded) {
                    this.#decodedAddress = {
                        version: decoded.version,
                        prefix: decoded.prefix,
                        data: decoded.data,
                    };
                }
            }
            this.#decodedAddressComputed = true;
        }
        return this.#decodedAddress;
    }

    #getWitnessWithoutAnnex(): Uint8Array[] | undefined {
        if (!this.#witnessWithoutAnnexComputed) {
            if (this.#inputWitness && this.#inputWitness.length > 0) {
                // Remove annex if present
                const lastWitness = this.#inputWitness[this.#inputWitness.length - 1];
                if (
                    this.#inputWitness.length >= 2 &&
                    lastWitness && lastWitness[0] === ANNEX_PREFIX
                ) {
                    this.#witnessWithoutAnnex = this.#inputWitness.slice(0, -1);
                } else {
                    this.#witnessWithoutAnnex = this.#inputWitness.slice();
                }
            }
            this.#witnessWithoutAnnexComputed = true;
        }
        return this.#witnessWithoutAnnex;
    }

    // Private computation methods

    #getHashTree(): HashTree | undefined {
        if (!this.#hashTreeComputed) {
            if (this.#inputScriptTree) {
                this.#hashTree = toHashTree(this.#inputScriptTree);
            } else if (this.#inputHash) {
                this.#hashTree = { hash: this.#inputHash as Bytes32 };
            }
            this.#hashTreeComputed = true;
        }
        return this.#hashTree;
    }

    #computeAddress(): string | undefined {
        if (this.#inputAddress) {
            return this.#inputAddress;
        }
        const pk = this.pubkey;
        if (!pk) return undefined;

        const words = bech32m.toWords(pk);
        words.unshift(TAPROOT_WITNESS_VERSION);
        return bech32m.encode(this.#network.bech32, words);
    }

    #computePubkey(): XOnlyPublicKey | undefined {
        if (this.#inputPubkey) {
            return this.#inputPubkey as XOnlyPublicKey;
        }
        if (this.#inputOutput) {
            return this.#inputOutput.subarray(2) as XOnlyPublicKey;
        }
        if (this.#inputAddress) {
            return this.#getDecodedAddress()?.data as XOnlyPublicKey | undefined;
        }
        const internalPk = this.internalPubkey;
        if (internalPk) {
            const tweakedKey = tweakKey(internalPk, this.hash);
            if (tweakedKey) {
                return tweakedKey.x;
            }
        }
        return undefined;
    }

    #computeInternalPubkey(): XOnlyPublicKey | undefined {
        if (this.#inputInternalPubkey) {
            return this.#inputInternalPubkey as XOnlyPublicKey;
        }
        const witness = this.#getWitnessWithoutAnnex();
        if (witness && witness.length > 1) {
            const lastWitness = witness[witness.length - 1];
            if (lastWitness) {
                return lastWitness.subarray(1, 33) as XOnlyPublicKey;
            }
        }
        return undefined;
    }

    #computeHash(): Bytes32 | undefined {
        const hashTree = this.#getHashTree();
        if (hashTree) {
            return hashTree.hash;
        }

        const w = this.#getWitnessWithoutAnnex();
        if (w && w.length > 1) {
            const controlBlock = w[w.length - 1] as Uint8Array;
            const leafVersion = (controlBlock[0] as number) & TAPLEAF_VERSION_MASK;
            const script = w[w.length - 2] as Uint8Array;
            const leafHash = tapleafHash({
                output: script,
                version: leafVersion,
            });
            return rootHashFromPath(controlBlock, leafHash);
        }

        return undefined;
    }

    #computeSignature(): SchnorrSignature | undefined {
        if (this.#inputSignature) {
            return this.#inputSignature as SchnorrSignature;
        }
        const witness = this.#getWitnessWithoutAnnex();
        if (witness && witness.length === 1) {
            return witness[0] as SchnorrSignature;
        }
        return undefined;
    }

    #computeOutput(): Script | undefined {
        if (this.#inputOutput) {
            return this.#inputOutput as Script;
        }
        const pk = this.pubkey;
        if (!pk) return undefined;

        return bscript.compile([OPS.OP_1, pk]);
    }

    #computeRedeem(): ScriptRedeem | undefined {
        if (this.#inputRedeem) {
            return this.#inputRedeem;
        }
        const witness = this.#getWitnessWithoutAnnex();
        if (!witness || witness.length < 2) {
            return undefined;
        }
        const lastWitness = witness[witness.length - 1] as Uint8Array;
        return {
            output: witness[witness.length - 2] as Script,
            witness: witness.slice(0, -2),
            redeemVersion: (lastWitness[0] as number) & TAPLEAF_VERSION_MASK,
        };
    }

    #computeRedeemVersion(): number | undefined {
        if (this.#inputRedeemVersion !== undefined) {
            return this.#inputRedeemVersion;
        }
        if (
            this.#inputRedeem &&
            this.#inputRedeem.redeemVersion !== undefined &&
            this.#inputRedeem.redeemVersion !== null
        ) {
            return this.#inputRedeem.redeemVersion;
        }
        return LEAF_VERSION_TAPSCRIPT;
    }

    // Validation

    #computeWitness(): Uint8Array[] | undefined {
        if (this.#inputWitness) {
            return this.#inputWitness;
        }

        const hashTree = this.#getHashTree();
        if (hashTree && this.#inputRedeem?.output && this.#inputInternalPubkey) {
            const leafHash = tapleafHash({
                output: this.#inputRedeem.output,
                version: this.redeemVersion,
            });
            const path = findScriptPath(hashTree, leafHash);
            if (!path) return undefined;

            const outputKey = tweakKey(this.#inputInternalPubkey as XOnlyPublicKey, hashTree.hash);
            if (!outputKey) return undefined;

            const version = this.redeemVersion ?? 0xc0;
            const controlBlock = concat([
                new Uint8Array([version | outputKey.parity]),
                this.#inputInternalPubkey,
                ...path,
            ]);
            return [this.#inputRedeem.output, controlBlock];
        }

        if (this.#inputSignature) {
            return [this.#inputSignature];
        }

        return undefined;
    }

    #validate(): void {
        let pubkey: Uint8Array = new Uint8Array(0);

        if (this.#inputAddress) {
            const addr = this.#getDecodedAddress();
            if (!addr) {
                throw new TypeError('Invalid address');
            }
            if (this.#network && this.#network.bech32 !== addr.prefix) {
                throw new TypeError('Invalid prefix or Network mismatch');
            }
            if (addr.version !== TAPROOT_WITNESS_VERSION) {
                throw new TypeError('Invalid address version');
            }
            if (addr.data.length !== 32) {
                throw new TypeError('Invalid address data');
            }
            pubkey = addr.data;
        }

        if (this.#inputPubkey) {
            if (pubkey.length > 0 && !equals(pubkey, this.#inputPubkey)) {
                throw new TypeError('Pubkey mismatch');
            } else {
                pubkey = this.#inputPubkey;
            }
        }

        if (this.#inputOutput) {
            if (
                this.#inputOutput.length !== 34 ||
                this.#inputOutput[0] !== OPS.OP_1 ||
                this.#inputOutput[1] !== 0x20
            ) {
                throw new TypeError('Output is invalid');
            }
            if (pubkey.length > 0 && !equals(pubkey, this.#inputOutput.subarray(2))) {
                throw new TypeError('Pubkey mismatch');
            } else {
                pubkey = this.#inputOutput.subarray(2);
            }
        }

        if (this.#inputInternalPubkey) {
            const tweakedKey = tweakKey(this.#inputInternalPubkey as XOnlyPublicKey, this.hash);
            if (!tweakedKey) {
                throw new TypeError('Invalid internal pubkey');
            }
            if (pubkey.length > 0 && !equals(pubkey, tweakedKey.x)) {
                throw new TypeError('Pubkey mismatch');
            } else {
                pubkey = tweakedKey.x;
            }
        }

        const hashTree = this.#getHashTree();

        if (this.#inputHash && hashTree) {
            if (!equals(this.#inputHash, hashTree.hash)) {
                throw new TypeError('Hash mismatch');
            }
        }

        if (this.#inputRedeem?.output && hashTree) {
            const leafHash = tapleafHash({
                output: this.#inputRedeem.output,
                version: this.redeemVersion,
            });
            if (!findScriptPath(hashTree, leafHash)) {
                throw new TypeError('Redeem script not in tree');
            }
        }

        const witness = this.#getWitnessWithoutAnnex();

        // Compare provided redeem with computed from witness
        if (this.#inputRedeem && this.redeem) {
            if (this.#inputRedeem.redeemVersion) {
                if (this.#inputRedeem.redeemVersion !== this.redeem.redeemVersion) {
                    throw new TypeError('Redeem.redeemVersion and witness mismatch');
                }
            }

            if (this.#inputRedeem.output) {
                const decompiled = bscript.decompile(this.#inputRedeem.output);
                if (!decompiled || decompiled.length === 0) {
                    throw new TypeError('Redeem.output is invalid');
                }

                if (this.redeem.output && !equals(this.#inputRedeem.output, this.redeem.output)) {
                    throw new TypeError('Redeem.output and witness mismatch');
                }
            }
            if (this.#inputRedeem.witness) {
                if (
                    this.redeem.witness &&
                    !stacksEqual(this.#inputRedeem.witness, this.redeem.witness)
                ) {
                    throw new TypeError('Redeem.witness and witness mismatch');
                }
            }
        }

        if (witness && witness.length > 0) {
            if (witness.length === 1) {
                // Key-path spending
                const firstWitness = witness[0] as Uint8Array;
                if (this.#inputSignature && !equals(this.#inputSignature, firstWitness)) {
                    throw new TypeError('Signature mismatch');
                }
            } else {
                // Script-path spending
                const controlBlock = witness[witness.length - 1] as Uint8Array;
                if (controlBlock.length < 33) {
                    throw new TypeError(
                        `The control-block length is too small. Got ${controlBlock.length}, expected min 33.`,
                    );
                }

                if ((controlBlock.length - 33) % 32 !== 0) {
                    throw new TypeError(
                        `The control-block length of ${controlBlock.length} is incorrect!`,
                    );
                }

                const m = (controlBlock.length - 33) / 32;
                if (m > 128) {
                    throw new TypeError(`The script path is too long. Got ${m}, expected max 128.`);
                }

                const internalPk = controlBlock.subarray(1, 33);
                if (this.#inputInternalPubkey && !equals(this.#inputInternalPubkey, internalPk)) {
                    throw new TypeError('Internal pubkey mismatch');
                }

                if (!isXOnlyPublicKey(internalPk)) {
                    throw new TypeError('Invalid internalPubkey for p2tr witness');
                }

                const controlBlockFirstByte = controlBlock[0] as number;
                const leafVersion = controlBlockFirstByte & TAPLEAF_VERSION_MASK;
                const script = witness[witness.length - 2] as Uint8Array;

                const leafHash = tapleafHash({
                    output: script,
                    version: leafVersion,
                });
                const computedHash = rootHashFromPath(controlBlock, leafHash);

                const outputKey = tweakKey(internalPk, computedHash);
                if (!outputKey) {
                    throw new TypeError('Invalid outputKey for p2tr witness');
                }

                if (pubkey.length > 0 && !equals(pubkey, outputKey.x)) {
                    throw new TypeError('Pubkey mismatch for p2tr witness');
                }

                if (outputKey.parity !== (controlBlockFirstByte & 1)) {
                    throw new Error('Incorrect parity');
                }
            }
        }
    }
}

/**
 * Creates a Pay-to-Taproot (P2TR) payment object.
 *
 * This is the legacy factory function for backwards compatibility.
 * For new code, prefer using the P2TR class directly.
 *
 * @param a - The payment object containing the necessary data
 * @param opts - Optional payment options
 * @returns The P2TR payment object
 * @throws {TypeError} If the required data is not provided or if the data is invalid
 *
 * @example
 * ```typescript
 * import { p2tr } from '@btc-vision/bitcoin';
 *
 * // Key-path only
 * const payment = p2tr({ internalPubkey });
 *
 * // With script tree
 * const withScripts = p2tr({ internalPubkey, scriptTree });
 * ```
 */
export function p2tr(a: Omit<P2TRPayment, 'name'>, opts?: PaymentOpts): P2TRPayment {
    if (
        !a.address &&
        !a.output &&
        !a.pubkey &&
        !a.internalPubkey &&
        !(a.witness && a.witness.length > 1)
    ) {
        throw new TypeError('Not enough data');
    }

    const instance = new P2TR(
        {
            address: a.address,
            pubkey: a.pubkey,
            internalPubkey: a.internalPubkey,
            hash: a.hash,
            scriptTree: a.scriptTree,
            signature: a.signature,
            output: a.output,
            witness: a.witness,
            redeem: a.redeem,
            redeemVersion: a.redeemVersion,
            network: a.network,
        },
        opts,
    );

    // Return a merged object for backwards compatibility
    return Object.assign(instance.toPayment(), a);
}
