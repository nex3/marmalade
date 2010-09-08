/*!*
 * Marmalade: an Emacs Lisp package server.
 * Copyright (C) 2010 Google Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

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
