import { bitcoin as BITCOIN_NETWORK } from '../networks.js';
import * as bscript from '../script.js';
import { stacksEqual, typeforce as typef, type Stack } from '../types.js';
import { EmbedPayment, PaymentOpts, PaymentType } from './types.js';
import * as lazy from './lazy.js';

const OPS = bscript.opcodes;

// output: OP_RETURN ...
/**
 * Embeds data in a Bitcoin payment.
 * @param a - The payment object.
 * @param opts - Optional payment options.
 * @returns The modified payment object.
 * @throws {TypeError} If there is not enough data or if the output is invalid.
 */
export function p2data(a: Omit<EmbedPayment, 'name'>, opts?: PaymentOpts): EmbedPayment {
    if (!a.data && !a.output) throw new TypeError('Not enough data');
    opts = Object.assign({ validate: true }, opts || {});

    typef(
        {
            network: typef.maybe(typef.Object),
            output: typef.maybe(typef.Buffer),
            data: typef.maybe(typef.arrayOf(typef.Buffer)),
        },
        a,
    );

    const network = a.network || BITCOIN_NETWORK;
    const o: EmbedPayment = { name: PaymentType.Embed, network, data: [] };

    lazy.prop(o, 'output', () => {
        if (!a.data) return;
        return bscript.compile(([OPS.OP_RETURN] as Stack).concat(a.data));
    });

    lazy.prop(o, 'data', () => {
        if (!a.output) return;
        const script = bscript.decompile(a.output);
        if (script === null || script === undefined) {
            return;
        }

        return script.slice(1) as Buffer[];
    });

    // extended validation
    if (opts.validate) {
        if (a.output) {
            const chunks = bscript.decompile(a.output);
            if (chunks![0] !== OPS.OP_RETURN) throw new TypeError('Output is invalid');
            if (!chunks!.slice(1).every(typef.Buffer)) throw new TypeError('Output is invalid');

            if (a.data && !stacksEqual(a.data, o.data)) throw new TypeError('Data mismatch');
        }
    }

    return Object.assign(o, a);
}
