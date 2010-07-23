exports.parse = function(str) {
    var parser = new Parser(str);
    return parser.exp();
};


var Parser = function(str) {
    this._str = str;
};

Parser.prototype.exp = function() {
    return this._sexp() || this._symbol() || this._number() || this._string();
};

Parser.prototype._tok = function(rx) {
    var match = this._str.match(new RegExp("^" + rx.source));
    if (!match) return false;
    this._str = this._str.substring(match[0].length);
    return match;
};

Parser.prototype._assert = function(rx) {
    var tok = this._tok(rx);
    if (tok) return tok;
    throw "Syntax error: expected " + rx + ", was " + this._str;
};

Parser.prototype._ws = function() {
    while (this._tok(/\s+/) || this._tok(/;[^\n]*/));
};

Parser.prototype._sexp = function() {
    if (!this._tok(/\(/)) return false;
    this._ws();
    var val = [];
    var exp;
    while (exp = this.exp()) {
        val.push(exp);
        this._ws();
    }
    this._assert(/\)/);
    return val;
};

Parser.prototype._symbol = function() {
    var tok = this._tok(/([^0-9.#"'()\[\]\\`\s]|\\.)([^#"'()\[\]\\`\s]|\\.)*/);
    if (!tok) return false;
    else return tok[0].replace(/\\(.)/g, '$1');
};

Parser.prototype._number = function() {
    var tok = this._tok(/[0-9]*(\.[0-9]+)/);
    if (!tok) return false;
    else return +tok[0];
};

Parser.prototype._string = function() {
    var tok = this._tok(/"((?:[^"]|\\.)*)"/);
    if (!tok) return false;
    else return tok[1].replace(/\\[ \n]/g, "").replace(/\\(.)/g, '$1');
};
