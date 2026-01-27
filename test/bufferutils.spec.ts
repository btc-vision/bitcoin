import assert from 'assert';
import { describe, it } from 'vitest';
import { BinaryReader, BinaryWriter, fromHex, toHex } from '../src/io/index.js';

import fixtures from './fixtures/bufferutils.json' with { type: 'json' };

import * as varuint from 'varuint-bitcoin';

describe('BinaryReader/BinaryWriter', () => {
    function concatToBuffer(values: number[][]): Uint8Array {
        const totalLength = values.reduce((sum, arr) => sum + arr.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const arr of values) {
            result.set(arr, offset);
            offset += arr.length;
        }
        return result;
    }

    describe('readUInt64LE', () => {
        fixtures.valid.forEach((f) => {
            it('decodes ' + f.hex, () => {
                const data = fromHex(f.hex);
                const reader = new BinaryReader(data);
                const num = reader.readUInt64LE();

                assert.strictEqual(Number(num), f.dec);
            });
        });
    });

    describe('writeUInt64LE', () => {
        fixtures.valid.forEach((f) => {
            it('encodes ' + f.dec, () => {
                const writer = new BinaryWriter(8);
                writer.writeUInt64LE(BigInt(f.dec));
                assert.strictEqual(toHex(writer.finish()), f.hex);
            });
        });
    });

    describe('BinaryWriter', () => {
        function testBuffer(
            writer: BinaryWriter,
            expectedData: Uint8Array,
            expectedOffset: number = expectedData.length,
        ): void {
            assert.strictEqual(writer.offset, expectedOffset);
            assert.deepStrictEqual(
                writer.data.slice(0, expectedOffset),
                expectedData.slice(0, expectedOffset),
            );
        }

        it('constructor with size', () => {
            const expectedData = fromHex('04030201');
            const writer = new BinaryWriter(4);
            writer.writeInt32LE(0x01020304);
            testBuffer(writer, expectedData);
        });

        it('writeUInt8', () => {
            const values = [0, 1, 254, 255];
            const expectedData = new Uint8Array([0, 1, 0xfe, 0xff]);
            const writer = new BinaryWriter(expectedData.length);
            values.forEach((v: number) => {
                const expectedOffset = writer.offset + 1;
                writer.writeUInt8(v);
                testBuffer(writer, expectedData, expectedOffset);
            });
            testBuffer(writer, expectedData);
        });

        it('writeInt32LE', () => {
            const values = [0, 1, Math.pow(2, 31) - 2, Math.pow(2, 31) - 1, -1, -Math.pow(2, 31)];
            const expectedData = concatToBuffer([
                [0, 0, 0, 0],
                [1, 0, 0, 0],
                [0xfe, 0xff, 0xff, 0x7f],
                [0xff, 0xff, 0xff, 0x7f],
                [0xff, 0xff, 0xff, 0xff],
                [0x00, 0x00, 0x00, 0x80],
            ]);
            const writer = new BinaryWriter(expectedData.length);
            values.forEach((value: number) => {
                const expectedOffset = writer.offset + 4;
                writer.writeInt32LE(value);
                testBuffer(writer, expectedData, expectedOffset);
            });
            testBuffer(writer, expectedData);
        });

        it('writeUInt32LE', () => {
            const maxUInt32 = Math.pow(2, 32) - 1;
            const values = [0, 1, Math.pow(2, 16), maxUInt32];
            const expectedData = concatToBuffer([
                [0, 0, 0, 0],
                [1, 0, 0, 0],
                [0, 0, 1, 0],
                [0xff, 0xff, 0xff, 0xff],
            ]);
            const writer = new BinaryWriter(expectedData.length);
            values.forEach((value: number) => {
                const expectedOffset = writer.offset + 4;
                writer.writeUInt32LE(value);
                testBuffer(writer, expectedData, expectedOffset);
            });
            testBuffer(writer, expectedData);
        });

        it('writeUInt64LE', () => {
            const values = [0n, 1n, BigInt(Math.pow(2, 32)), BigInt(Number.MAX_SAFE_INTEGER)];
            const expectedData = concatToBuffer([
                [0, 0, 0, 0, 0, 0, 0, 0],
                [1, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 1, 0, 0, 0],
                [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x1f, 0x00],
            ]);
            const writer = new BinaryWriter(expectedData.length);
            values.forEach((value: bigint) => {
                const expectedOffset = writer.offset + 8;
                writer.writeUInt64LE(value);
                testBuffer(writer, expectedData, expectedOffset);
            });
            testBuffer(writer, expectedData);
        });

        it('writeVarInt', () => {
            const values = [
                0,
                1,
                252,
                253,
                254,
                255,
                256,
                Math.pow(2, 16) - 2,
                Math.pow(2, 16) - 1,
                Math.pow(2, 16),
                Math.pow(2, 32) - 2,
                Math.pow(2, 32) - 1,
                Math.pow(2, 32),
                Number.MAX_SAFE_INTEGER,
            ];
            const expectedData = concatToBuffer([
                [0x00],
                [0x01],
                [0xfc],
                [0xfd, 0xfd, 0x00],
                [0xfd, 0xfe, 0x00],
                [0xfd, 0xff, 0x00],
                [0xfd, 0x00, 0x01],
                [0xfd, 0xfe, 0xff],
                [0xfd, 0xff, 0xff],
                [0xfe, 0x00, 0x00, 0x01, 0x00],
                [0xfe, 0xfe, 0xff, 0xff, 0xff],
                [0xfe, 0xff, 0xff, 0xff, 0xff],
                [0xff, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00],
                [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x1f, 0x00],
            ]);
            const writer = new BinaryWriter(expectedData.length);
            values.forEach((value: number) => {
                const expectedOffset = writer.offset + varuint.encodingLength(value);
                writer.writeVarInt(value);
                testBuffer(writer, expectedData, expectedOffset);
            });
            testBuffer(writer, expectedData);
        });

        it('writeBytes', () => {
            const values = [[], [1], [1, 2, 3, 4], [254, 255]];
            const expectedData = concatToBuffer(values);
            const writer = new BinaryWriter(expectedData.length);
            values.forEach((v: number[]) => {
                const expectedOffset = writer.offset + v.length;
                writer.writeBytes(new Uint8Array(v));
                testBuffer(writer, expectedData, expectedOffset);
            });
            testBuffer(writer, expectedData);
            assert.throws(() => {
                writer.writeBytes(new Uint8Array([0, 0]));
            }, /out of bounds|Cannot write|Write past end/);
        });

        it('writeVarBytes', () => {
            const values = [
                new Uint8Array(1).fill(1),
                new Uint8Array(252).fill(2),
                new Uint8Array(253).fill(3),
            ];
            const part1 = new Uint8Array([0x01, 0x01]);
            const part2 = new Uint8Array([0xfc, ...new Array(252).fill(0x02)]);
            const part3 = new Uint8Array([0xfd, 0xfd, 0x00, ...new Array(253).fill(0x03)]);
            const expectedData = new Uint8Array(part1.length + part2.length + part3.length);
            expectedData.set(part1, 0);
            expectedData.set(part2, part1.length);
            expectedData.set(part3, part1.length + part2.length);

            const writer = new BinaryWriter(expectedData.length);
            values.forEach((value: Uint8Array) => {
                const expectedOffset =
                    writer.offset + varuint.encodingLength(value.length) + value.length;
                writer.writeVarBytes(value);
                testBuffer(writer, expectedData, expectedOffset);
            });
            testBuffer(writer, expectedData);
        });

        it('writeVector', () => {
            const values = [
                [new Uint8Array(1).fill(4), new Uint8Array(253).fill(5)],
                Array(253).fill(new Uint8Array(1).fill(6)),
            ];

            // Build expected data manually
            const parts: Uint8Array[] = [];
            // First vector: count=2, then items
            parts.push(new Uint8Array([0x02]));
            parts.push(new Uint8Array([0x01, 0x04]));
            parts.push(new Uint8Array([0xfd, 0xfd, 0x00, ...new Array(253).fill(5)]));
            // Second vector: count=253, then 253 items of [0x01, 0x06]
            parts.push(new Uint8Array([0xfd, 0xfd, 0x00]));
            for (let i = 0; i < 253; i++) {
                parts.push(new Uint8Array([0x01, 0x06]));
            }

            const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
            const expectedData = new Uint8Array(totalLength);
            let offset = 0;
            for (const part of parts) {
                expectedData.set(part, offset);
                offset += part.length;
            }

            const writer = new BinaryWriter(expectedData.length);
            values.forEach((value: Uint8Array[]) => {
                const expectedOffset =
                    writer.offset +
                    varuint.encodingLength(value.length) +
                    value.reduce(
                        (sum: number, v) => sum + varuint.encodingLength(v.length) + v.length,
                        0,
                    );
                writer.writeVector(value);
                testBuffer(writer, expectedData, expectedOffset);
            });
            testBuffer(writer, expectedData);
        });

        it('finish', () => {
            const expected = fromHex('0403020108070605');
            const writer = new BinaryWriter(8);
            writer.writeUInt32LE(0x01020304);
            writer.writeUInt32LE(0x05060708);
            const result = writer.finish();
            testBuffer(writer, result);
            assert.deepStrictEqual(result, expected);
        });
    });

    describe('BinaryReader', () => {
        function testValue(
            reader: BinaryReader,
            value: Uint8Array | number | bigint,
            expectedValue: Uint8Array | number | bigint,
            expectedOffset: number = 0,
        ): void {
            assert.strictEqual(reader.offset, expectedOffset);
            if (value instanceof Uint8Array && expectedValue instanceof Uint8Array) {
                assert.deepStrictEqual(
                    value.slice(0, expectedOffset),
                    expectedValue.slice(0, expectedOffset),
                );
            } else {
                assert.strictEqual(value, expectedValue);
            }
        }

        it('readUInt8', () => {
            const values = [0, 1, 0xfe, 0xff];
            const data = new Uint8Array([0, 1, 0xfe, 0xff]);
            const reader = new BinaryReader(data);
            values.forEach((v: number) => {
                const expectedOffset = reader.offset + 1;
                const val = reader.readUInt8();
                testValue(reader, val, v, expectedOffset);
            });
        });

        it('readInt32LE', () => {
            const values = [0, 1, Math.pow(2, 31) - 2, Math.pow(2, 31) - 1, -1, -Math.pow(2, 31)];
            const data = concatToBuffer([
                [0, 0, 0, 0],
                [1, 0, 0, 0],
                [0xfe, 0xff, 0xff, 0x7f],
                [0xff, 0xff, 0xff, 0x7f],
                [0xff, 0xff, 0xff, 0xff],
                [0x00, 0x00, 0x00, 0x80],
            ]);
            const reader = new BinaryReader(data);
            values.forEach((value: number) => {
                const expectedOffset = reader.offset + 4;
                const val = reader.readInt32LE();
                testValue(reader, val, value, expectedOffset);
            });
        });

        it('readUInt32LE', () => {
            const maxUInt32 = Math.pow(2, 32) - 1;
            const values = [0, 1, Math.pow(2, 16), maxUInt32];
            const data = concatToBuffer([
                [0, 0, 0, 0],
                [1, 0, 0, 0],
                [0, 0, 1, 0],
                [0xff, 0xff, 0xff, 0xff],
            ]);
            const reader = new BinaryReader(data);
            values.forEach((value: number) => {
                const expectedOffset = reader.offset + 4;
                const val = reader.readUInt32LE();
                testValue(reader, val, value, expectedOffset);
            });
        });

        it('readUInt64LE', () => {
            const values = [0n, 1n, BigInt(Math.pow(2, 32)), BigInt(Number.MAX_SAFE_INTEGER)];
            const data = concatToBuffer([
                [0, 0, 0, 0, 0, 0, 0, 0],
                [1, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 1, 0, 0, 0],
                [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x1f, 0x00],
            ]);
            const reader = new BinaryReader(data);
            values.forEach((value: bigint) => {
                const expectedOffset = reader.offset + 8;
                const val = reader.readUInt64LE();
                testValue(reader, val, value, expectedOffset);
            });
        });

        it('readVarInt', () => {
            const values = [
                0,
                1,
                252,
                253,
                254,
                255,
                256,
                Math.pow(2, 16) - 2,
                Math.pow(2, 16) - 1,
                Math.pow(2, 16),
                Math.pow(2, 32) - 2,
                Math.pow(2, 32) - 1,
                Math.pow(2, 32),
                Number.MAX_SAFE_INTEGER,
            ];
            const data = concatToBuffer([
                [0x00],
                [0x01],
                [0xfc],
                [0xfd, 0xfd, 0x00],
                [0xfd, 0xfe, 0x00],
                [0xfd, 0xff, 0x00],
                [0xfd, 0x00, 0x01],
                [0xfd, 0xfe, 0xff],
                [0xfd, 0xff, 0xff],
                [0xfe, 0x00, 0x00, 0x01, 0x00],
                [0xfe, 0xfe, 0xff, 0xff, 0xff],
                [0xfe, 0xff, 0xff, 0xff, 0xff],
                [0xff, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00],
                [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x1f, 0x00],
            ]);
            const reader = new BinaryReader(data);
            values.forEach((value: number) => {
                const expectedOffset = reader.offset + varuint.encodingLength(value);
                const val = reader.readVarInt();
                testValue(reader, val, value, expectedOffset);
            });
        });

        it('readBytes', () => {
            const values = [[1], [1, 2, 3, 4], [254, 255]];
            const data = concatToBuffer(values);
            const reader = new BinaryReader(data);
            values.forEach((v: number[]) => {
                const expectedOffset = reader.offset + v.length;
                const val = reader.readBytes(v.length);
                assert.strictEqual(reader.offset, expectedOffset);
                assert.deepStrictEqual(Array.from(val), v);
            });
            assert.throws(() => {
                reader.readBytes(2);
            }, /past end|out of bounds/);
        });

        it('readVarBytes', () => {
            const values = [
                new Uint8Array(1).fill(1),
                new Uint8Array(252).fill(2),
                new Uint8Array(253).fill(3),
            ];
            const part1 = new Uint8Array([0x01, 0x01]);
            const part2 = new Uint8Array([0xfc, ...new Array(252).fill(0x02)]);
            const part3 = new Uint8Array([0xfd, 0xfd, 0x00, ...new Array(253).fill(0x03)]);
            const data = new Uint8Array(part1.length + part2.length + part3.length);
            data.set(part1, 0);
            data.set(part2, part1.length);
            data.set(part3, part1.length + part2.length);

            const reader = new BinaryReader(data);
            values.forEach((value: Uint8Array) => {
                const expectedOffset =
                    reader.offset + varuint.encodingLength(value.length) + value.length;
                const val = reader.readVarBytes();
                assert.strictEqual(reader.offset, expectedOffset);
                assert.deepStrictEqual(val, value);
            });
        });

        it('readVector', () => {
            const values = [
                [new Uint8Array(1).fill(4), new Uint8Array(253).fill(5)],
                Array(253).fill(new Uint8Array(1).fill(6)),
            ];

            // Build data manually
            const parts: Uint8Array[] = [];
            parts.push(new Uint8Array([0x02]));
            parts.push(new Uint8Array([0x01, 0x04]));
            parts.push(new Uint8Array([0xfd, 0xfd, 0x00, ...new Array(253).fill(5)]));
            parts.push(new Uint8Array([0xfd, 0xfd, 0x00]));
            for (let i = 0; i < 253; i++) {
                parts.push(new Uint8Array([0x01, 0x06]));
            }

            const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
            const data = new Uint8Array(totalLength);
            let offset = 0;
            for (const part of parts) {
                data.set(part, offset);
                offset += part.length;
            }

            const reader = new BinaryReader(data);
            values.forEach((value: Uint8Array[]) => {
                const expectedOffset =
                    reader.offset +
                    varuint.encodingLength(value.length) +
                    value.reduce(
                        (sum: number, v) => sum + varuint.encodingLength(v.length) + v.length,
                        0,
                    );
                const val = reader.readVector();
                assert.strictEqual(reader.offset, expectedOffset);
                assert.strictEqual(val.length, value.length);
                for (let i = 0; i < val.length; i++) {
                    assert.deepStrictEqual(val[i], value[i]);
                }
            });
        });
    });
});
