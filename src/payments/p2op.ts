import { bech32m } from 'bech32';
import { Buffer as NBuffer } from 'buffer';
import { fromBech32 } from '../bech32utils.js';
import { bitcoin as BITCOIN_NETWORK, Network } from '../networks.js';
import * as bscript from '../script.js';
import { typeforce as typef } from '../types.js';
import { BasePayment, P2OPPayment, PaymentOpts, PaymentType } from './types.js';
import * as lazy from './lazy.js';

const OPS = bscript.opcodes;
const P2OP_WITNESS_VERSION = 0x10;
const MIN_SIZE = 2;
const MAX_SIZE = 40;

interface P2OPBase extends BasePayment {
    name: PaymentType.P2OP;
}

interface P2OP_fromOutput extends P2OPBase {
    output: Buffer;

    program?: undefined;
    deploymentVersion?: undefined;
    hash160?: undefined;
}

interface P2OP_fromProgram extends P2OPBase {
    program: Buffer;

    output?: undefined;
    deploymentVersion?: never;
    hash160?: never;
}

interface P2OP_fromParts extends P2OPBase {
    deploymentVersion: number;
    hash160: Buffer;

    output?: undefined;
    program?: undefined;
}

export type P2OPPaymentParams = P2OP_fromOutput | P2OP_fromProgram | P2OP_fromParts;

/**
 * Pay-to-OPNet (P2OP) decoder / encoder.
 *
 *   ▪ witness program =    <deploymentVersion:uint8><hash160:20-bytes|...>
 *   ▪ scriptPubKey   = OP_16 <program>
 *   ▪ address HRP    = network.bech32Opnet, encoded with Bech32m
 *
 * Accepts any combination of { address, output, program }  and returns a
 * fully lazy payment object, mirroring the style of `p2tr`.
 */
export function p2op(a: Omit<P2OPPaymentParams, 'name'>, opts?: PaymentOpts): P2OPPayment {
    if (
        !a.address &&
        !a.output &&
        !a.program &&
        (typeof a.deploymentVersion === 'undefined' || !a.hash160)
    ) {
        throw new TypeError('At least one of address, output or program must be provided');
    }

    opts = Object.assign({ validate: true }, opts || {});

    typef(
        {
            address: typef.maybe(typef.String),
            output: typef.maybe(typef.Buffer),
            program: typef.maybe(typef.Buffer),
            network: typef.maybe(typef.Object),
            deploymentVersion: typef.maybe(typef.Number),
            hash160: typef.maybe(typef.BufferN(20)),
        },
        a,
    );

    const makeProgramFromParts = (): Buffer | undefined => {
        if (typeof a.deploymentVersion !== 'undefined' && typeof a.hash160 !== 'undefined') {
            if (a.hash160.length !== 20) throw new TypeError('hash160 must be exactly 20 bytes');
            if (a.deploymentVersion < 0 || a.deploymentVersion > 0xff)
                throw new TypeError('deploymentVersion must fit in one byte');
            return Buffer.concat([Buffer.of(a.deploymentVersion), a.hash160]);
        }
        return undefined;
    };

    const _address = lazy.value(() => fromBech32(a.address!));

    const network: Network = a.network || BITCOIN_NETWORK;
    const o: P2OPPayment = {
        name: PaymentType.P2OP,
        network,
        deploymentVersion: 0,
    };

    lazy.prop(o, 'program', () => {
        if (a.program) return a.program;

        // NEW: build from deploymentVersion+hash160
        const fromParts = makeProgramFromParts();
        if (fromParts) return fromParts;

        if (a.output) {
            if (a.output[0] !== OPS.OP_16) throw new TypeError('Invalid P2OP script');
            let pushPos = 1,
                progLen: number;
            if (a.output[1] < 0x4c) {
                progLen = a.output[1];
                pushPos = 2;
            } else if (a.output[1] === 0x4c) {
                progLen = a.output[2];
                pushPos = 3;
            } else {
                throw new TypeError('Unsupported push opcode in P2OP script');
            }
            return a.output.subarray(pushPos, pushPos + progLen);
        }

        if (a.address) {
            const dec = _address();
            return dec.data;
        }
    });

    lazy.prop(o, 'deploymentVersion', () => {
        if (!o.program) return;
        return o.program[0];
    });

    lazy.prop(o, 'hash160', () => {
        if (!o.program) return;
        return o.program.subarray(1);
    });

    lazy.prop(o, 'output', () => {
        if (!o.program) return;
        return bscript.compile([OPS.OP_16, o.program]);
    });

    lazy.prop(o, 'address', () => {
        if (!o.program) return;
        if (!network.bech32Opnet) {
            throw new TypeError('Network does not support opnet');
        }

        const words = bech32m.toWords(o.program);
        words.unshift(P2OP_WITNESS_VERSION);

        return bech32m.encode(network.bech32Opnet, words);
    });

    // extended validation
    if (opts.validate) {
        let prog: Buffer = NBuffer.alloc(0);

        if (a.address) {
            const dec = _address();
            if (network.bech32Opnet !== dec.prefix)
                throw new TypeError('Invalid prefix or network mismatch');
            if (dec.version !== P2OP_WITNESS_VERSION)
                throw new TypeError('Invalid witness version for p2op');
            if (dec.data.length < MIN_SIZE || dec.data.length > MAX_SIZE)
                throw new TypeError('Invalid witness program length');
            prog = dec.data;
        }

        if (a.program) {
            if (prog.length && !prog.equals(a.program)) throw new TypeError('Program mismatch');
            prog = a.program;
        }

        if (!prog.length && a.deploymentVersion !== undefined && a.hash160) {
            prog = makeProgramFromParts()!;
        }

        if (a.output) {
            const outProg = o.program!;
            if (prog.length && !prog.equals(outProg))
                throw new TypeError('Program mismatch (output vs other source)');
            prog = outProg;
        }

        if (prog.length < MIN_SIZE || prog.length > MAX_SIZE)
            throw new TypeError(`Witness program must be 2–40 bytes. Was ${prog.length} bytes`);

        if (a.deploymentVersion !== undefined && a.deploymentVersion !== prog[0])
            throw new TypeError('deploymentVersion mismatch');

        if (a.hash160 && !a.hash160.equals(prog.subarray(1)))
            throw new TypeError('hash160 mismatch');
    }

    return Object.assign(o, a);
}
