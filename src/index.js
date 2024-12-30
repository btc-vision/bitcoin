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
const address = require('./address');
exports.address = address;
const crypto = require('./crypto');
exports.crypto = crypto;
const networks = require('./networks');
exports.networks = networks;
const payments = require('./payments');
exports.payments = payments;
const script = require('./script');
exports.script = script;
__exportStar(require('./psbt/psbtutils'), exports);
var block_1 = require('./block');
Object.defineProperty(exports, 'Block', {
    enumerable: true,
    get: function () {
        return block_1.Block;
    },
});
__exportStar(require('./psbt'), exports);
/** @hidden */
var ops_1 = require('./ops');
Object.defineProperty(exports, 'opcodes', {
    enumerable: true,
    get: function () {
        return ops_1.OPS;
    },
});
var transaction_1 = require('./transaction');
Object.defineProperty(exports, 'Transaction', {
    enumerable: true,
    get: function () {
        return transaction_1.Transaction;
    },
});
var ecc_lib_1 = require('./ecc_lib');
Object.defineProperty(exports, 'initEccLib', {
    enumerable: true,
    get: function () {
        return ecc_lib_1.initEccLib;
    },
});
