import * as bs58check from 'bs58check';
import * as bcrypto from '../crypto.js';
import { bitcoin as BITCOIN_NETWORK } from '../networks.js';
import * as bscript from '../script.js';
import { isPoint, typeforce as typef } from '../types.js';
import { P2PKHPayment, PaymentOpts, PaymentType, StackFunction } from './index.js';
import * as lazy from './lazy.js';
import { decompressPublicKey } from '../psbt/psbtutils.js';

const OPS = bscript.OPS;

// input: {signature} {pubkey}
// output: OP_DUP OP_HASH160 {hash160(pubkey)} OP_EQUALVERIFY OP_CHECKSIG
/**
 * Creates a Pay-to-Public-Key-Hash (P2PKH) payment object.
 *
 * @param a - The payment object containing the necessary data.
 * @param opts - Optional payment options.
 * @returns The P2PKH payment object.
 * @throws {TypeError} If the required data is not provided or if the data is invalid.
 */
export function p2pkh(a: Omit<P2PKHPayment, 'name'>, opts?: PaymentOpts): P2PKHPayment {
    if (!a.address && !a.hash && !a.output && !a.pubkey && !a.input) {
        throw new TypeError('Not enough data');
    }

    opts = Object.assign({ validate: true }, opts || {});

    typef(
        {
            network: typef.maybe(typef.Object),
            address: typef.maybe(typef.String),
            hash: typef.maybe(typef.BufferN(20)),
            output: typef.maybe(typef.BufferN(25)),

            pubkey: typef.maybe(isPoint),
            signature: typef.maybe(bscript.isCanonicalScriptSignature),
            input: typef.maybe(typef.Buffer),
        },
        a,
    );

    const _address = lazy.value(() => {
        const payload = Buffer.from(bs58check.default.decode(a.address!));
        const version = payload.readUInt8(0);
        const hash = payload.slice(1);
        return { version, hash };
    });

    const _chunks = lazy.value(() => {
        return bscript.decompile(a.input!);
    }) as StackFunction;

    const network = a.network || BITCOIN_NETWORK;
    const o: P2PKHPayment = {
        name: PaymentType.P2PKH,
        network,
        hash: undefined,
    };

    lazy.prop(o, 'address', () => {
        if (!o.hash) return;

        const payload = Buffer.allocUnsafe(21);
        payload.writeUInt8(network.pubKeyHash, 0);
        o.hash.copy(payload, 1);
        return bs58check.default.encode(payload);
    });

    lazy.prop(o, 'hash', () => {
        if (a.output) return a.output.slice(3, 23);
        if (a.address) return _address().hash;
        if (a.pubkey || o.pubkey) return bcrypto.hash160(a.pubkey! || o.pubkey!);
    });

    lazy.prop(o, 'output', () => {
        if (!o.hash) return;
        return bscript.compile([
            OPS.OP_DUP,
            OPS.OP_HASH160,
            o.hash,
            OPS.OP_EQUALVERIFY,
            OPS.OP_CHECKSIG,
        ]);
    });

    lazy.prop(o, 'pubkey', () => {
        if (!a.input) return;
        return _chunks()[1] as Buffer;
    });

    lazy.prop(o, 'signature', () => {
        if (!a.input) return;
        return _chunks()[0] as Buffer;
    });

    lazy.prop(o, 'input', () => {
        if (!a.pubkey) return;
        if (!a.signature) return;

        let pubKey: Buffer = a.pubkey;
        if (a.useHybrid || a.useUncompressed) {
            const decompressed = decompressPublicKey(a.pubkey);
            if (decompressed) {
                if (a.useUncompressed) {
                    pubKey = decompressed.uncompressed;
                } else {
                    pubKey = decompressed.hybrid;
                }
            }
        }

        return bscript.compile([a.signature, pubKey]);
    });

    lazy.prop(o, 'witness', () => {
        if (!o.input) return;
        return [];
    });

    // extended validation
    if (opts.validate) {
        let hash: Buffer = Buffer.from([]);
        if (a.address) {
            if (_address().version !== network.pubKeyHash) {
                throw new TypeError('Invalid version or Network mismatch');
            }

            if (_address().hash.length !== 20) {
                throw new TypeError('Invalid address');
            }

            hash = _address().hash;
        }

        if (a.hash) {
            if (hash.length > 0 && !hash.equals(a.hash)) {
                throw new TypeError('Hash mismatch');
            } else {
                hash = a.hash;
            }
        }

        if (a.output) {
            if (
                a.output.length !== 25 ||
                a.output[0] !== OPS.OP_DUP ||
                a.output[1] !== OPS.OP_HASH160 ||
                a.output[2] !== 0x14 ||
                a.output[23] !== OPS.OP_EQUALVERIFY ||
                a.output[24] !== OPS.OP_CHECKSIG
            ) {
                throw new TypeError('Output is invalid');
            }

            const hash2 = a.output.slice(3, 23);
            if (hash.length > 0 && !hash.equals(hash2)) throw new TypeError('Hash mismatch');
            else hash = hash2;
        }

        if (a.pubkey) {
            const pkh = bcrypto.hash160(a.pubkey);

            let badHash = hash.length > 0 && !hash.equals(pkh);
            if (badHash) {
                if (
                    (a.pubkey.length === 33 && (a.pubkey[0] === 0x02 || a.pubkey[0] === 0x03)) ||
                    (a.pubkey.length === 65 && a.pubkey[0] === 0x04)
                ) {
                    const uncompressed = decompressPublicKey(a.pubkey);
                    if (uncompressed) {
                        const pkh2 = bcrypto.hash160(uncompressed.uncompressed);

                        if (!hash.equals(pkh2)) {
                            const pkh3 = bcrypto.hash160(uncompressed.hybrid);
                            badHash = !hash.equals(pkh3);

                            if (!badHash) {
                                a.useHybrid = true;
                            }
                        } else {
                            badHash = false;
                            a.useUncompressed = true;
                        }
                    }
                }
            }

            if (badHash) {
                throw new TypeError('Hash mismatch');
            } else {
                hash = pkh;
            }
        }

        if (a.input) {
            const chunks = _chunks();
            if (chunks.length !== 2) throw new TypeError('Input is invalid');
            if (!bscript.isCanonicalScriptSignature(chunks[0] as Buffer))
                throw new TypeError('Input has invalid signature');
            if (!isPoint(chunks[1])) throw new TypeError('Input has invalid pubkey');

            if (a.signature && !a.signature.equals(chunks[0] as Buffer))
                throw new TypeError('Signature mismatch');
            if (a.pubkey && !a.pubkey.equals(chunks[1] as Buffer))
                throw new TypeError('Pubkey mismatch');

            const pkh = bcrypto.hash160(chunks[1] as Buffer);
            if (hash.length > 0 && !hash.equals(pkh)) throw new TypeError('Hash mismatch (input)');
        }
    }

    return Object.assign(o, a);
}
