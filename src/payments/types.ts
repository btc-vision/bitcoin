/**
 * Payment types and interfaces
 * @packageDocumentation
 */

import type { Network } from '../networks.js';
import type {
    Bytes20,
    Bytes32,
    PublicKey,
    Script,
    Signature,
    SchnorrSignature,
    Taptree,
    XOnlyPublicKey,
} from '../types.js';

export const PaymentType = {
    P2PK: 'p2pk',
    P2PKH: 'p2pkh',
    P2SH: 'p2sh',
    P2MS: 'p2ms',
    P2WPKH: 'p2wpkh',
    P2WSH: 'p2wsh',
    P2TR: 'p2tr',
    P2OP: 'p2op',
    Embed: 'embed',
    ScriptRedeem: 'scriptRedeem',
} as const;

export type PaymentType = (typeof PaymentType)[keyof typeof PaymentType];

export interface BasePayment {
    /** Convenience label, also the discriminant for the union. Can be dynamic for nested types. */
    readonly name?: string;
    /** Network parameters (mainnet if omitted). */
    readonly network?: Network;
    /** Fully-assembled scriptPubKey (if already known). */
    readonly output?: Script;
    /** Raw scriptSig (legacy script types only). */
    readonly input?: Script;
    /** Human-readable address (if already known). */
    readonly address?: string;
    /** Segwit stack (empty for legacy). */
    readonly witness?: Uint8Array[];

    /** Script template for P2SH, P2WSH, P2TR, etc. */
    readonly redeem?: ScriptRedeem;

    /** Non-standard options used by some wallets. */
    readonly useHybrid?: boolean;
    readonly useUncompressed?: boolean;
}

/** Helper used by redeeming script-template outputs (P2SH, P2WSH). */
export interface ScriptRedeem extends BasePayment {
    readonly output?: Script; // script template
    readonly redeemVersion?: number; // tapscript leaves etc.
    readonly network?: Network; // network parameters (mainnet if omitted)
}

export interface P2PKPayment extends BasePayment {
    readonly name: typeof PaymentType.P2PK;
    readonly pubkey?: PublicKey;
    /** DER-encoded sig – empty until signed. */
    readonly signature?: Signature;
}

export interface P2PKHPayment extends BasePayment {
    readonly name: typeof PaymentType.P2PKH;
    /** RIPEMD-160(SHA-256(pubkey)) – 20 bytes. */
    readonly hash?: Bytes20;
    readonly pubkey?: PublicKey;
    readonly signature?: Signature;
}

export interface P2SHPayment extends BasePayment {
    /** Dynamic name like 'p2sh' or 'p2sh-p2wpkh' for nested types */
    readonly name: string;
    /** Hash160 of a redeem script. */
    readonly hash?: Bytes20;

    /** The entire signature stack when spending a P2SH (non-segwit). */
    readonly signatures?: Uint8Array[];
}

export interface P2MSPayment extends BasePayment {
    /** Dynamic name like 'p2ms' or 'p2ms(2 of 3)' with M-of-N parameters */
    readonly name: string;
    /** M-of-N parameters. */
    readonly m?: number;
    readonly n?: number;
    readonly pubkeys?: PublicKey[];
    readonly signatures?: Signature[];
}

export interface P2WPKHPayment extends BasePayment {
    readonly name: typeof PaymentType.P2WPKH;
    /** 20-byte witness program. */
    readonly hash?: Bytes20;
    readonly pubkey?: PublicKey;
    readonly signature?: Signature;
}

export interface P2WSHPayment extends BasePayment {
    /** Dynamic name like 'p2wsh' or 'p2wsh-p2pk' for nested types */
    readonly name: string;
    /** 32-byte witness program. */
    readonly hash?: Bytes32;
    readonly redeem?: ScriptRedeem;
}

export interface P2TRPayment extends BasePayment {
    readonly name: typeof PaymentType.P2TR;
    /** x-only pubkey that commits to the tree. */
    readonly pubkey?: XOnlyPublicKey;
    /** Internal (untweaked) x-only pubkey. */
    readonly internalPubkey?: XOnlyPublicKey;
    /** Merkle-root tweak, present when a script path exists. */
    readonly hash?: Bytes32;
    /** Full taptree description (optional, dev-side). */
    readonly scriptTree?: Taptree;
    /** Key-path sig or leading stack elem. */
    readonly signature?: SchnorrSignature;

    readonly redeemVersion?: number; // tapscript leaves etc.
    readonly redeem?: ScriptRedeem;
}

export interface P2OPPayment extends BasePayment {
    readonly name: typeof PaymentType.P2OP;
    /** <deploymentVersion || HASH160(payload)> (2–40 bytes). */
    readonly program?: Uint8Array;
    readonly deploymentVersion: number | undefined;
    /** Convenience slice of `program` (20 bytes for current spec). */
    readonly hash160?: Bytes20;
}

export interface P2OPPaymentParams extends Omit<P2OPPayment, 'name' | 'deploymentVersion'> {
    readonly deploymentVersion?: number;
}

/** OP_RETURN data-carrying output */
export interface EmbedPayment extends BasePayment {
    readonly name: typeof PaymentType.Embed;
    /** Raw pushed chunks after OP_RETURN. */
    readonly data: Uint8Array[];
    // `output` is automatically derived from `data` (or vice-versa)
}

export type Payment =
    | P2PKPayment
    | P2PKHPayment
    | P2SHPayment
    | P2MSPayment
    | P2WPKHPayment
    | P2WSHPayment
    | P2TRPayment
    | P2OPPayment
    | EmbedPayment
    | ScriptRedeem;

export type PaymentCreator = <T extends BasePayment>(a: T, opts?: PaymentOpts) => T;

export interface PaymentOpts {
    readonly validate?: boolean;
    readonly allowIncomplete?: boolean;
}
