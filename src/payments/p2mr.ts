/**
 * Pay-to-Merkle-Root (P2MR) payment class.
 *
 * P2MR is a SegWit version 2 output type (BIP 360). It commits directly to
 * the Merkle root of a script tree, removing the quantum-vulnerable key-path
 * spend found in P2TR. There is no internal pubkey or tweaking.
 *
 * @packageDocumentation
 */

import { bech32m } from 'bech32';
import { fromBech32 } from '../bech32utils.js';
import { bitcoin as BITCOIN_NETWORK, type Network } from '../networks.js';
import * as bscript from '../script.js';
import {
    type Bytes32,
    type Script,
    stacksEqual,
    TAPLEAF_VERSION_MASK,
    type Taptree,
} from '../types.js';
import {
    findScriptPath,
    type HashTree,
    LEAF_VERSION_TAPSCRIPT,
    rootHashFromPathP2MR,
    tapleafHash,
    toHashTree,
} from './bip341.js';
import { concat, equals } from '../io/index.js';
import { type P2MRPayment, type PaymentOpts, PaymentType, type ScriptRedeem } from './types.js';

const OPS = bscript.opcodes;
const P2MR_WITNESS_VERSION = 0x02;
const ANNEX_PREFIX = 0x50;

/**
 * Pay-to-Merkle-Root (P2MR) payment class.
 *
 * Creates locking scripts of the form: `OP_2 {32-byte merkle root}`
 *
 * Script-path spending witness: `[script inputs..., script, control block]`
 *
 * @example
 * ```typescript
 * import { P2MR } from '@btc-vision/bitcoin';
 *
 * // From script tree
 * const p2mr = P2MR.fromScriptTree(scriptTree);
 * console.log(p2mr.address); // bc1z... address
 *
 * // From merkle root hash
 * const fromHash = P2MR.fromHash(merkleRoot);
 *
 * // Decode an existing output
 * const decoded = P2MR.fromOutput(scriptPubKey);
 * console.log(decoded.hash); // 32-byte merkle root
 * ```
 */
export class P2MR {
    static readonly NAME = PaymentType.P2MR;

    readonly #network: Network;
    readonly #opts: Required<PaymentOpts>;

    #inputAddress?: string | undefined;
    #inputHash?: Uint8Array | undefined;
    #inputScriptTree?: Taptree | undefined;
    #inputOutput?: Uint8Array | undefined;
    #inputWitness?: Uint8Array[] | undefined;
    #inputRedeem?: ScriptRedeem | undefined;
    #inputRedeemVersion?: number | undefined;

    #address?: string | undefined;
    #hash?: Bytes32 | undefined;
    #output?: Script | undefined;
    #redeem?: ScriptRedeem | undefined;
    #redeemVersion?: number | undefined;
    #witness?: Uint8Array[] | undefined;

    #addressComputed = false;
    #hashComputed = false;
    #outputComputed = false;
    #redeemComputed = false;
    #redeemVersionComputed = false;
    #witnessComputed = false;

    #decodedAddress?: { version: number; prefix: string; data: Uint8Array } | undefined;
    #decodedAddressComputed = false;

    #witnessWithoutAnnex?: Uint8Array[] | undefined;
    #witnessWithoutAnnexComputed = false;

    #hashTree?: HashTree | undefined;
    #hashTreeComputed = false;

    /**
     * Creates a new P2MR payment instance.
     *
     * @param params - Payment parameters
     * @param params.address - Bech32m encoded address (bc1z...)
     * @param params.hash - Merkle root (32 bytes, = witness program)
     * @param params.scriptTree - Full script tree definition
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
            hash?: Uint8Array | undefined;
            scriptTree?: Taptree | undefined;
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
        this.#inputHash = params.hash;
        this.#inputScriptTree = params.scriptTree;
        this.#inputOutput = params.output;
        this.#inputWitness = params.witness;
        this.#inputRedeem = params.redeem;
        this.#inputRedeemVersion = params.redeemVersion;

        // Validate if requested
        if (this.#opts.validate) {
            this.#validate();
        }
    }

    /**
     * Payment type discriminant.
     *
     * @returns The P2MR payment type constant.
     */
    get name(): typeof PaymentType.P2MR {
        return PaymentType.P2MR;
    }

    /**
     * Network parameters used for address encoding.
     *
     * @returns The network configuration (mainnet, testnet, or regtest).
     */
    get network(): Network {
        return this.#network;
    }

    /**
     * Bech32m encoded address (bc1z... for mainnet).
     *
     * @returns The bech32m-encoded address, or `undefined` if insufficient data.
     */
    get address(): string | undefined {
        if (!this.#addressComputed) {
            this.#address = this.#computeAddress();
            this.#addressComputed = true;
        }
        return this.#address;
    }

    /**
     * Merkle root hash (32 bytes). This is the witness program and directly
     * appears in the output script.
     *
     * @returns The 32-byte merkle root, or `undefined` if insufficient data.
     */
    get hash(): Bytes32 | undefined {
        if (!this.#hashComputed) {
            this.#hash = this.#computeHash();
            this.#hashComputed = true;
        }
        return this.#hash;
    }

    /**
     * The scriptPubKey: `OP_2 <32-byte merkle root>` (34 bytes total).
     *
     * @returns The output script, or `undefined` if insufficient data.
     */
    get output(): Script | undefined {
        if (!this.#outputComputed) {
            this.#output = this.#computeOutput();
            this.#outputComputed = true;
        }
        return this.#output;
    }

    /**
     * Redeem script information for script-path spending.
     *
     * @returns The redeem script data, or `undefined` if not available.
     */
    get redeem(): ScriptRedeem | undefined {
        if (!this.#redeemComputed) {
            this.#redeem = this.#computeRedeem();
            this.#redeemComputed = true;
        }
        return this.#redeem;
    }

    /**
     * Leaf version used for script-path hashing.
     *
     * @returns The leaf version byte (defaults to LEAF_VERSION_TAPSCRIPT = 0xc0).
     */
    get redeemVersion(): number {
        if (!this.#redeemVersionComputed) {
            this.#redeemVersion = this.#computeRedeemVersion();
            this.#redeemVersionComputed = true;
        }
        return this.#redeemVersion ?? LEAF_VERSION_TAPSCRIPT;
    }

    /**
     * Witness stack for script-path spending.
     * Format: `[script inputs..., script, control block]`
     *
     * @returns The witness stack array, or `undefined` if insufficient data.
     */
    get witness(): Uint8Array[] | undefined {
        if (!this.#witnessComputed) {
            this.#witness = this.#computeWitness();
            this.#witnessComputed = true;
        }
        return this.#witness;
    }

    /**
     * Creates a P2MR payment from a script tree.
     *
     * @param scriptTree - The script tree
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2MR payment instance
     */
    static fromScriptTree(scriptTree: Taptree, network?: Network): P2MR {
        return new P2MR({ scriptTree, network });
    }

    /**
     * Creates a P2MR payment from a bech32m address.
     *
     * @param address - Bech32m encoded address (bc1z...)
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2MR payment instance
     */
    static fromAddress(address: string, network?: Network): P2MR {
        return new P2MR({ address, network });
    }

    /**
     * Creates a P2MR payment from a scriptPubKey.
     *
     * @param output - The scriptPubKey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2MR payment instance
     */
    static fromOutput(output: Uint8Array, network?: Network): P2MR {
        return new P2MR({ output, network });
    }

    /**
     * Creates a P2MR payment from a merkle root hash.
     *
     * @param hash - The 32-byte merkle root
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2MR payment instance
     */
    static fromHash(hash: Bytes32, network?: Network): P2MR {
        return new P2MR({ hash, network });
    }

    /**
     * Converts to a plain P2MRPayment object for backwards compatibility.
     *
     * @returns A P2MRPayment object
     */
    toPayment(): P2MRPayment {
        return {
            name: this.name,
            network: this.network,
            address: this.address,
            hash: this.hash,
            scriptTree: this.#inputScriptTree,
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
        const h = this.hash;
        if (!h) return undefined;

        const words = bech32m.toWords(h);
        words.unshift(P2MR_WITNESS_VERSION);
        return bech32m.encode(this.#network.bech32, words);
    }

    #computeHash(): Bytes32 | undefined {
        if (this.#inputHash) {
            return this.#inputHash as Bytes32;
        }

        const hashTree = this.#getHashTree();
        if (hashTree) {
            return hashTree.hash;
        }

        if (this.#inputOutput) {
            return this.#inputOutput.subarray(2) as Bytes32;
        }

        if (this.#inputAddress) {
            return this.#getDecodedAddress()?.data as Bytes32 | undefined;
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
            return rootHashFromPathP2MR(controlBlock, leafHash);
        }

        return undefined;
    }

    #computeOutput(): Script | undefined {
        if (this.#inputOutput) {
            return this.#inputOutput as Script;
        }
        const h = this.hash;
        if (!h) return undefined;

        return bscript.compile([OPS.OP_2, h]);
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

    #computeWitness(): Uint8Array[] | undefined {
        if (this.#inputWitness) {
            return this.#inputWitness;
        }

        const hashTree = this.#getHashTree();
        if (hashTree && this.#inputRedeem?.output) {
            const leafHash = tapleafHash({
                output: this.#inputRedeem.output,
                version: this.redeemVersion,
            });
            const path = findScriptPath(hashTree, leafHash);
            if (!path) return undefined;

            const version = this.redeemVersion ?? 0xc0;
            // P2MR control block: [version | 0x01, ...merklePath]
            // Parity bit is always 1, no internal pubkey
            const controlBlock = concat([
                new Uint8Array([version | 0x01]),
                ...path,
            ]);
            return [this.#inputRedeem.output, controlBlock];
        }

        return undefined;
    }

    #validate(): void {
        let knownHash: Uint8Array = new Uint8Array(0);

        if (this.#inputAddress) {
            const addr = this.#getDecodedAddress();
            if (!addr) {
                throw new TypeError('Invalid address');
            }
            if (this.#network && this.#network.bech32 !== addr.prefix) {
                throw new TypeError('Invalid prefix or Network mismatch');
            }
            if (addr.version !== P2MR_WITNESS_VERSION) {
                throw new TypeError('Invalid address version');
            }
            if (addr.data.length !== 32) {
                throw new TypeError('Invalid address data');
            }
            knownHash = addr.data;
        }

        if (this.#inputOutput) {
            if (
                this.#inputOutput.length !== 34 ||
                this.#inputOutput[0] !== OPS.OP_2 ||
                this.#inputOutput[1] !== 0x20
            ) {
                throw new TypeError('Output is invalid');
            }
            if (knownHash.length > 0 && !equals(knownHash, this.#inputOutput.subarray(2))) {
                throw new TypeError('Hash mismatch');
            } else {
                knownHash = this.#inputOutput.subarray(2);
            }
        }

        if (this.#inputHash) {
            if (this.#inputHash.length !== 32) {
                throw new TypeError('Invalid hash length');
            }
            if (knownHash.length > 0 && !equals(knownHash, this.#inputHash)) {
                throw new TypeError('Hash mismatch');
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
            // P2MR only supports script-path spending (no key-path)
            if (witness.length < 2) {
                throw new TypeError(
                    'P2MR requires at least 2 witness items (script + control block)',
                );
            }

            const controlBlock = witness[witness.length - 1] as Uint8Array;
            if (controlBlock.length < 1) {
                throw new TypeError(
                    `The control-block length is too small. Got ${controlBlock.length}, expected min 1.`,
                );
            }

            if ((controlBlock.length - 1) % 32 !== 0) {
                throw new TypeError(
                    `The control-block length of ${controlBlock.length} is incorrect!`,
                );
            }

            const m = (controlBlock.length - 1) / 32;
            if (m > 128) {
                throw new TypeError(`The script path is too long. Got ${m}, expected max 128.`);
            }

            const controlBlockFirstByte = controlBlock[0] as number;

            // P2MR parity bit must be 1
            if ((controlBlockFirstByte & 1) !== 1) {
                throw new TypeError('P2MR control byte parity bit must be 1');
            }

            const leafVersion = controlBlockFirstByte & TAPLEAF_VERSION_MASK;
            const script = witness[witness.length - 2] as Uint8Array;

            const leafHash = tapleafHash({
                output: script,
                version: leafVersion,
            });
            const computedHash = rootHashFromPathP2MR(controlBlock, leafHash);

            // Verify merkle root matches the witness program
            if (knownHash.length > 0 && !equals(knownHash, computedHash)) {
                throw new TypeError('Merkle root mismatch for p2mr witness');
            }
        }
    }
}

/**
 * Creates a Pay-to-Merkle-Root (P2MR) payment object.
 *
 * This is the legacy factory function for backwards compatibility.
 * For new code, prefer using the P2MR class directly.
 *
 * @param a - The payment object containing the necessary data
 * @param opts - Optional payment options
 * @returns The P2MR payment object
 * @throws {TypeError} If the required data is not provided or if the data is invalid
 *
 * @example
 * ```typescript
 * import { p2mr } from '@btc-vision/bitcoin';
 *
 * // From script tree
 * const payment = p2mr({ scriptTree });
 *
 * // From merkle root hash
 * const fromHash = p2mr({ hash: merkleRoot });
 * ```
 */
export function p2mr(a: Omit<P2MRPayment, 'name'>, opts?: PaymentOpts): P2MRPayment {
    if (
        !a.address &&
        !a.output &&
        !a.hash &&
        !a.scriptTree &&
        !(a.witness && a.witness.length > 1)
    ) {
        throw new TypeError('Not enough data');
    }

    const instance = new P2MR(
        {
            address: a.address,
            hash: a.hash,
            scriptTree: a.scriptTree,
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
