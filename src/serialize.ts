/*
Copyright (c) 2014, Yahoo! Inc. All rights reserved.
Copyrights licensed under the New BSD License.
See the accompanying LICENSE file for terms.

Modified by @iamrecursion (Ara Adkins) to not depend on random-bytes.
*/

"use strict";

// Generate an internal UID to make the regexp pattern harder to guess.
var UID_LENGTH = 16;
var UID = generateUID();
var PLACE_HOLDER_REGEXP = new RegExp(
  '(\\\\)?"@__(F|R|D|M|S|A|U|I|B|L)-' + UID + '-(\\d+)__@"',
  "g",
);

var IS_NATIVE_CODE_REGEXP = /\{\s*\[native code\]\s*\}/g;
var IS_PURE_FUNCTION = /function.*?\(/;
var IS_ARROW_FUNCTION = /.*?=>.*?/;
var UNSAFE_CHARS_REGEXP = /[<>\/\u2028\u2029]/g;

var RESERVED_SYMBOLS = ["*", "async"];

// Mapping of unsafe HTML and invalid JavaScript line terminator chars to their
// Unicode char counterparts which are safe to use in JavaScript strings.
var ESCAPED_CHARS: StringIndexable = {
  "<": "\\u003C",
  ">": "\\u003E",
  "/": "\\u002F",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

function escapeUnsafeChars(unsafeChar: string): string {
  return ESCAPED_CHARS[unsafeChar];
}

function generateUID() {
  var bytes: Uint8Array = new Uint8Array(UID_LENGTH);
  crypto.getRandomValues(bytes);
  var result = "";
  for (var i = 0; i < UID_LENGTH; ++i) {
    const index = bytes[i];
    if (index !== undefined) {
      result += index.toString(16);
    }
  }
  return result;
}

interface StringIndexable {
  [index: string]: any;
}

interface SerializeJSOptions {
  /**
   * This option is the same as the space argument that can be passed to JSON.stringify.
   * It can be used to add whitespace and indentation to the serialized output to make it more readable.
   */
  space?: string | number | undefined;
  /**
   * This option is a signal to serialize() that the object being serialized does not contain any function or regexps values.
   * This enables a hot-path that allows serialization to be over 3x faster.
   * If you're serializing a lot of data, and know its pure JSON, then you can enable this option for a speed-up.
   */
  isJSON?: boolean | undefined;
  /**
   * This option is to signal serialize() that we want to do a straight conversion, without the XSS protection.
   * This options needs to be explicitly set to true. HTML characters and JavaScript line terminators will not be escaped.
   * You will have to roll your own.
   */
  unsafe?: true | undefined;
  /**
   * This option is to signal serialize() that we do not want serialize JavaScript function.
   * Just treat function like JSON.stringify do, but other features will work as expected.
   */
  ignoreFunction?: boolean | undefined;
}

function deleteFunctions(obj: StringIndexable) {
  var functionKeys: string[] = [];
  for (var key in obj) {
    if (typeof obj[key] === "function") {
      functionKeys.push(key);
    }
  }
  for (var i = 0; i < functionKeys.length; i++) {
    const key: string | undefined = functionKeys[i];

    if (key) {
      delete obj[key];
    }
  }
}

function serializeJS(obj: any, options?: SerializeJSOptions): string {
  options || (options = {});

  // Backwards-compatibility for `space` as the second argument.
  if (typeof options === "number" || typeof options === "string") {
    options = { space: options };
  }

  var functions: any[] = [];
  var regexps: any[] = [];
  var dates: any[] = [];
  var maps: any[] = [];
  var sets: any[] = [];
  var arrays: any[] = [];
  var undefs: any[] = [];
  var infinities: any[] = [];
  var bigInts: any[] = [];
  var urls: any[] = [];

  // Returns placeholders for functions and regexps (identified by index)
  // which are later replaced by their string representation.
  function replacer(this: StringIndexable, key: string, value: any) {
    // For nested function
    if (options !== undefined && options.ignoreFunction) {
      deleteFunctions(value);
    }

    if (!value && value !== undefined && value !== BigInt(0)) {
      return value;
    }

    // If the value is an object w/ a toJSON method, toJSON is called before
    // the replacer runs, so we use this[key] to get the non-toJSONed value.
    var origValue = this[key];
    var type = typeof origValue;

    if (type === "object") {
      if (origValue instanceof RegExp) {
        return "@__R-" + UID + "-" + (regexps.push(origValue) - 1) + "__@";
      }

      if (origValue instanceof Date) {
        return "@__D-" + UID + "-" + (dates.push(origValue) - 1) + "__@";
      }

      if (origValue instanceof Map) {
        return "@__M-" + UID + "-" + (maps.push(origValue) - 1) + "__@";
      }

      if (origValue instanceof Set) {
        return "@__S-" + UID + "-" + (sets.push(origValue) - 1) + "__@";
      }

      if (origValue instanceof Array) {
        var isSparse =
          origValue.filter(function () {
            return true;
          }).length !== origValue.length;
        if (isSparse) {
          return "@__A-" + UID + "-" + (arrays.push(origValue) - 1) + "__@";
        }
      }

      if (origValue instanceof URL) {
        return "@__L-" + UID + "-" + (urls.push(origValue) - 1) + "__@";
      }
    }

    if (type === "function") {
      return "@__F-" + UID + "-" + (functions.push(origValue) - 1) + "__@";
    }

    if (type === "undefined") {
      return "@__U-" + UID + "-" + (undefs.push(origValue) - 1) + "__@";
    }

    if (type === "number" && !isNaN(origValue) && !isFinite(origValue)) {
      return "@__I-" + UID + "-" + (infinities.push(origValue) - 1) + "__@";
    }

    if (type === "bigint") {
      return "@__B-" + UID + "-" + (bigInts.push(origValue) - 1) + "__@";
    }

    return value;
  }

  function serializeFunc(fn: Function) {
    var serializedFn = fn.toString();
    if (IS_NATIVE_CODE_REGEXP.test(serializedFn)) {
      throw new TypeError("Serializing native function: " + fn.name);
    }

    // pure functions, example: {key: function() {}}
    if (IS_PURE_FUNCTION.test(serializedFn)) {
      return serializedFn;
    }

    // arrow functions, example: arg1 => arg1+5
    if (IS_ARROW_FUNCTION.test(serializedFn)) {
      return serializedFn;
    }

    var argsStartsAt = serializedFn.indexOf("(");
    var def = serializedFn
      .substr(0, argsStartsAt)
      .trim()
      .split(" ")
      .filter(function (val) {
        return val.length > 0;
      });

    var nonReservedSymbols = def.filter(function (val) {
      return RESERVED_SYMBOLS.indexOf(val) === -1;
    });

    // enhanced literal objects, example: {key() {}}
    if (nonReservedSymbols.length > 0) {
      return (
        (def.indexOf("async") > -1 ? "async " : "") +
        "function" +
        (def.join("").indexOf("*") > -1 ? "*" : "") +
        serializedFn.substr(argsStartsAt)
      );
    }

    // arrow functions
    return serializedFn;
  }

  // Check if the parameter is function
  if (options.ignoreFunction && typeof obj === "function") {
    obj = undefined;
  }
  // Protects against `JSON.stringify()` returning `undefined`, by serializing
  // to the literal string: "undefined".
  if (obj === undefined) {
    return String(obj);
  }

  var str;

  // Creates a JSON string representation of the value.
  // NOTE: Node 0.12 goes into slow mode with extra JSON.stringify() args.
  if (options.isJSON && !options.space) {
    str = JSON.stringify(obj);
  } else {
    str = JSON.stringify(obj, options.isJSON ? undefined : replacer, options.space);
  }

  // Protects against `JSON.stringify()` returning `undefined`, by serializing
  // to the literal string: "undefined".
  if (typeof str !== "string") {
    return String(str);
  }

  // Replace unsafe HTML and invalid JavaScript line terminator chars with
  // their safe Unicode char counterpart. This _must_ happen before the
  // regexps and functions are serialized and added back to the string.
  if (options.unsafe !== true) {
    str = str.replace(UNSAFE_CHARS_REGEXP, escapeUnsafeChars);
  }

  if (
    functions.length === 0 &&
    regexps.length === 0 &&
    dates.length === 0 &&
    maps.length === 0 &&
    sets.length === 0 &&
    arrays.length === 0 &&
    undefs.length === 0 &&
    infinities.length === 0 &&
    bigInts.length === 0 &&
    urls.length === 0
  ) {
    return str;
  }

  // Replaces all occurrences of function, regexp, date, map and set placeholders in the
  // JSON string with their string representations. If the original value can
  // not be found, then `undefined` is used.
  return str.replace(PLACE_HOLDER_REGEXP, function (match, backSlash, type, valueIndex) {
    // The placeholder may not be preceded by a backslash. This is to prevent
    // replacing things like `"a\"@__R-<UID>-0__@"` and thus outputting
    // invalid JS.
    if (backSlash) {
      return match;
    }

    if (type === "D") {
      return 'new Date("' + dates[valueIndex].toISOString() + '")';
    }

    if (type === "R") {
      return (
        "new RegExp(" +
        serializeJS(regexps[valueIndex].source) +
        ', "' +
        regexps[valueIndex].flags +
        '")'
      );
    }

    if (type === "M") {
      return "new Map(" + serializeJS(Array.from(maps[valueIndex].entries()), options) + ")";
    }

    if (type === "S") {
      return "new Set(" + serializeJS(Array.from(sets[valueIndex].values()), options) + ")";
    }

    if (type === "A") {
      return (
        "Array.prototype.slice.call(" +
        serializeJS(
          Object.assign({ length: arrays[valueIndex].length }, arrays[valueIndex]),
          options,
        ) +
        ")"
      );
    }

    if (type === "U") {
      return "undefined";
    }

    if (type === "I") {
      return infinities[valueIndex];
    }

    if (type === "B") {
      return 'BigInt("' + bigInts[valueIndex] + '")';
    }

    if (type === "L") {
      return "new URL(" + serializeJS(urls[valueIndex].toString(), options) + ")";
    }

    var fn = functions[valueIndex];

    return serializeFunc(fn);
  });
}

export { serializeJS, SerializeJSOptions };
