/**
 * Pay-to-OPNet (P2OP) payment class.
 *
 * P2OP is a custom witness version 16 output type for the OPNet network.
 * The witness program contains a deployment version and hash160.
 *
 * @packageDocumentation
 */

import { bech32m } from 'bech32';
import { fromBech32 } from '../bech32utils.js';
import { bitcoin as BITCOIN_NETWORK, type Network } from '../networks.js';
import * as bscript from '../script.js';
import { alloc, concat, equals } from '../io/index.js';
import type { Bytes20, Script } from '../types.js';
import { type P2OPPayment, type PaymentOpts, PaymentType } from './types.js';

const OPS = bscript.opcodes;
const P2OP_WITNESS_VERSION = 0x10;
const MIN_SIZE = 2;
const MAX_SIZE = 40;

/**
 * Pay-to-OPNet (P2OP) payment class.
 *
 * Creates locking scripts of the form: `OP_16 {program}`
 * where program = `{deploymentVersion:uint8}{hash160:20-bytes|...}`
 *
 * @example
 * ```typescript
 * import { P2OP } from '@btc-vision/bitcoin';
 *
 * // Create from program
 * const payment = P2OP.fromProgram(program);
 * console.log(payment.address); // opnet address
 *
 * // Create from deployment version and hash160
 * const fromParts = P2OP.fromParts(deploymentVersion, hash160);
 *
 * // Decode an existing output
 * const decoded = P2OP.fromOutput(scriptPubKey);
 * console.log(decoded.program);
 * ```
 */
export class P2OP {
    // Static public fields
    static readonly NAME = PaymentType.P2OP;

    // Private instance fields
    readonly #network: Network;
    readonly #opts: Required<PaymentOpts>;

    // Input data (provided by user)
    #inputAddress?: string | undefined;
    #inputProgram?: Uint8Array | undefined;
    #inputDeploymentVersion?: number | undefined;
    #inputHash160?: Uint8Array | undefined;
    #inputOutput?: Uint8Array | undefined;

    // Cached computed values
    #address?: string | undefined;
    #program?: Uint8Array | undefined;
    #deploymentVersion?: number | undefined;
    #hash160?: Uint8Array | undefined;
    #output?: Uint8Array | undefined;

    // Cache flags
    #addressComputed = false;
    #programComputed = false;
    #deploymentVersionComputed = false;
    #hash160Computed = false;
    #outputComputed = false;

    // Decoded address cache
    #decodedAddress?: { version: number; prefix: string; data: Uint8Array } | undefined;
    #decodedAddressComputed = false;

    /**
     * Creates a new P2OP payment instance.
     *
     * @param params - Payment parameters
     * @param params.address - Bech32m encoded OPNet address
     * @param params.program - Witness program (2-40 bytes)
     * @param params.deploymentVersion - Deployment version (0-255)
     * @param params.hash160 - 20-byte hash
     * @param params.output - The scriptPubKey
     * @param params.network - Network parameters (defaults to mainnet)
     * @param opts - Payment options
     * @param opts.validate - Whether to validate inputs (default: true)
     *
     * @throws {TypeError} If validation is enabled and data is invalid
     */
    constructor(
        params: {
            address?: string | undefined;
            program?: Uint8Array | undefined;
            deploymentVersion?: number | undefined;
            hash160?: Uint8Array | undefined;
            output?: Uint8Array | undefined;
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
        this.#inputProgram = params.program;
        this.#inputDeploymentVersion = params.deploymentVersion;
        this.#inputHash160 = params.hash160;
        this.#inputOutput = params.output;

        // Validate if requested
        if (this.#opts.validate) {
            this.#validate();
        }
    }

    // Public getters

    /**
     * Payment type discriminant.
     */
    get name(): typeof PaymentType.P2OP {
        return PaymentType.P2OP;
    }

    /**
     * Network parameters.
     */
    get network(): Network {
        return this.#network;
    }

    /**
     * Bech32m encoded OPNet address.
     */
    get address(): string | undefined {
        if (!this.#addressComputed) {
            this.#address = this.#computeAddress();
            this.#addressComputed = true;
        }
        return this.#address;
    }

    /**
     * Witness program (2-40 bytes).
     * Format: `{deploymentVersion:uint8}{hash160:20-bytes|...}`
     */
    get program(): Uint8Array | undefined {
        if (!this.#programComputed) {
            this.#program = this.#computeProgram();
            this.#programComputed = true;
        }
        return this.#program;
    }

    /**
     * Deployment version (first byte of program).
     */
    get deploymentVersion(): number | undefined {
        if (!this.#deploymentVersionComputed) {
            this.#deploymentVersion = this.#computeDeploymentVersion();
            this.#deploymentVersionComputed = true;
        }
        return this.#deploymentVersion;
    }

    /**
     * Hash160 (remaining bytes of program).
     */
    get hash160(): Bytes20 | undefined {
        if (!this.#hash160Computed) {
            this.#hash160 = this.#computeHash160();
            this.#hash160Computed = true;
        }
        return this.#hash160 as Bytes20 | undefined;
    }

    /**
     * The scriptPubKey: `OP_16 {program}`
     */
    get output(): Uint8Array | undefined {
        if (!this.#outputComputed) {
            this.#output = this.#computeOutput();
            this.#outputComputed = true;
        }
        return this.#output;
    }

    // Static factory methods

    /**
     * Creates a P2OP payment from a witness program.
     *
     * @param program - Witness program (2-40 bytes)
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2OP payment instance
     */
    static fromProgram(program: Uint8Array, network?: Network): P2OP {
        return new P2OP({ program, network });
    }

    /**
     * Creates a P2OP payment from deployment version and hash160.
     *
     * @param deploymentVersion - Deployment version (0-255)
     * @param hash160 - 20-byte hash
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2OP payment instance
     */
    static fromParts(deploymentVersion: number, hash160: Uint8Array, network?: Network): P2OP {
        return new P2OP({ deploymentVersion, hash160, network });
    }

    /**
     * Creates a P2OP payment from an OPNet address.
     *
     * @param address - Bech32m encoded OPNet address
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2OP payment instance
     */
    static fromAddress(address: string, network?: Network): P2OP {
        return new P2OP({ address, network });
    }

    /**
     * Creates a P2OP payment from a scriptPubKey.
     *
     * @param output - The scriptPubKey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2OP payment instance
     */
    static fromOutput(output: Uint8Array, network?: Network): P2OP {
        return new P2OP({ output, network });
    }

    // Private helper methods

    /**
     * Converts to a plain P2OPPayment object for backwards compatibility.
     *
     * @returns A P2OPPayment object
     */
    toPayment(): P2OPPayment {
        return {
            name: this.name,
            network: this.network,
            address: this.address,
            program: this.program,
            deploymentVersion: this.deploymentVersion,
            hash160: this.hash160,
            output: this.output as Script | undefined,
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

    // Private computation methods

    #makeProgramFromParts(): Uint8Array | undefined {
        if (
            typeof this.#inputDeploymentVersion !== 'undefined' &&
            typeof this.#inputHash160 !== 'undefined'
        ) {
            if (this.#inputHash160.length !== 20) {
                throw new TypeError('hash160 must be exactly 20 bytes');
            }
            if (this.#inputDeploymentVersion < 0 || this.#inputDeploymentVersion > 0xff) {
                throw new TypeError('deploymentVersion must fit in one byte');
            }
            return concat([new Uint8Array([this.#inputDeploymentVersion]), this.#inputHash160]);
        }
        return undefined;
    }

    #computeAddress(): string | undefined {
        if (this.#inputAddress) {
            return this.#inputAddress;
        }
        const prog = this.program;
        if (!prog) return undefined;

        if (!this.#network.bech32Opnet) {
            throw new TypeError('Network does not support opnet');
        }

        const words = bech32m.toWords(prog);
        words.unshift(P2OP_WITNESS_VERSION);
        return bech32m.encode(this.#network.bech32Opnet, words);
    }

    #computeProgram(): Uint8Array | undefined {
        if (this.#inputProgram) {
            return this.#inputProgram;
        }

        // Build from deployment version + hash160
        const fromParts = this.#makeProgramFromParts();
        if (fromParts) {
            return fromParts;
        }

        if (this.#inputOutput) {
            if (this.#inputOutput[0] !== OPS.OP_16) {
                throw new TypeError('Invalid P2OP script');
            }
            let pushPos = 1;
            let progLen: number;
            const byte1 = this.#inputOutput[1];
            const byte2 = this.#inputOutput[2];
            if (byte1 !== undefined && byte1 < 0x4c) {
                progLen = byte1;
                pushPos = 2;
            } else if (byte1 === 0x4c && byte2 !== undefined) {
                progLen = byte2;
                pushPos = 3;
            } else {
                throw new TypeError('Unsupported push opcode in P2OP script');
            }
            return this.#inputOutput.subarray(pushPos, pushPos + progLen);
        }

        if (this.#inputAddress) {
            return this.#getDecodedAddress()?.data;
        }

        return undefined;
    }

    #computeDeploymentVersion(): number | undefined {
        if (this.#inputDeploymentVersion !== undefined) {
            return this.#inputDeploymentVersion;
        }
        const prog = this.program;
        if (!prog) return undefined;
        return prog[0];
    }

    #computeHash160(): Uint8Array | undefined {
        if (this.#inputHash160) {
            return this.#inputHash160;
        }
        const prog = this.program;
        if (!prog) return undefined;
        return prog.subarray(1) as Bytes20;
    }

    // Validation

    #computeOutput(): Uint8Array | undefined {
        if (this.#inputOutput) {
            return this.#inputOutput;
        }
        const prog = this.program;
        if (!prog) return undefined;

        return bscript.compile([OPS.OP_16, prog]);
    }

    #validate(): void {
        let prog: Uint8Array = alloc(0);

        if (this.#inputAddress) {
            const dec = this.#getDecodedAddress();
            if (!dec) {
                throw new TypeError('Invalid address');
            }
            if (this.#network.bech32Opnet !== dec.prefix) {
                throw new TypeError('Invalid prefix or network mismatch');
            }
            if (dec.version !== P2OP_WITNESS_VERSION) {
                throw new TypeError('Invalid witness version for p2op');
            }
            if (dec.data.length < MIN_SIZE || dec.data.length > MAX_SIZE) {
                throw new TypeError('Invalid witness program length');
            }
            prog = dec.data;
        }

        if (this.#inputProgram) {
            if (prog.length > 0 && !equals(prog, this.#inputProgram)) {
                throw new TypeError('Program mismatch');
            }
            prog = this.#inputProgram;
        }

        if (!prog.length && this.#inputDeploymentVersion !== undefined && this.#inputHash160) {
            const made = this.#makeProgramFromParts();
            if (made) prog = made;
        }

        if (this.#inputOutput) {
            const outProg = this.program;
            if (!outProg) {
                throw new TypeError('Output program is required');
            }
            if (prog.length > 0 && !equals(prog, outProg)) {
                throw new TypeError('Program mismatch (output vs other source)');
            }
            prog = outProg;
        }

        if (prog.length < MIN_SIZE || prog.length > MAX_SIZE) {
            throw new TypeError(`Witness program must be 2–40 bytes. Was ${prog.length} bytes`);
        }

        if (
            this.#inputDeploymentVersion !== undefined &&
            this.#inputDeploymentVersion !== prog[0]
        ) {
            throw new TypeError('deploymentVersion mismatch');
        }

        if (this.#inputHash160 && !equals(this.#inputHash160, prog.subarray(1))) {
            throw new TypeError('hash160 mismatch');
        }
    }
}

/**
 * Creates a Pay-to-OPNet (P2OP) payment object.
 *
 * This is the legacy factory function for backwards compatibility.
 * For new code, prefer using the P2OP class directly.
 *
 * @param a - The payment object containing the necessary data
 * @param opts - Optional payment options
 * @returns The P2OP payment object
 * @throws {TypeError} If the required data is not provided or if the data is invalid
 *
 * @example
 * ```typescript
 * import { p2op } from '@btc-vision/bitcoin';
 *
 * // Create from program
 * const payment = p2op({ program });
 *
 * // Create from parts
 * const fromParts = p2op({ deploymentVersion: 0, hash160 });
 * ```
 */
export function p2op(
    a: {
        address?: string;
        program?: Uint8Array;
        deploymentVersion?: number;
        hash160?: Uint8Array;
        output?: Uint8Array;
        network?: Network;
    },
    opts?: PaymentOpts,
): P2OPPayment {
    if (
        !a.address &&
        !a.output &&
        !a.program &&
        (typeof a.deploymentVersion === 'undefined' || !a.hash160)
    ) {
        throw new TypeError('At least one of address, output or program must be provided');
    }

    const instance = new P2OP(
        {
            address: a.address,
            program: a.program,
            deploymentVersion: a.deploymentVersion,
            hash160: a.hash160,
            output: a.output,
            network: a.network,
        },
        opts,
    );

    // Return a merged object for backwards compatibility
    return Object.assign(instance.toPayment(), a);
}
