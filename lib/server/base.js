/**
 * This file contains code that's shared among server components.
 */

/**
 * An error class raised when we want to send back a specific HTTP error code.
 * This is caught by the server and used to send back the appropriate response.
 * This can be useful to throw within a `step` sequence, since throwing is the
 * only way to do a somewhate-nonlocal exit.
 * @param {string} msg The error message.
 * @param {number} code The error code.
 */
var HttpError = util.errorClass(function HttpError(code) {
    this.code = code;
});
