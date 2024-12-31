"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const mocha_1 = require("mocha");
const script_1 = require("../src/script");
const fixtures = require("./fixtures/signature.json");
(0, mocha_1.describe)('Script Signatures', () => {
    function fromRaw(signature) {
        return Buffer.concat([Buffer.from(signature.r, 'hex'), Buffer.from(signature.s, 'hex')], 64);
    }
    function toRaw(signature) {
        return {
            r: signature.slice(0, 32).toString('hex'),
            s: signature.slice(32, 64).toString('hex'),
        };
    }
    (0, mocha_1.describe)('encode', () => {
        fixtures.valid.forEach(f => {
            (0, mocha_1.it)('encodes ' + f.hex, () => {
                const buffer = script_1.signature.encode(fromRaw(f.raw), f.hashType);
                assert.strictEqual(buffer.toString('hex'), f.hex);
            });
        });
        fixtures.invalid.forEach(f => {
            if (!f.raw)
                return;
            (0, mocha_1.it)('throws ' + f.exception, () => {
                const signature = fromRaw(f.raw);
                assert.throws(() => {
                    script_1.signature.encode(signature, f.hashType);
                }, new RegExp(f.exception));
            });
        });
    });
    (0, mocha_1.describe)('decode', () => {
        fixtures.valid.forEach(f => {
            (0, mocha_1.it)('decodes ' + f.hex, () => {
                const decode = script_1.signature.decode(Buffer.from(f.hex, 'hex'));
                assert.deepStrictEqual(toRaw(decode.signature), f.raw);
                assert.strictEqual(decode.hashType, f.hashType);
            });
        });
        fixtures.invalid.forEach(f => {
            (0, mocha_1.it)('throws on ' + f.hex, () => {
                const buffer = Buffer.from(f.hex, 'hex');
                assert.throws(() => {
                    script_1.signature.decode(buffer);
                }, new RegExp(f.exception));
            });
        });
    });
});
