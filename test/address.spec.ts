import assert from 'assert';
import { describe, it } from 'vitest';
import * as ecc from 'tiny-secp256k1';
import * as baddress from '../src/address.js';
import { fromBech32 } from '../src/bech32utils.js';
import * as bscript from '../src/script.js';
import fixtures from './fixtures/address.json' with { type: 'json' };

import type { EccLib } from '../src/index.js';
import { initEccLib } from '../src/index.js';
import type { Network } from '../src/networks.js';
import * as networks from '../src/networks.js';
import { fromHex, toHex } from '../src/io/index.js';
import type { Bytes20 } from '../src/types.js';

const NETWORKS: Record<string, Network> = Object.assign(
    {
        litecoin: {
            messagePrefix: '\x19Litecoin Signed Message:\n',
            bip32: {
                public: 0x019da462,
                private: 0x019d9cfe,
            },
            pubKeyHash: 0x30,
            scriptHash: 0x32,
            wif: 0xb0,
            bech32: 'ltc',
            bech32Opnet: 'opl',
        },
    },
    networks,
);

describe('address', () => {
    describe('fromBase58Check', () => {
        fixtures.standard.forEach((f) => {
            if (!f.base58check) return;

            it('decodes ' + f.base58check, () => {
                const decode = baddress.fromBase58Check(f.base58check);

                assert.strictEqual(decode.version, f.version);
                assert.strictEqual(toHex(decode.hash), f.hash);
            });
        });

        fixtures.invalid.fromBase58Check.forEach((f) => {
            it('throws on ' + f.exception, () => {
                assert.throws(
                    () => {
                        baddress.fromBase58Check(f.address);
                    },
                    new RegExp(f.address + ' ' + f.exception),
                );
            });
        });
    });

    describe('fromBech32', () => {
        fixtures.standard.forEach((f) => {
            if (!f.bech32) return;

            it('decodes ' + f.bech32, () => {
                const actual = fromBech32(f.bech32);

                assert.strictEqual(actual.version, f.version);
                // Support both bech32 and bech32Opnet prefixes
                const network = NETWORKS[f.network];
                assert.ok(network, `Unknown network: ${f.network}`);
                const validPrefixes = [network.bech32, network.bech32Opnet].filter(Boolean);
                assert.ok(
                    validPrefixes.includes(actual.prefix),
                    `Expected prefix to be one of [${validPrefixes.join(', ')}], got ${actual.prefix}`,
                );
                assert.strictEqual(toHex(actual.data), f.data);
            });
        });

        fixtures.invalid.bech32.forEach((f) => {
            it('decode fails for ' + f.address + '(' + f.exception + ')', () => {
                assert.throws(() => {
                    fromBech32(f.address);
                }, new RegExp(f.exception));
            });
        });
    });

    describe('fromOutputScript', () => {
        initEccLib(ecc as unknown as EccLib);
        fixtures.standard.forEach((f) => {
            it('encodes ' + f.script.slice(0, 30) + '... (' + f.network + ')', () => {
                const script = bscript.fromASM(f.script);
                const address = baddress.fromOutputScript(script, NETWORKS[f.network]);

                assert.strictEqual(address, f.base58check || f.bech32!.toLowerCase());
            });
        });

        /*fixtures.invalid.fromOutputScript.forEach((f) => {
            it('throws when ' + f.script.slice(0, 30) + '... ' + f.exception, () => {
                const script = bscript.fromASM(f.script);

                assert.throws(() => {
                    baddress.fromOutputScript(script, undefined);
                }, new RegExp(f.exception));
            });
        });*/
    });

    describe('toBase58Check', () => {
        fixtures.standard.forEach((f) => {
            if (!f.base58check) return;

            it('encodes ' + f.hash + ' (' + f.network + ')', () => {
                const address = baddress.toBase58Check(fromHex(f.hash) as Bytes20, f.version);

                assert.strictEqual(address, f.base58check);
            });
        });
    });

    describe('toBech32', () => {
        fixtures.bech32.forEach((f) => {
            if (!f.address) return;
            const data = fromHex(f.data);

            it('encode ' + f.address, () => {
                assert.deepStrictEqual(
                    baddress.toBech32(data, f.version, f.prefix),
                    f.address.toLowerCase(),
                );
            });
        });

        // TODO: These fixtures (according to TypeScript) have none of the data used below
        fixtures.invalid.bech32.forEach((f: any) => {
            if (!f.prefix || f.version === undefined || f.data === undefined) return;

            it('encode fails (' + f.exception, () => {
                assert.throws(() => {
                    baddress.toBech32(fromHex(f.data), f.version, f.prefix);
                }, new RegExp(f.exception));
            });
        });
    });

    describe('toOutputScript', () => {
        fixtures.standard.forEach((f) => {
            it('decodes ' + f.script.slice(0, 30) + '... (' + f.network + ')', () => {
                const script = baddress.toOutputScript(
                    (f.base58check || f.bech32)!,
                    NETWORKS[f.network],
                );

                assert.strictEqual(bscript.toASM(script), f.script);
            });
        });

        /*fixtures.invalid.toOutputScript.forEach((f) => {
            it('throws when ' + (f.exception || f.paymentException), () => {
                const exception = f.paymentException || `${f.address} ${f.exception}`;
                assert.throws(() => {
                    baddress.toOutputScript(f.address, f.network as any);
                }, new RegExp(exception));
            });
        });*/
    });
});
