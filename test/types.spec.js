"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const mocha_1 = require("mocha");
const types = require("../src/types");
const typeforce = require('typeforce');
(0, mocha_1.describe)('types', () => {
    (0, mocha_1.describe)('Buffer Hash160/Hash256', () => {
        const buffer20byte = Buffer.alloc(20);
        const buffer32byte = Buffer.alloc(32);
        (0, mocha_1.it)('return true for valid size', () => {
            assert(types.Hash160bit(buffer20byte));
            assert(types.Hash256bit(buffer32byte));
        });
        (0, mocha_1.it)('return true for oneOf', () => {
            assert.doesNotThrow(() => {
                typeforce(types.oneOf(types.Hash160bit, types.Hash256bit), buffer32byte);
            });
            assert.doesNotThrow(() => {
                typeforce(types.oneOf(types.Hash256bit, types.Hash160bit), buffer32byte);
            });
        });
        (0, mocha_1.it)('throws for invalid size', () => {
            assert.throws(() => {
                types.Hash160bit(buffer32byte);
            }, /Expected Buffer\(Length: 20\), got Buffer\(Length: 32\)/);
            assert.throws(() => {
                types.Hash256bit(buffer20byte);
            }, /Expected Buffer\(Length: 32\), got Buffer\(Length: 20\)/);
        });
    });
    (0, mocha_1.describe)('Satoshi', () => {
        [
            { value: -1, result: false },
            { value: 0, result: true },
            { value: 1, result: true },
            { value: 20999999 * 1e8, result: true },
            { value: 21000000 * 1e8, result: true },
            { value: 21000001 * 1e8, result: false },
        ].forEach(f => {
            (0, mocha_1.it)('returns ' + f.result + ' for valid for ' + f.value, () => {
                assert.strictEqual(types.Satoshi(f.value), f.result);
            });
        });
    });
});
