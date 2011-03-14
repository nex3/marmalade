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
 * This file actually parses the package files to extract the metadata. It does
 * so in several ways of various levels of hackiness. For Elisp files, it does
 * some simple regexp parsing to find and parse the headers. For tarballs, it
 * opens them up and reads their *-pkg.el file, parsing the call to
 * `(define-package)` in order to get at the metadata.
 */

var fs = require("fs"),
    sys = require("sys"),
    _ = require("underscore")._,
    step = require("step"),
    util = require("./util");
    sexpParser = require("./sexpParser");

/**
 * An error class raised when parsing packages fails.
 * @param {string} msg The error message.
 * @constructor
 */
var SyntaxError = exports.SyntaxError = util.errorClass('SyntaxError');

/**
 * Gets the value of all header declarations (e.g. ";; Version: 1.0") in an
 * Elisp package.
 * @param {string} elisp The package code.
 * @return {!Object.<string, string>} The headers (lower-case) and their values.
 */
function getHeaders(elisp) {
    var rx = new RegExp("^;;+[ \t]+(?:@\\(#\\))?[ \t]*\\$?([a-z\\-]+)" +
                        "[ \t]*:[ \t]+(.*)", "img");
    var headers = {};
    util.scan(elisp, rx, function(_, name, val) {
        if (val !== "") headers[name.toLowerCase()] = val;
    });
    return headers;
};

/**
 * Gets the contents of an entire header section. This means everything from the
 * opening ";;; Section Name" to the next section header that's as or more deep
 * than this section (exclusive). This strips leading comment characters.
 *
 * @param {string} elisp The package code.
 * @param {RegExp} rx The regular expression for matching the header.
 *   Automatically made case-insensitive.
 * @return {string} The section contents.
 *   markers.
 */
function getSection(elisp, rx) {
    startRx = new RegExp("^(;{3};*) (" + rx.source + ")[ \t]*:", "im");
    var startMatch = elisp.match(startRx);
    if (!startMatch) return null;
    elisp = elisp.substring(startMatch.index + startMatch[0].length);
    var level = startMatch[1].length;

    var endRx = new RegExp("^(;{3," + level + "} .*:|\\s*[^;\\s])", "m");
    var endMatch = elisp.match(endRx);
    if (!endMatch) throw new SyntaxError("Unterminated section: " +
                                         startMatch[2]);

    return elisp.substring(0, endMatch.index).replace(/\n;+ ?/g, '\n').trim();
};

/**
 * Get rid of the "$Revision: 1234$" annotation for a version string.
 * @param {string} str The version string.
 * @return {string} The version string without the Revision annotation.
 */
function stripRCS(str) {
    if (!str) return str;
    if (!str.match(/^[ \t]*\$Revision:[ \t]([0-9.]+)[ \t]*\$$/)) return str;
    return RegExp.$1;
};

/**
 * Like sexpParser.parse, but does typechecking and wraps any SyntaxErrors in
 * our own SyntaxError class.
 * @param {string} str The Elisp code to parse.
 * @param {function} type The expected type of the s-expression. Should be
 *   usable as the right-hand side of instanceof.
 * @return {*} The s-expression value.
 */
function parseSexp(str, type) {
    try {
        var sexp = sexpParser.parse(str);
        if (!(sexp instanceof type)) {
            throw new SyntaxError("Expected " + sys.inspect(sexp) + " to be of " +
                                  "type " + type);
        }
        return sexp;
    } catch (err) {
        if (err instanceof sexpParser.SyntaxError) {
            throw new SyntaxError(err.message);
        } else throw err;
    }
};

/**
 * Parse the value of the Package-Requires header. The header is a list of
 * name/version pairs; this returns an array of name/version pairs.
 * @param {string} str The Elisp code to parse.
 * @return {Array.<[string, Array.<number>]>} A list of
 *   package-name/version-number pairs that this package depends on.
 */
function parseRequires(str) {
    if (!str) return [];
    return _(parseSexp(str, Array)).map(function(require) {
        return [require[0], parseVersion(require[1])];
    });
};

/**
 * Parse a version number string.
 * @param {string} str The period-separated version number.
 * @return {Array.<number>} The parsed version number.
 */
function parseVersion(str) {
    return _(str.split(".")).map(function(s) {
        if (!s.match(/^\d+$/m)) {
            throw new SyntaxError("Version \"" + str + "\" must contain only " +
                                  "numbers separated by dots.");
        }
        return Number(s);
    });
};


/**
 * Parse an Elisp package and return its metadata.
 * @param {string} elisp The contents of an Elisp pacakge.
 * @return {Object} The package's metadata.
 */
exports.parseElisp = function(elisp) {
    var startMatch = elisp.match(/^;;; ([^ ]*)\.el --- (.*)$/m);
    if (!startMatch) throw new SyntaxError("No starting comment for package");

    var filename = startMatch[1];
    var desc = startMatch[2];

    var endRx = new RegExp("^(\\(provide[^)]+\\) +)?;;; " +
                           util.regexpEscape(filename) +
                           "\\.el ends here", "m");
    var endMatch = elisp.match(endRx);
    if (!endMatch) throw new SyntaxError("No closing comment for package");

    elisp = elisp.substring(startMatch.index, endMatch.index + endMatch[0].length);
    var headers = getHeaders(elisp);
    var requires = headers["package-requires"];
    var version = stripRCS(headers["package-version"] ||
                           headers["version"]);
    if (!version)
        throw new SyntaxError('Package does not have a "Version" or ' +
                              '"Package-Version" header');
    var commentary = getSection(elisp, /commentary|documentation/);

    requires = parseRequires(requires);
    version = parseVersion(version);

    return {
        _name: filename.toLowerCase(),
        name: filename,
        description: desc,
        commentary: commentary,
        headers: headers,
        requires: requires,
        version: version,
        type: "single"
    };
};

/**
 * Parse a call to (define-package). This obviously doesn't actually run any
 * expressions, so it will only work with static parameters. I think the same is
 * true for package.el, though.
 * @param {string} elisp The Emacs lisp containing the call to (define-package).
 * @return {Object} The package metadata.
 */
function parseDeclaration(elisp) {
    var sexp = parseSexp(elisp, Array);
    if (!sexp[0] === "define-package") {
        throw new SyntaxError("Expected a call to define-package");
    }

    var name = sexp[1];
    var version = parseVersion(sexp[2]);
    var desc = sexp[3];
    var requires = [];
    if (sexp[4]) {
        if (sexp[4][0] != "quote")
            throw new SyntaxError("Requires must be quoted");
        requires = _.map(sexp[4][1], function(require) {
            return [require[0], parseVersion(require[1])];
        });
    }

    return {
        _name: name.toLowerCase(),
        name: name,
        description: desc,
        requires: requires,
        version: version,
        type: "tar"
    };
};

/**
 * Parse a tarred package and return its metadata.
 * @param {Buffer} tar The tarball data.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
exports.parseTar = function(tar, callback) {
    parseTar_(function(tmpDir, cb) {
        util.run("tar", ["--extract", "--directory", tmpDir], tar, cb);
    }, callback);
};

/**
 * Parse a tarred package stored on disk and return its metadata.
 * @param {string} file The filename of the tarball.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
exports.parseTarFile = function(file, callback) {
    parseTar_(function(tmpDir, cb) {
        util.run("tar", ["--extract", "--directory", tmpDir, "--file", file], cb);
    }, callback);
};

/**
 * Helper function for tarball parsing.
 * @param {function(string, function(Error=, Object=))} getTar A function that
 *   runs the tar process to extract the package to a directory. Passed the
 *   directory to which to extract the package, and a callback.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
function parseTar_(getTar, callback) {
    var tmpDir;
    var name;
    var version;
    var pkg;
    step(
        function() {
            util.run("mktemp", ["-d", "-t", "marmalade.XXXXXXXXXX"], this);
        },
        function(err, output) {
            if (err) throw err;
            tmpDir = output.replace(/\n$/, "");
            getTar(tmpDir, this);
        },
        function(err) {
            if (err) throw err;
            fs.readdir(tmpDir, this);
        },
        function(err, files) {
            if (err) throw err;
            var match;
            if (files.length !== 1 ||
                !(match = files[0].match(/^(.+)-([0-9.]+)$/))) {
                throw new SyntaxError("ELPA archives must contain exactly one " +
                                      "directory, named <package>-<version>");
            }
            name = match[1];
            version = parseVersion(match[2]);
            var pkgGroup = this.group()();
            var headerGroup = this.group()();
            var readmeGroup = this.group()();
            step(
                function() {
                    fs.readFile(tmpDir + "/" + files[0] + "/" + name + "-pkg.el", "utf8", this);
                },
                function(err, elisp) {
                    if (err) throw err;
                    return parseDeclaration(elisp);
                }, pkgGroup);
            step(
                function() {
                    fs.readFile(tmpDir + "/" + files[0] + "/" + name + ".el", "utf8", this);
                },
                function(err, elisp) {
                    if (err) throw err;
                    return getHeaders(elisp);
                }, headerGroup);
            step(
                function() {
                    fs.readFile(tmpDir + "/" + files[0] + "/README", "utf8", this);
                },
                function(err, readme) {
                    if (err) readmeGroup();
                    readmeGroup(null, readme);
                });
        },
        function(err, pkg_, headers, readme) {
            if (err) throw err;
            pkg = pkg_[0];
            headers = headers[0];
            readme = readme[0];
            if (!_.isEqual(pkg.name, name)) {
                throw new SyntaxError("Package name \"" + pkg.name + "\" in " +
                                      name + "-pkg.el" + " doesn't match " +
                                      "archive name \"" + name + "\"!");
            } else if (!_.isEqual(pkg.version, version)) {
                throw new SyntaxError("Package version \"" +
                                      pkg.version.join(".") + "\" in " + name +
                                      "-pkg.el doesn't match archive version " +
                                      '"' + version.join(".") + '"!');
            }

            pkg.headers = headers;
            pkg.commentary = readme;
            return pkg;
        },
        function(err, pkg) {
            if (tmpDir) util.run("rm", ["-rf", tmpDir], function(){});
            if (err) throw err;
            return pkg;
        },
        callback);
};

/**
 * Parse a package of either type from a data buffer.
 * @param {Buffer} data The buffer containing the package data.
 * @param {string} type Either "el" or "tar".
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
exports.parsePackage = function(data, type, callback) {
    if (type == "el") {
        callback(null, exports.parseElisp(data.toString("utf8")));
    } else {
        exports.parseTar(data, callback);
    }
};
