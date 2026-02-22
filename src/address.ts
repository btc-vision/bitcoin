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
import { type Bech32Result, fromBech32 } from './bech32utils.js';
import { alloc, base58check } from './io/index.js';
import type { Network } from './networks.js';
import * as networks from './networks.js';
import { p2op } from './payments/p2op.js';
import { p2pkh } from './payments/p2pkh.js';
import { p2sh } from './payments/p2sh.js';
import { p2mr } from './payments/p2mr.js';
import { p2tr } from './payments/p2tr.js';
import { p2wpkh } from './payments/p2wpkh.js';
import { p2wsh } from './payments/p2wsh.js';
import * as bscript from './script.js';
import { opcodes } from './script.js';
import {
    type Bytes20,
    type Script,
    isBytes20,
    isUInt8,
    toBytes20,
    toBytes32,
    type XOnlyPublicKey,
} from './types.js';

export { fromBech32, type Bech32Result };

/** base58check decode result */
export interface Base58CheckResult {
    /** address hash */
    readonly hash: Bytes20;
    /** address version: 0x00 for P2PKH, 0x05 for P2SH */
    readonly version: number;
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

        const firstByte = output[0];
        if (firstByte === undefined) throw new TypeError('Empty output');
        const version = firstByte - FUTURE_SEGWIT_VERSION_DIFF;
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
    let pushPos: number = 1,
        progLen: number;

    const byte1 = output[1];
    const byte2 = output[2];
    if (byte1 !== undefined && byte1 < 0x4c) {
        progLen = byte1;
        pushPos = 2;
    } else if (byte1 === 0x4c && byte2 !== undefined) {
        progLen = byte2;
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
            : opcode !== undefined && opcode >= opcodes.OP_1 && opcode <= opcodes.OP_16
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

    const firstByte = output[0];
    if (firstByte === undefined) throw new TypeError('Empty output');
    const version = firstByte - FUTURE_SEGWIT_VERSION_DIFF;
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
    const payload = new Uint8Array(base58check.decode(address));

    // TODO: 4.0.0, move to "toOutputScript"
    if (payload.length < 21) throw new TypeError(address + ' is too short');
    if (payload.length > 21) throw new TypeError(address + ' is too long');

    const version = payload[0] as number; // Safe: length validated above
    const hash = payload.subarray(1) as Bytes20;

    return { version, hash };
}

/**
 * encode address hash to base58 address with version
 */
export function toBase58Check(hash: Bytes20, version: number): string {
    if (!isBytes20(hash)) throw new TypeError('Expected 20 bytes hash');
    if (!isUInt8(version)) throw new TypeError('Expected UInt8 version');

    const payload = alloc(21);
    payload[0] = version;
    payload.set(hash, 1);

    return base58check.encode(payload);
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
 * decode address from output script with network, return address if matched.
 *
 * Uses fast byte-pattern matching for common script types (P2PKH, P2SH,
 * P2WPKH, P2WSH, P2TR) to avoid constructing payment objects and catching
 * exceptions. Falls back to payment constructors for exotic types.
 */
export function fromOutputScript(output: Uint8Array | Script, network?: Network): string {
    network = network || networks.bitcoin;
    const len = output.length;

    // P2PKH: OP_DUP(0x76) OP_HASH160(0xa9) 0x14 <20-byte hash> OP_EQUALVERIFY(0x88) OP_CHECKSIG(0xac)
    if (
        len === 25 &&
        output[0] === 0x76 &&
        output[1] === 0xa9 &&
        output[2] === 0x14 &&
        output[23] === 0x88 &&
        output[24] === 0xac
    ) {
        return toBase58Check(output.subarray(3, 23) as Bytes20, network.pubKeyHash);
    }

    // P2SH: OP_HASH160(0xa9) 0x14 <20-byte hash> OP_EQUAL(0x87)
    if (len === 23 && output[0] === 0xa9 && output[1] === 0x14 && output[22] === 0x87) {
        return toBase58Check(output.subarray(2, 22) as Bytes20, network.scriptHash);
    }

    // P2WPKH: OP_0(0x00) 0x14 <20-byte hash>
    if (len === 22 && output[0] === 0x00 && output[1] === 0x14) {
        return toBech32(output.subarray(2, 22), 0, network.bech32);
    }

    // P2WSH: OP_0(0x00) 0x20 <32-byte hash>
    if (len === 34 && output[0] === 0x00 && output[1] === 0x20) {
        return toBech32(output.subarray(2, 34), 0, network.bech32);
    }

    // P2TR: OP_1(0x51) 0x20 <32-byte x-only pubkey>
    if (len === 34 && output[0] === 0x51 && output[1] === 0x20) {
        const words = bech32m.toWords(output.subarray(2, 34));
        words.unshift(1);
        return bech32m.encode(network.bech32, words);
    }

    // P2MR: OP_2(0x52) 0x20 <32-byte merkle root>
    if (len === 34 && output[0] === 0x52 && output[1] === 0x20) {
        const words = bech32m.toWords(output.subarray(2, 34));
        words.unshift(2);
        return bech32m.encode(network.bech32, words);
    }

    // Fallback for exotic types
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
    readonly network?: Network;
    /**
     * Optional callback for future segwit version warnings.
     * If provided, called with FUTURE_SEGWIT_VERSION_WARNING when encoding
     * to a future segwit version (v2-v15) address.
     * If not provided, no warning is emitted.
     */
    readonly onFutureSegwitWarning?: (warning: string) => void;
}

/**
 * Encodes address to output script with network, return output script if address matched.
 * @param address - The address to encode
 * @param networkOrOptions - Network or options object
 * @returns The output script
 */
export function toOutputScript(
    address: string,
    networkOrOptions?: Network | ToOutputScriptOptions,
): Script {
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
            return p2pkh({ hash: decodeBase58.hash }).output as Script;
        if (decodeBase58.version === network.scriptHash)
            return p2sh({ hash: decodeBase58.hash }).output as Script;
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
                    return p2wpkh({ hash: toBytes20(decodeBech32.data) }).output as Script;
                if (decodeBech32.data.length === 32)
                    return p2wsh({ hash: toBytes32(decodeBech32.data) }).output as Script;
            } else if (decodeBech32.version === 1) {
                if (decodeBech32.data.length === 32)
                    return p2tr({ pubkey: decodeBech32.data as XOnlyPublicKey })
                        .output as Script;
            } else if (decodeBech32.version === 2 && decodeBech32.data.length === 32) {
                return p2mr({ hash: toBytes32(decodeBech32.data) }).output as Script;
            } else if (decodeBech32.version === FUTURE_OPNET_VERSION) {
                if (!network.bech32Opnet) throw new Error(address + ' has an invalid prefix');
                return p2op({
                    program: decodeBech32.data,
                    network,
                }).output as Script;
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
