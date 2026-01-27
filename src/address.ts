/**
 * bitcoin address decode and encode tools, include base58、bech32 and output script
 *
 * networks support bitcoin、bitcoin testnet and bitcoin regtest
 *
 * addresses support P2PKH、P2SH、P2WPKH、P2WSH、P2TR and so on
 *
 * @packageDocumentation
 */
import { bech32, bech32m } from 'bech32';
import * as bs58check from 'bs58check';
import { fromBech32, type Bech32Result } from './bech32utils.js';
import { alloc } from './io/index.js';
import * as networks from './networks.js';
import { Network } from './networks.js';
import { p2op } from './payments/p2op.js';
import { p2pkh } from './payments/p2pkh.js';
import { p2sh } from './payments/p2sh.js';
import { p2tr } from './payments/p2tr.js';
import { p2wpkh } from './payments/p2wpkh.js';
import { p2wsh } from './payments/p2wsh.js';
import * as bscript from './script.js';
import { opcodes } from './script.js';
import { isBytes20, isUInt8 } from './types.js';

export { fromBech32, type Bech32Result };

/** base58check decode result */
export interface Base58CheckResult {
    /** address hash */
    hash: Uint8Array;
    /** address version: 0x00 for P2PKH, 0x05 for P2SH */
    version: number;
}

export const FUTURE_SEGWIT_MAX_SIZE: number = 40;
export const FUTURE_SEGWIT_MIN_SIZE: number = 2;
export const FUTURE_SEGWIT_MAX_VERSION: number = 15;
export const FUTURE_MAX_VERSION: number = 16;
export const FUTURE_OPNET_VERSION: number = 16;
export const FUTURE_SEGWIT_MIN_VERSION: number = 2;
export const FUTURE_SEGWIT_VERSION_DIFF: number = 0x50;
const FUTURE_SEGWIT_VERSION_WARNING: string =
    'WARNING: Sending to a future segwit version address can lead to loss of funds. ' +
    'End users MUST be warned carefully in the GUI and asked if they wish to proceed ' +
    'with caution. Wallets should verify the segwit version from the output of fromBech32, ' +
    'then decide when it is safe to use which version of segwit.';

export const isUnknownSegwitVersion = (output: Uint8Array): boolean => {
    try {
        const data = output.subarray(2);
        if (data.length < FUTURE_SEGWIT_MIN_SIZE || data.length > FUTURE_SEGWIT_MAX_SIZE) {
            throw new TypeError('Invalid program length for segwit address');
        }

        const version = output[0] - FUTURE_SEGWIT_VERSION_DIFF;
        if (version < FUTURE_SEGWIT_MIN_VERSION || version > FUTURE_SEGWIT_MAX_VERSION + 1) {
            throw new TypeError('Invalid version for segwit address');
        }

        if (version === 1) throw new TypeError('taproot');

        return true;
    } catch (e) {}

    return false;
};

/**
 * Encode a future Taproot-style segwit address (SegWit v2 - v16) using bech32m.
 * Only for versions not yet assigned specific meanings (future use).
 *
 * @param output - Output script buffer containing the version and witness program
 * @param network - Network object containing bech32 and optional bech32Opnet prefix
 * @returns Bech32m-encoded future Taproot-style address
 */
export function toFutureOPNetAddress(output: Uint8Array, network: Network): string {
    if (!(output instanceof Uint8Array)) throw new TypeError('output must be a Uint8Array');
    if (!network.bech32Opnet) throw new Error('Network does not support opnet');

    const opcode = output[0];

    // work out where the push-data really starts
    let pushPos = 1,
        progLen: number;
    if (output[1] < 0x4c) {
        progLen = output[1];
        pushPos = 2;
    } else if (output[1] === 0x4c) {
        progLen = output[2];
        pushPos = 3;
    } else {
        throw new TypeError('Unsupported push opcode in script');
    }

    const program = output.subarray(pushPos, pushPos + progLen);

    if (program.length < FUTURE_SEGWIT_MIN_SIZE || program.length > FUTURE_SEGWIT_MAX_SIZE)
        throw new TypeError('Invalid program length for segwit address');

    const version =
        opcode === opcodes.OP_0
            ? 0
            : opcode >= opcodes.OP_1 && opcode <= opcodes.OP_16
              ? opcode - (opcodes.OP_1 - 1)
              : -1;

    if (version < FUTURE_SEGWIT_MAX_VERSION || version > FUTURE_MAX_VERSION)
        throw new TypeError(`Invalid segwit version ${version}`);

    const words = [version, ...bech32m.toWords(program)];
    return bech32m.encode(network.bech32Opnet, words);
}

export function _toFutureSegwitAddress(output: Uint8Array, network: Network): string {
    const data = output.subarray(2);
    if (data.length < FUTURE_SEGWIT_MIN_SIZE || data.length > FUTURE_SEGWIT_MAX_SIZE) {
        throw new TypeError('Invalid program length for segwit address');
    }

    const version = output[0] - FUTURE_SEGWIT_VERSION_DIFF;
    if (version < FUTURE_SEGWIT_MIN_VERSION || version > FUTURE_SEGWIT_MAX_VERSION) {
        throw new TypeError('Invalid version for segwit address');
    }

    if (output[1] !== data.length) {
        throw new TypeError(`Invalid script for segwit address ${output[1]} !== ${data.length}`);
    }

    return toBech32(data, version, network.bech32, network.bech32Opnet);
}

/**
 * decode address with base58 specification,  return address version and address hash if valid
 */
export function fromBase58Check(address: string): Base58CheckResult {
    const payload = new Uint8Array(bs58check.default.decode(address));

    // TODO: 4.0.0, move to "toOutputScript"
    if (payload.length < 21) throw new TypeError(address + ' is too short');
    if (payload.length > 21) throw new TypeError(address + ' is too long');

    const version = payload[0];
    const hash = payload.subarray(1);

    return { version, hash };
}

/**
 * encode address hash to base58 address with version
 */
export function toBase58Check(hash: Uint8Array, version: number): string {
    if (!isBytes20(hash)) throw new TypeError('Expected 20 bytes hash');
    if (!isUInt8(version)) throw new TypeError('Expected UInt8 version');

    const payload = alloc(21);
    payload[0] = version;
    payload.set(hash, 1);

    return bs58check.default.encode(payload);
}

/**
 * encode address hash to bech32 address with version and prefix
 */
export function toBech32(
    data: Uint8Array,
    version: number,
    prefix: string,
    prefixOpnet?: string,
): string {
    const words = bech32.toWords(data);
    words.unshift(version);

    if (version === FUTURE_OPNET_VERSION && prefixOpnet) {
        return bech32m.encode(prefixOpnet, words);
    }

    return version === 0 ? bech32.encode(prefix, words) : bech32m.encode(prefix, words);
}

/**
 * decode address from output script with network, return address if matched
 */
export function fromOutputScript(output: Uint8Array, network?: Network): string {
    // TODO: Network
    network = network || networks.bitcoin;

    try {
        return p2pkh({ output, network }).address as string;
    } catch (e) {}
    try {
        return p2sh({ output, network }).address as string;
    } catch (e) {}
    try {
        return p2wpkh({ output, network }).address as string;
    } catch (e) {}
    try {
        return p2wsh({ output, network }).address as string;
    } catch (e) {}
    try {
        return p2tr({ output, network }).address as string;
    } catch (e) {}
    try {
        return toFutureOPNetAddress(output, network);
    } catch (e) {}
    try {
        return _toFutureSegwitAddress(output, network);
    } catch (e) {}

    throw new Error(bscript.toASM(output) + ' has no matching Address');
}

/**
 * Options for toOutputScript function.
 */
export interface ToOutputScriptOptions {
    /**
     * Network to use for encoding. Defaults to bitcoin mainnet.
     */
    network?: Network;
    /**
     * Optional callback for future segwit version warnings.
     * If provided, called with FUTURE_SEGWIT_VERSION_WARNING when encoding
     * to a future segwit version (v2-v15) address.
     * If not provided, no warning is emitted.
     */
    onFutureSegwitWarning?: (warning: string) => void;
}

/**
 * Encodes address to output script with network, return output script if address matched.
 * @param address - The address to encode
 * @param networkOrOptions - Network or options object
 * @returns The output script as Uint8Array
 */
export function toOutputScript(
    address: string,
    networkOrOptions?: Network | ToOutputScriptOptions,
): Uint8Array {
    let network: Network;
    let onFutureSegwitWarning: ((warning: string) => void) | undefined;

    if (networkOrOptions && 'bech32' in networkOrOptions) {
        // It's a Network object
        network = networkOrOptions;
    } else if (networkOrOptions && typeof networkOrOptions === 'object') {
        // It's an options object
        network = networkOrOptions.network || networks.bitcoin;
        onFutureSegwitWarning = networkOrOptions.onFutureSegwitWarning;
    } else {
        network = networks.bitcoin;
    }

    let decodeBase58: Base58CheckResult | undefined;
    let decodeBech32: Bech32Result | undefined;
    try {
        decodeBase58 = fromBase58Check(address);
    } catch (e) {}

    if (decodeBase58) {
        if (decodeBase58.version === network.pubKeyHash)
            return p2pkh({ hash: decodeBase58.hash }).output as Uint8Array;
        if (decodeBase58.version === network.scriptHash)
            return p2sh({ hash: decodeBase58.hash }).output as Uint8Array;
    } else {
        try {
            decodeBech32 = fromBech32(address);
        } catch (e) {}

        if (decodeBech32) {
            if (
                decodeBech32.prefix !== network.bech32 &&
                network.bech32Opnet &&
                decodeBech32.prefix !== network.bech32Opnet
            )
                throw new Error(address + ' has an invalid prefix');
            if (decodeBech32.version === 0) {
                if (decodeBech32.data.length === 20)
                    return p2wpkh({ hash: decodeBech32.data }).output as Uint8Array;
                if (decodeBech32.data.length === 32)
                    return p2wsh({ hash: decodeBech32.data }).output as Uint8Array;
            } else if (decodeBech32.version === 1) {
                if (decodeBech32.data.length === 32)
                    return p2tr({ pubkey: decodeBech32.data }).output as Uint8Array;
            } else if (decodeBech32.version === FUTURE_OPNET_VERSION) {
                if (!network.bech32Opnet) throw new Error(address + ' has an invalid prefix');
                return p2op({
                    program: decodeBech32.data,
                    network,
                }).output as Uint8Array;
            } else if (
                decodeBech32.version >= FUTURE_SEGWIT_MIN_VERSION &&
                decodeBech32.version <= FUTURE_SEGWIT_MAX_VERSION &&
                decodeBech32.data.length >= FUTURE_SEGWIT_MIN_SIZE &&
                decodeBech32.data.length <= FUTURE_SEGWIT_MAX_SIZE
            ) {
                if (decodeBech32.version !== FUTURE_OPNET_VERSION && onFutureSegwitWarning) {
                    onFutureSegwitWarning(FUTURE_SEGWIT_VERSION_WARNING);
                }

                return bscript.compile([
                    decodeBech32.version + FUTURE_SEGWIT_VERSION_DIFF,
                    decodeBech32.data,
                ]);
            }
        }
    }

    throw new TypeError(address + ' has no matching Script');
}
