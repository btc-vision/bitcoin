/**
 * Payment types and interfaces
 * @packageDocumentation
 */

import type { Network } from '../networks.js';
import type { Taptree } from '../types.js';

export enum PaymentType {
    P2PK = 'p2pk',
    P2PKH = 'p2pkh',
    P2SH = 'p2sh',
    P2MS = 'p2ms',
    P2WPKH = 'p2wpkh',
    P2WSH = 'p2wsh',
    P2TR = 'p2tr',
    P2OP = 'p2op',
    Embed = 'embed',
    ScriptRedeem = 'scriptRedeem',
}

export interface BasePayment {
    /** Convenience label, also the discriminant for the union. */
    name?: PaymentType;
    /** Network parameters (mainnet if omitted). */
    network?: Network;
    /** Fully-assembled scriptPubKey (if already known). */
    output?: Buffer;
    /** Raw scriptSig (legacy script types only). */
    input?: Buffer;
    /** Human-readable address (if already known). */
    address?: string;
    /** Segwit stack (empty for legacy). */
    witness?: Buffer[];

    /** Script template for P2SH, P2WSH, P2TR, etc. */
    redeem?: ScriptRedeem;

    /** Non-standard options used by some wallets. */
    useHybrid?: boolean;
    useUncompressed?: boolean;
}

/** Helper used by redeeming script-template outputs (P2SH, P2WSH). */
export interface ScriptRedeem extends BasePayment {
    output?: Buffer; // script template
    redeemVersion?: number; // tapscript leaves etc.
    network?: Network; // network parameters (mainnet if omitted)
}

export interface P2PKPayment extends BasePayment {
    name: PaymentType.P2PK;
    pubkey?: Buffer;
    /** DER-encoded sig – empty until signed. */
    signature?: Buffer;
}

export interface P2PKHPayment extends BasePayment {
    name: PaymentType.P2PKH;
    /** RIPEMD-160(SHA-256(pubkey)) – 20 bytes. */
    hash?: Buffer;
    pubkey?: Buffer;
    signature?: Buffer;
}

export interface P2SHPayment extends BasePayment {
    name: PaymentType.P2SH;
    /** Hash160 of a redeem script. */
    hash?: Buffer;

    /** The entire signature stack when spending a P2SH (non-segwit). */
    signatures?: Buffer[];
}

export interface P2MSPayment extends BasePayment {
    name: PaymentType.P2MS;
    /** M-of-N parameters. */
    m?: number;
    n?: number;
    pubkeys?: Buffer[];
    signatures?: Buffer[];
}

export interface P2WPKHPayment extends BasePayment {
    name: PaymentType.P2WPKH;
    /** 20-byte witness program. */
    hash?: Buffer;
    pubkey?: Buffer;
    signature?: Buffer;
}

export interface P2WSHPayment extends BasePayment {
    name: PaymentType.P2WSH;
    /** 32-byte witness program. */
    hash?: Buffer;
    redeem?: ScriptRedeem;
}

export interface P2TRPayment extends BasePayment {
    name: PaymentType.P2TR;
    /** x-only pubkey that commits to the tree. */
    pubkey?: Buffer;
    /** Internal (untweaked) x-only pubkey. */
    internalPubkey?: Buffer;
    /** Merkle-root tweak, present when a script path exists. */
    hash?: Buffer;
    /** Full taptree description (optional, dev-side). */
    scriptTree?: Taptree;
    /** Key-path sig or leading stack elem. */
    signature?: Buffer;

    redeemVersion?: number; // tapscript leaves etc.
    redeem?: ScriptRedeem;
}

export interface P2OPPayment extends BasePayment {
    name: PaymentType.P2OP;
    /** <deploymentVersion || HASH160(payload)> (2–40 bytes). */
    program?: Buffer;
    deploymentVersion: number | undefined;
    /** Convenience slice of `program` (20 bytes for current spec). */
    hash160?: Buffer;
}

export interface P2OPPaymentParams extends Omit<P2OPPayment, 'name' | 'deploymentVersion'> {
    deploymentVersion?: number;
}

/** OP_RETURN data-carrying output */
export interface EmbedPayment extends BasePayment {
    name: PaymentType.Embed;
    /** Raw pushed chunks after OP_RETURN. */
    data: Buffer[];
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
    validate?: boolean;
    allowIncomplete?: boolean;
}
