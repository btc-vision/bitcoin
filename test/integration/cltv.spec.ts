import assert from 'assert';
import { beforeAll, describe, it } from 'vitest';
import type { Bytes32, Satoshi, Script } from '../../src/index.js';
import * as bitcoin from '../../src/index.js';
import { fromHex, reverseCopy, toHex } from '../../src/index.js';
import { regtestUtils } from './_regtest.js';

// @ts-ignore
import bip65 from 'bip65';
import { ECPairSigner, createNobleBackend } from '@btc-vision/ecpair';
import type { Network } from '../../src/networks.js';

const backend = createNobleBackend();
const ECPair = {
    fromWIF: (wif: string, network?: Network | Network[]) =>
        ECPairSigner.fromWIF(backend, wif, network ?? bitcoin.networks.bitcoin),
};
const regtest = regtestUtils.network;

function toOutputScript(address: string): Script {
    return bitcoin.address.toOutputScript(address, regtest);
}

function idToHash(txid: string): Bytes32 {
    return reverseCopy(fromHex(txid)) as Bytes32;
}

const alice = ECPair.fromWIF('cScfkGjbzzoeewVWmU2hYPUHeVGJRDdFt7WhmrVVGkxpmPP8BHWe', regtest);
const bob = ECPair.fromWIF('cMkopUXKWsEzAjfa1zApksGRwjVpJRB3831qM9W4gKZsLwjHXA9x', regtest);

describe('bitcoinjs-lib (transactions w/ CLTV)', () => {
    // force update MTP
    beforeAll(async () => {
        await regtestUtils.mine(11);
    });

    const hashType = bitcoin.Transaction.SIGHASH_ALL;

    interface KeyPair {
        publicKey: Uint8Array;
    }

    function cltvCheckSigOutput(aQ: KeyPair, bQ: KeyPair, lockTime: number): Script {
        return bitcoin.script.fromASM(
            `
      OP_IF
          ${bitcoin.script.number.encode(lockTime).toString('hex')}
          OP_CHECKLOCKTIMEVERIFY
          OP_DROP
      OP_ELSE
          ${toHex(bQ.publicKey)}
          OP_CHECKSIGVERIFY
      OP_ENDIF
      ${toHex(aQ.publicKey)}
      OP_CHECKSIG
    `
                .trim()
                .replace(/\s+/g, ' '),
        );
    }

    function utcNow(): number {
        return Math.floor(Date.now() / 1000);
    }

    // expiry past, {Alice's signature} OP_TRUE
    it(
        'can create (and broadcast via 3PBP) a Transaction where Alice can redeem ' +
            'the output after the expiry (in the past)',
        async () => {
            // 3 hours ago
            const lockTime = bip65.encode({ utc: utcNow() - 3600 * 3 });
            const redeemScript = cltvCheckSigOutput(alice, bob, lockTime);
            const { address } = bitcoin.payments.p2sh({
                redeem: { output: redeemScript, network: regtest },
                network: regtest,
            });

            // fund the P2SH(CLTV) address
            const unspent = await regtestUtils.faucet(address!, 1e5);
            const tx = new bitcoin.Transaction();
            tx.locktime = lockTime;
            // Note: nSequence MUST be <= 0xfffffffe otherwise OP_CHECKLOCKTIMEVERIFY will fail.
            tx.addInput(idToHash(unspent.txId), unspent.vout, 0xfffffffe);
            tx.addOutput(toOutputScript(regtestUtils.RANDOM_ADDRESS), 70000n as Satoshi);

            // {Alice's signature} OP_TRUE
            const signatureHash = tx.hashForSignature(0, redeemScript, hashType);
            const redeemScriptSig = bitcoin.payments.p2sh({
                redeem: {
                    input: bitcoin.script.compile([
                        bitcoin.script.signature.encode(alice.sign(signatureHash), hashType),
                        bitcoin.opcodes.OP_TRUE,
                    ]),
                    output: redeemScript,
                },
            }).input;
            tx.setInputScript(0, redeemScriptSig! as Script);

            await regtestUtils.broadcast(tx.toHex());

            await regtestUtils.verify({
                txId: tx.getId(),
                address: regtestUtils.RANDOM_ADDRESS,
                vout: 0,
                value: 7e4,
            });
        },
    );

    // expiry will pass, {Alice's signature} OP_TRUE
    it(
        'can create (and broadcast via 3PBP) a Transaction where Alice can redeem ' +
            'the output after the expiry (in the future)',
        async () => {
            const height = await regtestUtils.height();
            // 5 blocks from now
            const lockTime = bip65.encode({ blocks: height + 5 });
            const redeemScript = cltvCheckSigOutput(alice, bob, lockTime);
            const { address } = bitcoin.payments.p2sh({
                redeem: { output: redeemScript, network: regtest },
                network: regtest,
            });

            // fund the P2SH(CLTV) address
            const unspent = await regtestUtils.faucet(address!, 1e5);
            const tx = new bitcoin.Transaction();
            tx.locktime = lockTime;
            // Note: nSequence MUST be <= 0xfffffffe otherwise OP_CHECKLOCKTIMEVERIFY will fail.
            tx.addInput(idToHash(unspent.txId), unspent.vout, 0xfffffffe);
            tx.addOutput(toOutputScript(regtestUtils.RANDOM_ADDRESS), 70000n as Satoshi);

            // {Alice's signature} OP_TRUE
            const signatureHash = tx.hashForSignature(0, redeemScript, hashType);
            const redeemScriptSig = bitcoin.payments.p2sh({
                redeem: {
                    input: bitcoin.script.compile([
                        bitcoin.script.signature.encode(alice.sign(signatureHash), hashType),
                        bitcoin.opcodes.OP_TRUE,
                    ]),
                    output: redeemScript,
                },
            }).input;
            tx.setInputScript(0, redeemScriptSig! as Script);

            // TODO: test that it failures _prior_ to expiry, unfortunately, race conditions when run concurrently
            // ...
            // into the future!
            await regtestUtils.mine(5);
            await regtestUtils.broadcast(tx.toHex());
            await regtestUtils.verify({
                txId: tx.getId(),
                address: regtestUtils.RANDOM_ADDRESS,
                vout: 0,
                value: 7e4,
            });
        },
    );

    // expiry ignored, {Bob's signature} {Alice's signature} OP_FALSE
    it(
        'can create (and broadcast via 3PBP) a Transaction where Alice and Bob can ' +
            'redeem the output at any time',
        async () => {
            // two hours ago
            const lockTime = bip65.encode({ utc: utcNow() - 3600 * 2 });
            const redeemScript = cltvCheckSigOutput(alice, bob, lockTime);
            const { address } = bitcoin.payments.p2sh({
                redeem: { output: redeemScript, network: regtest },
                network: regtest,
            });

            // fund the P2SH(CLTV) address
            const unspent = await regtestUtils.faucet(address!, 2e5);
            const tx = new bitcoin.Transaction();
            tx.locktime = lockTime;
            // Note: nSequence MUST be <= 0xfffffffe otherwise OP_CHECKLOCKTIMEVERIFY will fail.
            tx.addInput(idToHash(unspent.txId), unspent.vout, 0xfffffffe);
            tx.addOutput(toOutputScript(regtestUtils.RANDOM_ADDRESS), 80000n as Satoshi);

            // {Alice's signature} {Bob's signature} OP_FALSE
            const signatureHash = tx.hashForSignature(0, redeemScript, hashType);
            const redeemScriptSig = bitcoin.payments.p2sh({
                redeem: {
                    input: bitcoin.script.compile([
                        bitcoin.script.signature.encode(alice.sign(signatureHash), hashType),
                        bitcoin.script.signature.encode(bob.sign(signatureHash), hashType),
                        bitcoin.opcodes.OP_FALSE,
                    ]),
                    output: redeemScript,
                },
            }).input;
            tx.setInputScript(0, redeemScriptSig! as Script);

            await regtestUtils.broadcast(tx.toHex());
            await regtestUtils.verify({
                txId: tx.getId(),
                address: regtestUtils.RANDOM_ADDRESS,
                vout: 0,
                value: 8e4,
            });
        },
    );

    // expiry in the future, {Alice's signature} OP_TRUE
    it(
        'can create (but fail to broadcast via 3PBP) a Transaction where Alice ' +
            'attempts to redeem before the expiry',
        async () => {
            // two hours from now
            const lockTime = bip65.encode({ utc: utcNow() + 3600 * 2 });
            const redeemScript = cltvCheckSigOutput(alice, bob, lockTime);
            const { address } = bitcoin.payments.p2sh({
                redeem: { output: redeemScript, network: regtest },
                network: regtest,
            });

            // fund the P2SH(CLTV) address
            const unspent = await regtestUtils.faucet(address!, 2e4);
            const tx = new bitcoin.Transaction();
            tx.locktime = lockTime;
            // Note: nSequence MUST be <= 0xfffffffe otherwise OP_CHECKLOCKTIMEVERIFY will fail.
            tx.addInput(idToHash(unspent.txId), unspent.vout, 0xfffffffe);
            tx.addOutput(toOutputScript(regtestUtils.RANDOM_ADDRESS), 10000n as Satoshi);

            // {Alice's signature} OP_TRUE
            const signatureHash = tx.hashForSignature(0, redeemScript, hashType);
            const redeemScriptSig = bitcoin.payments.p2sh({
                redeem: {
                    input: bitcoin.script.compile([
                        bitcoin.script.signature.encode(alice.sign(signatureHash), hashType),
                        bitcoin.script.signature.encode(bob.sign(signatureHash), hashType),
                        bitcoin.opcodes.OP_TRUE,
                    ]),
                    output: redeemScript,
                },
            }).input;
            tx.setInputScript(0, redeemScriptSig! as Script);

            await regtestUtils.broadcast(tx.toHex()).catch((err: unknown) => {
                assert.throws(() => {
                    if (err) throw err;
                }, /Error: non-final/);
            });
        },
    );
});
