import assert from 'assert';
import { describe, it } from 'vitest';
import { crypto as bcrypto } from '../src/index.js';
import type { TaggedHashPrefix } from '../src/crypto.js';
import { sha256, TAGGED_HASH_PREFIXES, TAGS } from '../src/crypto.js';
import fixtures from './fixtures/crypto.json' with { type: 'json' };
import { concat, equals, fromHex, fromUtf8, toHex } from '../src/io/index.js';

describe('crypto', () => {
    ['hash160', 'hash256', 'ripemd160', 'sha1', 'sha256'].forEach((algorithm) => {
        describe(algorithm, () => {
            fixtures.hashes.forEach((f) => {
                const fn = (bcrypto as any)[algorithm];
                const expected = (f as any)[algorithm];

                it('returns ' + expected + ' for ' + f.hex, () => {
                    const data = fromHex(f.hex);
                    const actual = toHex(fn(data));

                    assert.strictEqual(actual, expected);
                });
            });
        });
    });

    describe('taggedHash', () => {
        fixtures.taggedHash.forEach((f) => {
            const bytes = fromHex(f.hex);
            const expected = fromHex(f.result);
            it(`returns ${f.result} for taggedHash "${f.tag}" of ${f.hex}`, () => {
                const actual = bcrypto.taggedHash(f.tag as TaggedHashPrefix, bytes);
                assert.strictEqual(toHex(actual), toHex(expected));
            });
        });
    });

    describe('TAGGED_HASH_PREFIXES', () => {
        const taggedHashPrefixes = Object.fromEntries(
            TAGS.map((tag: TaggedHashPrefix) => {
                const tagHash = sha256(fromUtf8(tag));
                return [tag, concat([tagHash, tagHash])];
            }),
        );
        it('stored the result of operation', () => {
            // Compare that all keys match and all values are equal
            const storedKeys = Object.keys(TAGGED_HASH_PREFIXES);
            const computedKeys = Object.keys(taggedHashPrefixes);
            assert.deepStrictEqual(storedKeys.sort(), computedKeys.sort());

            for (const key of storedKeys) {
                assert.ok(
                    equals(TAGGED_HASH_PREFIXES[key as TaggedHashPrefix], taggedHashPrefixes[key] as Uint8Array),
                    `Mismatch for tag ${key}`,
                );
            }
        });
    });
});
