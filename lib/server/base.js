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
 * This file contains code that's shared among server components.
 */

var util = require("../util");

/**
 * An error class raised when we want to send back a specific HTTP error code.
 * This is caught by the server and used to send back the appropriate response.
 * This can be useful to throw within a `step` sequence, since throwing is the
 * only way to do a somewhate-nonlocal exit.
 * @param {string} msg The error message.
 * @param {number} code The error code.
 */
exports.HttpError = util.errorClass(function HttpError(code) {
    this.code = code;
});

/**
 * An error class raised when we want to render an error so that the user can
 * see it. Only used within the web UI.
 * @param {string} msg The error message.
 */
exports.UserError = util.errorClass('UserError');

/**
 * An error class raised when the user must log in to continue. This is caught
 * by the server, which redirects the user to the login page.
 */
exports.LoginRequired = util.errorClass('LoginRequired');
