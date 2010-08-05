var sys = require("sys"),
    _ = require("underscore")._;

exports.string = function(str) {
    return '"' + str.replace(/["\\]/g, '\\$&') + '"';
};

exports.symbol = function(str) {
    return str.replace(/[#"'()\[\]\\`\s]|^[0-9.]/g, '\\$&')
};

exports.keyword = function(str) {
    return ":" + exports.symbol(str);
};

function listLike(arr) {
    return _(arr).map(exports.sexp).join(" ");
};

exports.list = function(arr) {
    return "(" + listLike(arr) + ")";
};

exports.vector = function(arr) {
    return "[" + vector(arr) + "]";
};

exports.bool = function(bool) {
    return bool ? "t" : "nil";
};

exports.number = function(num) {
    return num.toString();
};

exports.sexp = function(obj) {
    if (_.isNull(obj) || _.isUndefined(obj)) {
        return 'nil';
    } else if (obj.toSexp) {
        return obj.toSexp();
    } else if (obj.lispType) {
        switch (obj.lispType) {
        case 'string': return exports.string(obj);
        case 'symbol': return exports.symbol(obj);
        case 'keyword': return exports.keyword(obj);
        case 'list': return exports.list(obj);
        case 'vector': return exports.vector(obj);
        } 
    } else if (_.isString(obj)) {
        return exports.string(obj);
    } else if (_.isArray(obj))  {
        return exports.list(obj);
    } else if (_.isBoolean(obj)) {
        return exports.bool(obj);
    } else if (_.isNumber(obj)) {
        return exports.number(obj);
    } else {
        throw new Error("Cannot convert to sexp: " + sys.inspect(obj));
    }
};
