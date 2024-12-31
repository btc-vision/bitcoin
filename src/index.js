'use strict';
var __createBinding =
    (this && this.__createBinding) ||
    (Object.create
        ? function (o, m, k, k2) {
              if (k2 === undefined) k2 = k;
              var desc = Object.getOwnPropertyDescriptor(m, k);
              if (
                  !desc ||
                  ('get' in desc
                      ? !m.__esModule
                      : desc.writable || desc.configurable)
              ) {
                  desc = {
                      enumerable: true,
                      get: function () {
                          return m[k];
                      },
                  };
              }
              Object.defineProperty(o, k2, desc);
          }
        : function (o, m, k, k2) {
              if (k2 === undefined) k2 = k;
              o[k2] = m[k];
          });
var __exportStar =
    (this && this.__exportStar) ||
    function (m, exports) {
        for (var p in m)
            if (
                p !== 'default' &&
                !Object.prototype.hasOwnProperty.call(exports, p)
            )
                __createBinding(exports, m, p);
    };
Object.defineProperty(exports, '__esModule', { value: true });
exports.initEccLib =
    exports.Transaction =
    exports.opcodes =
    exports.Block =
    exports.script =
    exports.payments =
    exports.networks =
    exports.crypto =
    exports.address =
        void 0;
const address = require('./address.js');
exports.address = address;
const crypto = require('./crypto.js');
exports.crypto = crypto;
const networks = require('./networks.js');
exports.networks = networks;
const payments = require('./payments');
exports.payments = payments;
const script = require('./script.js');
exports.script = script;
__exportStar(require('./psbt/psbtutils.js'), exports);
var block_js_1 = require('./block.js');
Object.defineProperty(exports, 'Block', {
    enumerable: true,
    get: function () {
        return block_js_1.Block;
    },
});
__exportStar(require('./psbt'), exports);
/** @hidden */
var ops_js_1 = require('./ops.js');
Object.defineProperty(exports, 'opcodes', {
    enumerable: true,
    get: function () {
        return ops_js_1.OPS;
    },
});
var transaction_js_1 = require('./transaction.js');
Object.defineProperty(exports, 'Transaction', {
    enumerable: true,
    get: function () {
        return transaction_js_1.Transaction;
    },
});
var ecc_lib_1 = require('./ecc_lib');
Object.defineProperty(exports, 'initEccLib', {
    enumerable: true,
    get: function () {
        return ecc_lib_1.initEccLib;
    },
});
