'use strict';

var CryptoJS = require('../../../crypto-js/crypto-js');
var assert = require('../elliptic/utils').assert;

// some static stuff
const ONE = CryptoJS.enc.Utf8.parse ('\x01')
const ZERO = CryptoJS.enc.Utf8.parse ('\x00')

function HmacDRBG(options) {
  if (!(this instanceof HmacDRBG))
    return new HmacDRBG(options);
  this.hash = options.hash
  this.predResist = !!options.predResist;

  this.outLen = this.hash.slice (3, 6); // only support SHAXXX hashes
  this.minEntropy = options.minEntropy || 192;

  this._reseed = null;
  this.reseedInterval = null;
  this.K = null;
  this.V = null;

  var entropy = options.entropy
  var nonce = options.nonce
  var pers = []
  assert(entropy.length >= (this.minEntropy / 8),
         'Not enough entropy. Minimum is: ' + this.minEntropy + ' bits');
  this._init(entropy, nonce, pers);
}
module.exports = HmacDRBG;

HmacDRBG.prototype._init = function init(entropy, nonce, pers) {
  var seed = entropy.concat(nonce).concat(pers);

  this.K = new CryptoJS.lib.WordArray.init ()
  this.V = new CryptoJS.lib.WordArray.init ()
  const magicNumber = (1 << 24) + (1 << 16) + (1 << 8) + 1
  this.V.words = Array (this.outLen / 32).fill (magicNumber)
  this.V.sigBytes = 32
  this._update(seed);
  this._reseed = 1;
  this.reseedInterval = 0x1000000000000;  // 2^48
};

HmacDRBG.prototype._hmac = function hmac() {
  return new CryptoJS.lib.WordArray.init ();
};

HmacDRBG.prototype._update = function update(seed) {
  var kmac = this._hmac ()
  kmac.concat (this.V)
  kmac.concat (ZERO)
  if (seed)
    kmac.concat (byteArrayToWordArray (seed));
  this.K = CryptoJS['Hmac' + this.hash] (kmac, this.K)
  this.V = CryptoJS['Hmac' + this.hash] (this.V, this.K)
  if (!seed)
    return;

  kmac = this._hmac ()
  kmac.concat (this.V)
  kmac.concat (ONE)
  kmac.concat (byteArrayToWordArray (seed))
  this.K = CryptoJS['Hmac' + this.hash] (kmac, this.K)
  this.V = CryptoJS['Hmac' + this.hash] (this.V, this.K)
};

HmacDRBG.prototype.reseed = function reseed(entropy, entropyEnc, add, addEnc) {
  // Optional entropy enc
  if (typeof entropyEnc !== 'string') {
    addEnc = add;
    add = entropyEnc;
    entropyEnc = null;
  }

  //entropy = utils.toArray(entropy, entropyEnc);
  //add = utils.toArray(add, addEnc);

  assert(entropy.length >= (this.minEntropy / 8),
         'Not enough entropy. Minimum is: ' + this.minEntropy + ' bits');

  this._update(entropy.concat(add || []));
  this._reseed = 1;
};

HmacDRBG.prototype.generate = function generate(len, enc, add, addEnc) {
  if (this._reseed > this.reseedInterval)
    throw new Error ('Reseed is required');

  // Optional encoding
  if (typeof enc !== 'string') {
    addEnc = add;
    add = enc;
    enc = null;
  }

  // Optional additional data
  if (add) {
    add = CryptoJS.enc.Utf8.parse (add);
    this._update (add);
  }

  var res = new CryptoJS.lib.WordArray.init ();
  while (res.sigBytes < len) {
    this.V = CryptoJS['Hmac' + this.hash] (this.V, this.K)
    res.concat (this.V);
  }
  this._update (add);
  this._reseed++;
  return wordArrayToBuffer(res);
};


// actually the opposite of what I had to do in node-rsa schemes/pcks1.js, check it out bwoi
function byteArrayToWordArray(ba) {
  var wa = [],
      i;
  for (i = 0; i < ba.length; i++) {
    wa[(i / 4) | 0] |= ba[i] << (24 - 8 * i);
  }

  return CryptoJS.lib.WordArray.create(wa, ba.length);
}

// used to convert `CryptoJS` wordArrays into `crypto` hex buffers
function wordToByteArray(word, length) {
  var ba = [],
      xFF = 0xFF;
  if (length > 0)
    ba.push(word >>> 24);
  if (length > 1)
    ba.push((word >>> 16) & xFF);
  if (length > 2)
    ba.push((word >>> 8) & xFF);
  if (length > 3)
    ba.push(word & xFF);

  return ba;
}

function wordArrayToBuffer(wordArray) {
  let length = undefined;
  if (wordArray.hasOwnProperty("sigBytes") && wordArray.hasOwnProperty("words")) {
    length = wordArray.sigBytes;
    wordArray = wordArray.words;
  } else {
    throw Error('Argument not a wordArray')
  }

  const result = []
  let bytes = []
  let i = 0;
  while (length > 0) {
    bytes = wordToByteArray(wordArray[i], Math.min(4, length));
    length -= bytes.length;
    result.push(bytes);
    i++;
  }
  return [].concat.apply([], result)
}
