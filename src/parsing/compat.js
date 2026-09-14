/*
 * Compatibility shims for older Safari.
 *
 * pdf.js's legacy build transpiles modern *syntax* but does not polyfill
 * modern *APIs*, and it calls two that are recent:
 *
 *   Promise.withResolvers                    Safari 17.4 / Chrome 119 / Firefox 121
 *   Object.hasOwn                            Safari 15.4
 *   ReadableStream async iteration           not implemented in Safari at all
 *
 * On an iPhone a version or two behind, the first call throws before a single
 * page is read, and Safari reports it as "undefined is not a function", which
 * tells the user nothing. Both are small and exactly specified, so they are
 * shimmed rather than the browser being declared unsupported.
 *
 * Plain JavaScript on purpose, and self-installing on import: this same file
 * is prepended verbatim to the pdf.js worker bundle at build time, and a
 * worker has its own global scope that a main-thread polyfill never reaches.
 * One source, both realms.
 */
(function installCompat(global) {
  'use strict';

  // https://tc39.es/proposal-promise-with-resolvers/
  if (typeof global.Promise === 'function' && typeof global.Promise.withResolvers !== 'function') {
    Object.defineProperty(global.Promise, 'withResolvers', {
      writable: true,
      configurable: true,
      value: function withResolvers() {
        var resolve;
        var reject;
        var promise = new this(function (res, rej) {
          resolve = res;
          reject = rej;
        });
        return { promise: promise, resolve: resolve, reject: reject };
      },
    });
  }

  if (typeof Object.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      writable: true,
      configurable: true,
      value: function hasOwn(target, property) {
        if (target === null || target === undefined) {
          throw new TypeError('Cannot convert undefined or null to object');
        }
        return Object.prototype.hasOwnProperty.call(Object(target), property);
      },
    });
  }

  // Relative indexing. `at` is also on TypedArray, which pdf.js leans on.
  function at(index) {
    var length = this.length;
    var relative = Math.trunc(index) || 0;
    if (relative < 0) relative += length;
    if (relative < 0 || relative >= length) return undefined;
    return this[relative];
  }
  var indexable = [Array.prototype, String.prototype];
  var typedArray = Object.getPrototypeOf(Int8Array);
  if (typedArray && typedArray.prototype) indexable.push(typedArray.prototype);
  indexable.forEach(function (proto) {
    if (typeof proto.at !== 'function') {
      Object.defineProperty(proto, 'at', { writable: true, configurable: true, value: at });
    }
  });

  if (typeof Array.prototype.findLast !== 'function') {
    Object.defineProperty(Array.prototype, 'findLast', {
      writable: true,
      configurable: true,
      value: function findLast(predicate, thisArg) {
        for (var i = this.length - 1; i >= 0; i -= 1) {
          if (predicate.call(thisArg, this[i], i, this)) return this[i];
        }
        return undefined;
      },
    });
  }

  /*
   * Async iteration over a ReadableStream -- `for await (const chunk of stream)`.
   *
   * Chrome and Firefox have it; Safari does not implement it at all, at any
   * version. pdf.js uses it in `getTextContent`, so on Safari every statement
   * failed at the moment its text was read, and the browser reported it as
   * "undefined is not a function" -- because the missing piece is the stream's
   * `Symbol.asyncIterator` method, which is exactly what the loop tries to call.
   *
   * Implemented to the Streams spec (https://streams.spec.whatwg.org/#rs-asynciterator):
   * the reader is acquired when the iterator is created, released when the
   * stream ends, and cancelled on early exit unless `preventCancel` is set.
   */
  if (
    typeof global.ReadableStream === 'function' &&
    typeof Symbol === 'function' &&
    typeof Symbol.asyncIterator === 'symbol' &&
    typeof global.ReadableStream.prototype[Symbol.asyncIterator] !== 'function'
  ) {
    var streamValues = function values(options) {
      var reader = this.getReader();
      var preventCancel = Boolean(options && options.preventCancel);
      var iterator = {
        next: function () {
          return reader.read().then(function (result) {
            if (result.done) {
              reader.releaseLock();
              return { value: undefined, done: true };
            }
            return { value: result.value, done: false };
          });
        },
        return: function (value) {
          if (preventCancel) {
            reader.releaseLock();
            return Promise.resolve({ value: value, done: true });
          }
          return reader.cancel(value).then(function () {
            reader.releaseLock();
            return { value: value, done: true };
          });
        },
      };
      iterator[Symbol.asyncIterator] = function () {
        return this;
      };
      return iterator;
    };

    Object.defineProperty(global.ReadableStream.prototype, 'values', {
      writable: true,
      configurable: true,
      value: streamValues,
    });
    Object.defineProperty(global.ReadableStream.prototype, Symbol.asyncIterator, {
      writable: true,
      configurable: true,
      value: streamValues,
    });
  }

  if (typeof Array.prototype.findLastIndex !== 'function') {
    Object.defineProperty(Array.prototype, 'findLastIndex', {
      writable: true,
      configurable: true,
      value: function findLastIndex(predicate, thisArg) {
        for (var i = this.length - 1; i >= 0; i -= 1) {
          if (predicate.call(thisArg, this[i], i, this)) return i;
        }
        return -1;
      },
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
