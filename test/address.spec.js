"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const mocha_1 = require("mocha");
const ecc = require("tiny-secp256k1");
const baddress = require("../src/address");
const bscript = require("../src/script");
const fixtures = require("./fixtures/address.json");
const src_1 = require("../src");
const NETWORKS = Object.assign({
    litecoin: {
        messagePrefix: '\x19Litecoin Signed Message:\n',
        bip32: {
            public: 0x019da462,
            private: 0x019d9cfe,
        },
        pubKeyHash: 0x30,
        scriptHash: 0x32,
        wif: 0xb0,
    },
}, require('../src/networks'));
(0, mocha_1.describe)('address', () => {
    (0, mocha_1.describe)('fromBase58Check', () => {
        fixtures.standard.forEach(f => {
            if (!f.base58check)
                return;
            (0, mocha_1.it)('decodes ' + f.base58check, () => {
                const decode = baddress.fromBase58Check(f.base58check);
                assert.strictEqual(decode.version, f.version);
                assert.strictEqual(decode.hash.toString('hex'), f.hash);
            });
        });
        fixtures.invalid.fromBase58Check.forEach(f => {
            (0, mocha_1.it)('throws on ' + f.exception, () => {
                assert.throws(() => {
                    baddress.fromBase58Check(f.address);
                }, new RegExp(f.address + ' ' + f.exception));
            });
        });
    });
    (0, mocha_1.describe)('fromBech32', () => {
        fixtures.standard.forEach(f => {
            if (!f.bech32)
                return;
            (0, mocha_1.it)('decodes ' + f.bech32, () => {
                const actual = baddress.fromBech32(f.bech32);
                assert.strictEqual(actual.version, f.version);
                assert.strictEqual(actual.prefix, NETWORKS[f.network].bech32);
                assert.strictEqual(actual.data.toString('hex'), f.data);
            });
        });
        fixtures.invalid.bech32.forEach(f => {
            (0, mocha_1.it)('decode fails for ' + f.address + '(' + f.exception + ')', () => {
                assert.throws(() => {
                    baddress.fromBech32(f.address);
                }, new RegExp(f.exception));
            });
        });
    });
    (0, mocha_1.describe)('fromOutputScript', () => {
        (0, src_1.initEccLib)(ecc);
        fixtures.standard.forEach(f => {
            (0, mocha_1.it)('encodes ' + f.script.slice(0, 30) + '... (' + f.network + ')', () => {
                const script = bscript.fromASM(f.script);
                const address = baddress.fromOutputScript(script, NETWORKS[f.network]);
                assert.strictEqual(address, f.base58check || f.bech32.toLowerCase());
            });
        });
        fixtures.invalid.fromOutputScript.forEach(f => {
            (0, mocha_1.it)('throws when ' + f.script.slice(0, 30) + '... ' + f.exception, () => {
                const script = bscript.fromASM(f.script);
                assert.throws(() => {
                    baddress.fromOutputScript(script, undefined);
                }, new RegExp(f.exception));
            });
        });
    });
    (0, mocha_1.describe)('toBase58Check', () => {
        fixtures.standard.forEach(f => {
            if (!f.base58check)
                return;
            (0, mocha_1.it)('encodes ' + f.hash + ' (' + f.network + ')', () => {
                const address = baddress.toBase58Check(Buffer.from(f.hash, 'hex'), f.version);
                assert.strictEqual(address, f.base58check);
            });
        });
    });
    (0, mocha_1.describe)('toBech32', () => {
        fixtures.bech32.forEach(f => {
            if (!f.address)
                return;
            const data = Buffer.from(f.data, 'hex');
            (0, mocha_1.it)('encode ' + f.address, () => {
                assert.deepStrictEqual(baddress.toBech32(data, f.version, f.prefix), f.address.toLowerCase());
            });
        });
        // TODO: These fixtures (according to TypeScript) have none of the data used below
        fixtures.invalid.bech32.forEach((f) => {
            if (!f.prefix || f.version === undefined || f.data === undefined)
                return;
            (0, mocha_1.it)('encode fails (' + f.exception, () => {
                assert.throws(() => {
                    baddress.toBech32(Buffer.from(f.data, 'hex'), f.version, f.prefix);
                }, new RegExp(f.exception));
            });
        });
    });
    (0, mocha_1.describe)('toOutputScript', () => {
        fixtures.standard.forEach(f => {
            (0, mocha_1.it)('decodes ' + f.script.slice(0, 30) + '... (' + f.network + ')', () => {
                const script = baddress.toOutputScript((f.base58check || f.bech32), NETWORKS[f.network]);
                assert.strictEqual(bscript.toASM(script), f.script);
            });
        });
        fixtures.invalid.toOutputScript.forEach(f => {
            (0, mocha_1.it)('throws when ' + (f.exception || f.paymentException), () => {
                const exception = f.paymentException || `${f.address} ${f.exception}`;
                assert.throws(() => {
                    baddress.toOutputScript(f.address, f.network);
                }, new RegExp(exception));
            });
        });
    });
});
