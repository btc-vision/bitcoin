"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertScriptTree = exports.from = exports.preform = exports.equate = void 0;
const t = require("assert");
const BNETWORKS = require("../src/networks");
const bscript = require("../src/script");
function tryHex(x) {
    if (Buffer.isBuffer(x))
        return x.toString('hex');
    if (Array.isArray(x))
        return x.map(tryHex);
    return x;
}
function fromHex(x) {
    if (typeof x === 'string')
        return Buffer.from(x, 'hex');
    if (Array.isArray(x))
        return x.map(fromHex);
    return x;
}
function tryASM(x) {
    if (Buffer.isBuffer(x))
        return bscript.toASM(x);
    return x;
}
function asmToBuffer(x) {
    if (x === '')
        return Buffer.alloc(0);
    return bscript.fromASM(x);
}
function carryOver(a, b) {
    for (const k in b) {
        if (!k)
            continue;
        if (k in a && k === 'redeem') {
            carryOver(a[k], b[k]);
            continue;
        }
        // don't, the value was specified
        if (k in a)
            continue;
        // otherwise, expect match
        a[k] = b[k];
    }
}
function equateBase(a, b, context) {
    if ('output' in b)
        t.strictEqual(tryASM(a.output), tryASM(b.output), `Inequal ${context}output`);
    if ('input' in b)
        t.strictEqual(tryASM(a.input), tryASM(b.input), `Inequal ${context}input`);
    if ('witness' in b)
        t.deepStrictEqual(tryHex(a.witness), tryHex(b.witness), `Inequal ${context}witness`);
    if ('redeemVersion' in b)
        t.strictEqual(a.redeemVersion, b.redeemVersion, `Inequal ${context}redeemVersion`);
}
function equate(a, b, args) {
    b = Object.assign({}, b);
    carryOver(b, args);
    // by null, we mean 'undefined', but JSON
    if (b.input === null)
        b.input = undefined;
    if (b.output === null)
        b.output = undefined;
    if (b.witness === null)
        b.witness = undefined;
    if (b.redeemVersion === null)
        b.redeemVersion = undefined;
    if (b.redeem) {
        if (b.redeem.input === null)
            b.redeem.input = undefined;
        if (b.redeem.output === null)
            b.redeem.output = undefined;
        if (b.redeem.witness === null)
            b.redeem.witness = undefined;
        if (b.redeem.redeemVersion === null)
            b.redeem.redeemVersion = undefined;
    }
    equateBase(a, b, '');
    if (b.redeem)
        equateBase(a.redeem, b.redeem, 'redeem.');
    if (b.network)
        t.deepStrictEqual(a.network, BNETWORKS[b.network], 'Inequal *.network');
    // contextual
    if (b.signature === null)
        b.signature = undefined;
    if (b.signatures === null)
        b.signatures = undefined;
    if ('address' in b)
        t.strictEqual(a.address, b.address, 'Inequal *.address');
    if ('name' in b)
        t.strictEqual(a.name, b.name, 'Inequal *.name');
    if ('hash' in b)
        t.strictEqual(tryHex(a.hash), tryHex(b.hash), 'Inequal *.hash');
    if ('pubkey' in b)
        t.strictEqual(tryHex(a.pubkey), tryHex(b.pubkey), 'Inequal *.pubkey');
    if ('internalPubkey' in b)
        t.strictEqual(tryHex(a.internalPubkey), tryHex(b.internalPubkey), 'Inequal *.internalPubkey');
    if ('signature' in b)
        t.strictEqual(tryHex(a.signature), tryHex(b.signature), 'Inequal signature');
    if ('m' in b)
        t.strictEqual(a.m, b.m, 'Inequal *.m');
    if ('n' in b)
        t.strictEqual(a.n, b.n, 'Inequal *.n');
    if ('pubkeys' in b)
        t.deepStrictEqual(tryHex(a.pubkeys), tryHex(b.pubkeys), 'Inequal *.pubkeys');
    if ('signatures' in b)
        t.deepStrictEqual(tryHex(a.signatures), tryHex(b.signatures), 'Inequal *.signatures');
    if ('data' in b)
        t.deepStrictEqual(tryHex(a.data), tryHex(b.data), 'Inequal *.data');
}
exports.equate = equate;
function preform(x) {
    x = Object.assign({}, x);
    if (x.network)
        x.network = BNETWORKS[x.network];
    if (typeof x.inputHex === 'string') {
        x.input = Buffer.from(x.inputHex, 'hex');
        delete x.inputHex;
    }
    if (typeof x.outputHex === 'string') {
        x.output = Buffer.from(x.outputHex, 'hex');
        delete x.outputHex;
    }
    if (typeof x.output === 'string')
        x.output = asmToBuffer(x.output);
    if (typeof x.input === 'string')
        x.input = asmToBuffer(x.input);
    if (Array.isArray(x.witness))
        x.witness = x.witness.map(fromHex);
    if (x.data)
        x.data = x.data.map(fromHex);
    if (x.hash)
        x.hash = Buffer.from(x.hash, 'hex');
    if (x.pubkey)
        x.pubkey = Buffer.from(x.pubkey, 'hex');
    if (x.internalPubkey)
        x.internalPubkey = Buffer.from(x.internalPubkey, 'hex');
    if (x.signature)
        x.signature = Buffer.from(x.signature, 'hex');
    if (x.pubkeys)
        x.pubkeys = x.pubkeys.map(fromHex);
    if (x.signatures)
        x.signatures = x.signatures.map((y) => {
            return Number.isFinite(y) ? y : Buffer.from(y, 'hex');
        });
    if (x.redeem) {
        x.redeem = Object.assign({}, x.redeem);
        if (typeof x.redeem.input === 'string')
            x.redeem.input = asmToBuffer(x.redeem.input);
        if (typeof x.redeem.output === 'string')
            x.redeem.output = asmToBuffer(x.redeem.output);
        if (Array.isArray(x.redeem.witness))
            x.redeem.witness = x.redeem.witness.map(fromHex);
        if (x.redeem.network)
            x.redeem.network = BNETWORKS[x.redeem.network];
    }
    if (x.scriptTree)
        x.scriptTree = convertScriptTree(x.scriptTree);
    return x;
}
exports.preform = preform;
function from(path, object, result) {
    const paths = path.split('.');
    result = result || {};
    let r = result;
    paths.forEach((k, i) => {
        if (i < paths.length - 1) {
            r[k] = r[k] || {};
            // recurse
            r = r[k];
            object = object[k];
        }
        else {
            r[k] = object[k];
        }
    });
    return result;
}
exports.from = from;
function convertScriptTree(scriptTree, leafVersion) {
    if (Array.isArray(scriptTree))
        return scriptTree.map(tr => convertScriptTree(tr, leafVersion));
    const script = Object.assign({}, scriptTree);
    if (typeof script.output === 'string') {
        script.output = asmToBuffer(scriptTree.output);
        script.version = script.version || leafVersion;
    }
    return script;
}
exports.convertScriptTree = convertScriptTree;
