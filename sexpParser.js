/**
 * This file parses Elisp. Unlike packageParser.js, this is an actual parser,
 * rather than being heuristic-based. However, it's limited to parsing only the
 * subset of Elisp that we actually receive from Emacs.
 */
var util = require("./util");

/**
 * An error class raised when parsing elisp fails.
 * @param {string} msg The error message.
 * @constructor
 */
var SyntaxError = exports.SyntaxError = util.errorClass('SyntaxError');

/**
 * Parse an Elisp s-expression. Lists become arrays, symbols and strings become
 * strings, numbers become numbers.
 * @param {string} str The Elisp code to parse.
 * @return {*} The JS value of the Elisp expression.
 */
exports.parse = function(str) {
    var parser = new Parser(str);
    return parser.exp();
};


/**
 * A class that maintains the parser state.
 * @param {string} str The string to parse.
 * @constructor
 */
var Parser = function(str) {
    this._str = str;
};

/**
 * Parses a single Elisp expression.
 * @return {*} The JS value of the Elisp expression.
 */
Parser.prototype.exp = function() {
    return this._sexp() || this._symbol() || this._number() || this._string();
};

/**
 * Consumes a token and moves the parser forward.
 * @param {RegExp} rx The token to consume.
 * @return {?Array} The match data for the token, or null if it wasn't matched.
 */
Parser.prototype._tok = function(rx) {
    var match = this._str.match(new RegExp("^" + rx.source));
    if (!match) return null;
    this._str = this._str.substring(match[0].length);
    return match;
};

/**
 * Consumes a token and moves the parser forward. If the token does not exist,
 * throws an error.
 * @param {RegExp} rx The token to consume.
 * @return {Array} The match data for the token.
 */
Parser.prototype._assert = function(rx) {
    var tok = this._tok(rx);
    if (tok) return tok;
    throw new SyntaxError("Lisp parser error: expected " + rx + ", was " +
                          this._str);
};

/**
 * Consumes whitespace and comments.
 */
Parser.prototype._ws = function() {
    while (this._tok(/\s+/) || this._tok(/;[^\n]*/));
};

/**
 * Parses a parenthesized list.
 * @return {?Array} The parsed list, or null if it wasn't matched.
 */
Parser.prototype._sexp = function() {
    if (!this._tok(/\(/)) return null;
    this._ws();
    var val = [];
    var exp;
    while ((exp = this.exp())) {
        val.push(exp);
        this._ws();
    }
    this._assert(/\)/);
    return val;
};

/**
 * Parses a symbol.
 * @return {?string} The symbol value, or null if it wasn't matched.
 */
Parser.prototype._symbol = function() {
    var tok = this._tok(/([^0-9.#"'()\[\]\\`\s]|\\.)([^#"'()\[\]\\`\s]|\\.)*/);
    if (!tok) return null;
    var sym = tok[0].replace(/\\(.)/g, '$1');
    sym.lispType = 'symbol';
    return sym;
};

/**
 * Parses a number.
 * @return {?number} The number value, or null if it wasn't matched.
 */
Parser.prototype._number = function() {
    var tok = this._tok(/[0-9]*(\.[0-9]+)/);
    if (!tok) return null;
    else return +tok[0];
};

/**
 * Parses a string.
 * @return {?string} The string value, or null if it wasn't matched.
 */
Parser.prototype._string = function() {
    var tok = this._tok(/"((?:[^"]|\\.)*)"/);
    if (!tok) return null;
    else return tok[1].replace(/\\[ \n]/g, "").replace(/\\(.)/g, '$1');
};
