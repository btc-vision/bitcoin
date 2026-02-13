/**
 * Script tools, including decompile, compile, toASM, fromASM, toStack, isCanonicalPubKey, isCanonicalScriptSignature
 * @packageDocumentation
 */
import * as bip66 from './bip66.js';
import { alloc, fromHex, toHex } from './io/index.js';
import type { Opcodes } from './opcodes.js';
import { getReverseOps, opcodes } from './opcodes.js';
import * as pushdata from './push_data.js';
import * as scriptNumber from './script_number.js';
import * as scriptSignature from './script_signature.js';
import { isDefinedHashType } from './script_signature.js';
import type { Script, Stack } from './types.js';
import * as types from './types.js';

const OP_INT_BASE = opcodes.OP_RESERVED; // OP_1 - 1
export { opcodes };

function isOPInt(value: number): boolean {
    return (
        types.isNumber(value) &&
        (value === opcodes.OP_0 ||
            (value >= opcodes.OP_1 && value <= opcodes.OP_16) ||
            value === opcodes.OP_1NEGATE)
    );
}

function isPushOnlyChunk(value: number | Uint8Array): boolean {
    if (value instanceof Uint8Array) return true;
    return isOPInt(value);
}

export function isPushOnly(value: Stack): boolean {
    return types.isArray(value) && value.every(isPushOnlyChunk);
}

export function countNonPushOnlyOPs(value: Stack): number {
    return value.length - value.filter(isPushOnlyChunk).length;
}

function asMinimalOP(buffer: Uint8Array): number | undefined {
    if (buffer.length === 0) return opcodes.OP_0;
    if (buffer.length !== 1) return undefined;
    const firstByte = buffer[0] as number;
    if (firstByte >= 1 && firstByte <= 16) return OP_INT_BASE + firstByte;
    if (firstByte === 0x81) return opcodes.OP_1NEGATE;
    return undefined;
}

function chunksIsUint8Array(buf: Uint8Array | Stack): buf is Uint8Array {
    return buf instanceof Uint8Array;
}

function chunksIsArray(buf: Uint8Array | Stack): buf is Stack {
    return types.isArray(buf);
}

function singleChunkIsUint8Array(buf: number | Uint8Array): buf is Uint8Array {
    return buf instanceof Uint8Array;
}

/**
 * Compiles an array of chunks into a Uint8Array.
 *
 * @param chunks - The array of chunks to compile.
 * @returns The compiled Uint8Array.
 * @throws Error if the compilation fails.
 */
export function compile(chunks: Uint8Array | Stack): Script {
    // Already compiled - return as-is
    if (chunksIsUint8Array(chunks)) return chunks as Script;

    if (!types.isArray(chunks)) {
        throw new TypeError('Expected an array');
    }

    const bufferSize = chunks.reduce((accum: number, chunk) => {
        // data chunk
        if (singleChunkIsUint8Array(chunk)) {
            // adhere to BIP62.3, minimal push policy
            if (chunk.length === 1 && asMinimalOP(chunk) !== undefined) {
                return accum + 1;
            }

            return accum + pushdata.encodingLength(chunk.length) + chunk.length;
        }

        // opcode
        return accum + 1;
    }, 0.0);

    const buffer = new Uint8Array(bufferSize);
    let offset = 0;

    chunks.forEach((chunk) => {
        // data chunk
        if (singleChunkIsUint8Array(chunk)) {
            // adhere to BIP62.3, minimal push policy
            const opcode = asMinimalOP(chunk);
            if (opcode !== undefined) {
                buffer[offset] = opcode;
                offset += 1;
                return;
            }

            offset += pushdata.encode(buffer, chunk.length, offset);
            buffer.set(chunk, offset);
            offset += chunk.length;

            // opcode
        } else {
            buffer[offset] = chunk;
            offset += 1;
        }
    });

    if (offset !== buffer.length) throw new Error('Could not decode chunks');
    return buffer as Script;
}

export function decompile(buffer: Uint8Array | Stack): Array<number | Uint8Array> | null {
    // Already decompiled - return as-is
    if (chunksIsArray(buffer)) return buffer as Array<number | Uint8Array>;

    if (!(buffer instanceof Uint8Array)) {
        throw new TypeError('Expected a Uint8Array');
    }

    const chunks: Array<number | Uint8Array> = [];
    let i = 0;

    while (i < buffer.length) {
        const opcode = buffer[i] as number;

        // data chunk
        if (opcode > opcodes.OP_0 && opcode <= opcodes.OP_PUSHDATA4) {
            const d = pushdata.decode(buffer, i);

            // did reading a pushDataInt fail?
            if (d === null) return null;
            i += d.size;

            // attempt to read too much data?
            if (i + d.number > buffer.length) return null;

            const data = buffer.subarray(i, i + d.number);
            i += d.number;

            // decompile minimally
            const op = asMinimalOP(data);
            if (op !== undefined) {
                chunks.push(op);
            } else {
                chunks.push(data);
            }

            // opcode
        } else {
            chunks.push(opcode);

            i += 1;
        }
    }

    return chunks;
}

/**
 * Converts the given chunks into an ASM (Assembly) string representation.
 * If the chunks parameter is a Uint8Array, it will be decompiled into a Stack before conversion.
 * @param chunks - The chunks to convert into ASM.
 * @returns The ASM string representation of the chunks.
 */
export function toASM(chunks: Uint8Array | Stack): string {
    let resolved: Stack;
    if (chunksIsUint8Array(chunks)) {
        const decompiled = decompile(chunks);
        if (!decompiled) {
            throw new Error('Could not convert invalid chunks to ASM');
        }
        resolved = decompiled;
    } else {
        resolved = chunks;
    }
    return resolved
        .map((chunk) => {
            // data?
            if (singleChunkIsUint8Array(chunk)) {
                const op = asMinimalOP(chunk);
                if (op === undefined) return toHex(chunk);
                chunk = op;
            }

            // opcode!
            return getReverseOps()[chunk];
        })
        .join(' ');
}

/**
 * Converts an ASM string to a Uint8Array.
 * @param asm The ASM string to convert.
 * @returns The converted Uint8Array.
 */
export function fromASM(asm: string): Script {
    if (typeof asm !== 'string') {
        throw new TypeError('Expected a string');
    }

    return compile(
        asm.split(' ').map((chunkStr) => {
            // opcode?
            if (opcodes[chunkStr as keyof Opcodes] !== undefined) {
                return opcodes[chunkStr as keyof Opcodes];
            }
            if (!types.isHex(chunkStr)) {
                throw new TypeError('Expected hex string');
            }

            // data!
            return fromHex(chunkStr);
        }),
    );
}

/**
 * Converts the given chunks into a stack of Uint8Arrays.
 *
 * @param chunks - The chunks to convert.
 * @returns The stack of Uint8Arrays.
 */
export function toStack(chunks: Uint8Array | Stack): Uint8Array[] {
    const resolved = chunksIsUint8Array(chunks) ? decompile(chunks) : chunks;
    if (!resolved || !isPushOnly(resolved)) {
        throw new TypeError('Expected push-only script');
    }

    return resolved.map((op) => {
        if (singleChunkIsUint8Array(op)) return op;
        if (op === opcodes.OP_0) return alloc(0);

        return scriptNumber.encode(op - OP_INT_BASE);
    });
}

export function isCanonicalPubKey(buffer: Uint8Array): boolean {
    return types.isPoint(buffer);
}

export function isCanonicalScriptSignature(buffer: Uint8Array): boolean {
    if (!(buffer instanceof Uint8Array)) return false;
    if (!isDefinedHashType(buffer[buffer.length - 1] as number)) return false;

    return bip66.check(buffer.subarray(0, -1));
}

export const number = scriptNumber;
export const signature = scriptSignature;
