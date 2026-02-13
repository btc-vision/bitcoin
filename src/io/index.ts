/**
 * High-performance binary I/O module.
 *
 * This module provides efficient binary reading and writing with
 * zero-allocation operations through stateful DataView instances.
 *
 * @packageDocumentation
 */

import * as varuint from 'varuint-bitcoin';

// Binary reading and writing
export { BinaryReader } from './BinaryReader.js';
export { BinaryWriter, GrowableBinaryWriter } from './BinaryWriter.js';

// Hex encoding/decoding
export { toHex, fromHex, isHex } from './hex.js';

// Base64 encoding/decoding
export { fromBase64, toBase64 } from './base64.js';

// Base58Check encoding/decoding
export * as base58check from './base58check.js';

// Utility functions
export {
    concat,
    equals,
    compare,
    isZero,
    clone,
    reverse,
    reverseCopy,
    alloc,
    xor,
    fromUtf8,
    toUtf8,
} from './utils.js';

// Re-export varuint for Bitcoin CompactSize encoding
export { varuint };
