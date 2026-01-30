/**
 * Bech32 encoding/decoding utilities
 * @packageDocumentation
 */
import { bech32, bech32m } from 'bech32';

/** bech32 decode result */
export interface Bech32Result {
    /** address version: 0x00 for P2WPKH、P2WSH, 0x01 for P2TR*/
    version: number;
    /** address prefix: bc for P2WPKH、P2WSH、P2TR */
    prefix: string;
    /** address data：20 bytes for P2WPKH, 32 bytes for P2WSH、P2TR */
    data: Uint8Array;
}

/**
 * decode address with bech32 specification,  return address version、address prefix and address data if valid
 */
export function fromBech32(address: string): Bech32Result {
    let result;
    let version;
    try {
        result = bech32.decode(address);
    } catch (e) {}

    if (result) {
        version = result.words[0] as number;
        if (version !== 0) throw new TypeError(address + ' uses wrong encoding');
    } else {
        result = bech32m.decode(address);
        version = result.words[0] as number;
        if (version === 0) throw new TypeError(address + ' uses wrong encoding');
    }

    const data = bech32.fromWords(result.words.slice(1));

    return {
        version: version,
        prefix: result.prefix,
        data: new Uint8Array(data),
    };
}
