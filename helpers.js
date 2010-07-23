var _ = require("underscore")._,
    sexp = require("./sexp");

exports.scope = {};
_.extend(exports.scope, sexp);
exports.scope._ = _;

exports.extend = _.bind(_.extend, {}, exports.scope);
