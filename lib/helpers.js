/**
 * This file sets up the helper context for views. At time of writing, the only
 * such view is for `/packages/archive-contents`, which generates Elisp, so this
 * is focused on making Elisp-generation easy.
 */

var _ = require("underscore")._,
    sexp = require("./sexp");

/**
 * The helper scope. All proprties of this object will be available at top-level
 * in the views.
 */
exports.scope = {};

/**
 * Make all sexp functions available at top-level.
 */
_.extend(exports.scope, sexp);

/**
 * Make underscore.js's function available at toplevel, too.
 */
exports.scope._ = _;

/**
 * Extend the default helper scope with extra properties.
 * @param {Object} props The properties to make available at top-level.
 * @return {Object} The new scope, including the given properties.
 */
exports.extend = _.bind(_.extend, {}, exports.scope);
