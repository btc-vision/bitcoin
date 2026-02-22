import assert from 'assert';
import { describe, it, beforeEach } from 'vitest';
import * as ecc from 'tiny-secp256k1';
import * as networks from '../src/networks.js';
import * as address from '../src/address.js';
import { fromBech32 } from '../src/bech32utils.js';
import { p2pkh } from '../src/payments/p2pkh.js';
import { p2wpkh } from '../src/payments/p2wpkh.js';
import { p2wsh } from '../src/payments/p2wsh.js';
import { p2tr } from '../src/payments/p2tr.js';
import type { EccLib } from '../src/index.js';
import { initEccLib } from '../src/index.js';
import { fromHex, toHex } from '../src/io/index.js';
import type { PublicKey, XOnlyPublicKey } from '../src/types.js';
import { toBytes32 } from '../src/types.js';

// A fixed compressed public key for deterministic tests
const PUBKEY = fromHex(
    '030000000000000000000000000000000000000000000000000000000000000001',
) as PublicKey;
// x-only form (drop the 03 prefix)
const XONLY_PUBKEY = PUBKEY.subarray(1) as XOnlyPublicKey;

describe('opnetTestnet network', () => {
    beforeEach(() => {
        initEccLib(ecc as unknown as EccLib);
    });

    describe('network constant', () => {
        it('is exported and has correct bech32 prefix', () => {
            assert.strictEqual(networks.opnetTestnet.bech32, 'opt');
        });

        it('has correct bech32Opnet prefix', () => {
            assert.strictEqual(networks.opnetTestnet.bech32Opnet, 'opt');
        });

        it('bech32 and bech32Opnet are identical', () => {
            assert.strictEqual(
                networks.opnetTestnet.bech32,
                networks.opnetTestnet.bech32Opnet,
            );
        });

        it('has correct messagePrefix', () => {
            assert.strictEqual(
                networks.opnetTestnet.messagePrefix,
                '\x18Bitcoin Signed Message:\n',
            );
        });

        it('shares version bytes with testnet', () => {
            assert.strictEqual(
                networks.opnetTestnet.pubKeyHash,
                networks.testnet.pubKeyHash,
            );
            assert.strictEqual(
                networks.opnetTestnet.scriptHash,
                networks.testnet.scriptHash,
            );
            assert.strictEqual(networks.opnetTestnet.wif, networks.testnet.wif);
        });

        it('shares bip32 values with testnet', () => {
            assert.deepStrictEqual(
                networks.opnetTestnet.bip32,
                networks.testnet.bip32,
            );
        });

        it('has different bech32 prefix than testnet', () => {
            assert.notStrictEqual(
                networks.opnetTestnet.bech32,
                networks.testnet.bech32,
            );
        });

        it('is accessible via the networks namespace', () => {
            assert.ok(
                (networks as Record<string, unknown>)['opnetTestnet'] !==
                    undefined,
            );
        });
    });

    describe('P2PKH (base58)', () => {
        it('produces addresses starting with m or n (same as testnet)', () => {
            const payment = p2pkh({
                pubkey: PUBKEY,
                network: networks.opnetTestnet,
            });
            assert.ok(payment.address);
            assert.ok(
                payment.address.startsWith('m') ||
                    payment.address.startsWith('n'),
                `Expected address starting with m or n, got ${payment.address}`,
            );
        });

        it('produces same address as testnet for same pubkey', () => {
            const opnetAddr = p2pkh({
                pubkey: PUBKEY,
                network: networks.opnetTestnet,
            }).address;
            const testnetAddr = p2pkh({
                pubkey: PUBKEY,
                network: networks.testnet,
            }).address;
            assert.strictEqual(opnetAddr, testnetAddr);
        });
    });

    describe('P2WPKH (segwit v0)', () => {
        it('produces addresses starting with opt1q', () => {
            const payment = p2wpkh({
                pubkey: PUBKEY,
                network: networks.opnetTestnet,
            });
            assert.ok(payment.address);
            assert.ok(
                payment.address.startsWith('opt1q'),
                `Expected address starting with opt1q, got ${payment.address}`,
            );
        });

        it('differs from testnet P2WPKH address (tb1q vs opt1q)', () => {
            const opnetAddr = p2wpkh({
                pubkey: PUBKEY,
                network: networks.opnetTestnet,
            }).address;
            const testnetAddr = p2wpkh({
                pubkey: PUBKEY,
                network: networks.testnet,
            }).address;
            assert.ok(opnetAddr);
            assert.ok(testnetAddr);
            assert.ok(opnetAddr.startsWith('opt1q'));
            assert.ok(testnetAddr.startsWith('tb1q'));
            assert.notStrictEqual(opnetAddr, testnetAddr);
        });

        it('round-trips through toOutputScript and fromOutputScript', () => {
            const payment = p2wpkh({
                pubkey: PUBKEY,
                network: networks.opnetTestnet,
            });
            const script = address.toOutputScript(
                payment.address!,
                networks.opnetTestnet,
            );
            const recovered = address.fromOutputScript(
                script,
                networks.opnetTestnet,
            );
            assert.strictEqual(recovered, payment.address);
        });
    });

    describe('P2WSH (segwit v0)', () => {
        it('produces addresses starting with opt1q', () => {
            const hash = toBytes32(
                fromHex(
                    'ab610d22c801def8a1e02368d1b92018970eb52a729919705e8a1a2f60c750f5',
                ),
            );
            const payment = p2wsh({
                hash,
                network: networks.opnetTestnet,
            });
            assert.ok(payment.address);
            assert.ok(
                payment.address.startsWith('opt1q'),
                `Expected address starting with opt1q, got ${payment.address}`,
            );
        });
    });

    describe('P2TR (segwit v1, taproot)', () => {
        it('produces addresses starting with opt1p', () => {
            const payment = p2tr({
                pubkey: XONLY_PUBKEY,
                network: networks.opnetTestnet,
            });
            assert.ok(payment.address);
            assert.ok(
                payment.address.startsWith('opt1p'),
                `Expected address starting with opt1p, got ${payment.address}`,
            );
        });

        it('differs from testnet P2TR address (tb1p vs opt1p)', () => {
            const opnetAddr = p2tr({
                pubkey: XONLY_PUBKEY,
                network: networks.opnetTestnet,
            }).address;
            const testnetAddr = p2tr({
                pubkey: XONLY_PUBKEY,
                network: networks.testnet,
            }).address;
            assert.ok(opnetAddr);
            assert.ok(testnetAddr);
            assert.ok(opnetAddr.startsWith('opt1p'));
            assert.ok(testnetAddr.startsWith('tb1p'));
        });

        it('round-trips through toOutputScript and fromOutputScript', () => {
            const payment = p2tr({
                pubkey: XONLY_PUBKEY,
                network: networks.opnetTestnet,
            });
            const script = address.toOutputScript(
                payment.address!,
                networks.opnetTestnet,
            );
            const recovered = address.fromOutputScript(
                script,
                networks.opnetTestnet,
            );
            assert.strictEqual(recovered, payment.address);
        });
    });

    describe('bech32 encode/decode', () => {
        it('toBech32 encodes with opt prefix for segwit v0', () => {
            const hash = fromHex(
                'ea6d525c0c955d90d3dbd29a81ef8bfb79003727',
            );
            const encoded = address.toBech32(hash, 0, 'opt');
            assert.ok(encoded.startsWith('opt1q'));
        });

        it('fromBech32 decodes opt-prefixed address', () => {
            const hash = fromHex(
                'ea6d525c0c955d90d3dbd29a81ef8bfb79003727',
            );
            const encoded = address.toBech32(hash, 0, 'opt');
            const decoded = fromBech32(encoded);
            assert.strictEqual(decoded.prefix, 'opt');
            assert.strictEqual(decoded.version, 0);
            assert.strictEqual(toHex(decoded.data), toHex(hash));
        });
    });

    describe('toOutputScript prefix validation', () => {
        it('accepts opt-prefixed address for opnetTestnet', () => {
            const payment = p2wpkh({
                pubkey: PUBKEY,
                network: networks.opnetTestnet,
            });
            assert.doesNotThrow(() => {
                address.toOutputScript(
                    payment.address!,
                    networks.opnetTestnet,
                );
            });
        });

        it('rejects tb-prefixed address for opnetTestnet', () => {
            const testnetPayment = p2wpkh({
                pubkey: PUBKEY,
                network: networks.testnet,
            });
            assert.throws(() => {
                address.toOutputScript(
                    testnetPayment.address!,
                    networks.opnetTestnet,
                );
            }, /has an invalid prefix/);
        });

        it('accepts opt-prefixed address for testnet (opt is testnet bech32Opnet)', () => {
            // testnet has bech32Opnet: 'opt', so opt-prefixed addresses are valid
            const opnetPayment = p2wpkh({
                pubkey: PUBKEY,
                network: networks.opnetTestnet,
            });
            const script = address.toOutputScript(
                opnetPayment.address!,
                networks.testnet,
            );
            // Should produce the same output script regardless of which network decodes it
            const scriptFromOpnet = address.toOutputScript(
                opnetPayment.address!,
                networks.opnetTestnet,
            );
            assert.deepStrictEqual(script, scriptFromOpnet);
        });

        it('rejects bc-prefixed address for opnetTestnet', () => {
            const mainnetPayment = p2wpkh({
                pubkey: PUBKEY,
                network: networks.bitcoin,
            });
            assert.throws(() => {
                address.toOutputScript(
                    mainnetPayment.address!,
                    networks.opnetTestnet,
                );
            }, /has an invalid prefix/);
        });
    });
});
