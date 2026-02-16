import assert from 'assert';
import * as ecc from 'tiny-secp256k1';
import { beforeEach, describe, it } from 'vitest';
import type { EccLib } from '../src/index.js';
import { initEccLib } from '../src/index.js';
import type { P2SHPayment, PaymentCreator } from '../src/payments/index.js';
import { p2pk, p2wsh } from '../src/payments/index.js';
import * as u from './payments.utils.js';
import fs from 'node:fs';
import { fromHex } from '../src/io/index.js';
import type { PublicKey } from '../src/types.js';

// Pre-load all payment modules synchronously-like at import time
import * as embedModule from '../src/payments/embed.js';
import * as p2msModule from '../src/payments/p2ms.js';
import * as p2pkModule from '../src/payments/p2pk.js';
import * as p2pkhModule from '../src/payments/p2pkh.js';
import * as p2shModule from '../src/payments/p2sh.js';
import * as p2wpkhModule from '../src/payments/p2wpkh.js';
import * as p2wshModule from '../src/payments/p2wsh.js';
import * as p2trModule from '../src/payments/p2tr.js';
import * as p2mrModule from '../src/payments/p2mr.js';

const paymentModules: Record<string, { [key: string]: PaymentCreator }> = {
    embed: embedModule as any,
    p2ms: p2msModule as any,
    p2pk: p2pkModule as any,
    p2pkh: p2pkhModule as any,
    p2sh: p2shModule as any,
    p2wpkh: p2wpkhModule as any,
    p2wsh: p2wshModule as any,
    p2tr: p2trModule as any,
    p2mr: p2mrModule as any,
};

// Initialize ECC library at module load time
initEccLib(ecc as unknown as EccLib);

['embed', 'p2ms', 'p2pk', 'p2pkh', 'p2sh', 'p2wpkh', 'p2wsh', 'p2tr', 'p2mr'].forEach((p) => {
    describe(p, () => {
        // Ensure ECC library is initialized before each test
        beforeEach(() => {
            initEccLib(ecc as unknown as EccLib);
        });

        const payment = paymentModules[p]!;
        let fn: PaymentCreator;
        if (p === 'embed') {
            fn = payment['p2data']!;
        } else {
            fn = payment[p]!;
        }

        const fixtures = JSON.parse(fs.readFileSync('test/fixtures/' + p + '.json', 'utf8'));
        fixtures.valid.forEach((f: any) => {
            it(f.description + ' as expected', () => {
                const args = u.preform(f.arguments);
                const actual = fn(args, f.options);

                u.equate(actual, f.expected, f.arguments);
            });

            it(f.description + ' as expected (no validation)', () => {
                const args = u.preform(f.arguments);
                const actual = fn(
                    args,
                    Object.assign({}, f.options, {
                        validate: false,
                    }),
                );

                u.equate(actual, f.expected, f.arguments);
            });
        });

        /*fixtures.invalid.forEach((f: any) => {
            it('throws ' + f.exception + (f.description ? 'for ' + f.description : ''), () => {
                const args = u.preform(f.arguments);

                assert.throws(() => {
                    fn(args, f.options);
                }, new RegExp(f.exception));
            });
        });*/

        if (p === 'p2sh') {
            it('properly assembles nested p2wsh with names', () => {
                const actual = fn({
                    redeem: p2wsh({
                        redeem: p2pk({
                            pubkey: fromHex(
                                '03e15819590382a9dd878f01e2f0cbce541564eb415e43b440472d883ecd283058',
                            ) as PublicKey,
                        }),
                    }),
                } as P2SHPayment);
                assert.strictEqual(actual.address, '3MGbrbye4ttNUXM8WAvBFRKry4fkS9fjuw');
                assert.strictEqual(actual.name, 'p2sh-p2wsh-p2pk');
                assert.strictEqual(actual.redeem!.name, 'p2wsh-p2pk');
                assert.strictEqual(actual.redeem!.redeem!.name, 'p2pk');
            });
        }

        // cross-verify dynamically too
        if (!fixtures.dynamic) return;
        const { depends, details } = fixtures.dynamic;

        details.forEach((f: any) => {
            const detail = u.preform(f);
            const disabled: any = {};
            if (f.disabled)
                f.disabled.forEach((k: string) => {
                    disabled[k] = true;
                });

            for (const key in depends) {
                if (key in disabled) continue;
                const dependencies = depends[key];

                dependencies.forEach((dependency: any) => {
                    if (!Array.isArray(dependency)) dependency = [dependency];

                    const args = {};
                    dependency.forEach((d: any) => {
                        u.from(d, detail, args);
                    });
                    const expected = u.from(key, detail);

                    it(
                        f.description + ', ' + key + ' derives from ' + JSON.stringify(dependency),
                        () => {
                            u.equate(fn(args), expected);
                        },
                    );
                });
            }
        });
    });
});
