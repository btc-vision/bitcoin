"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const mocha_1 = require("mocha");
const scriptNumber = require("../src/script_number");
const fixtures = require("./fixtures/script_number.json");
(0, mocha_1.describe)('script-number', () => {
    (0, mocha_1.describe)('decode', () => {
        fixtures.forEach(f => {
            (0, mocha_1.it)(f.hex + ' returns ' + f.number, () => {
                const actual = scriptNumber.decode(Buffer.from(f.hex, 'hex'), f.bytes);
                assert.strictEqual(actual, f.number);
            });
        });
    });
    (0, mocha_1.describe)('encode', () => {
        fixtures.forEach(f => {
            (0, mocha_1.it)(f.number + ' returns ' + f.hex, () => {
                const actual = scriptNumber.encode(f.number);
                assert.strictEqual(actual.toString('hex'), f.hex);
            });
        });
    });
});
