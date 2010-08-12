/**
 * This file handles persisting the package data and metadata, as well as
 * extracting the metadata from the data.
 *
 * Currently the archive is just backed by the filesystem. This means that in
 * order to generate the list of package metadata, we have to parse each package
 * individually. This is obviously suboptimal and will change shortly.
 *
 * The "package metadata" referenced here and elsewhere is an object with the
 * following fields:
 *
 *   * *name*: The string name of the package.
 *   * *description*: A single-line description of the package, taken from the
 *         header line for Elisp packages.
 *   * *commentary*: An optional longer description of the package, taken from
 *         the Commentary section for Elisp packages and the README file for
 *         tarballs.
 *   * *requires*: An array of name/version pairs describing the dependencies of
 *         the package. The format for the versions is the same as the *version*
 *         field.
 *   * *version*: An array of numbers representing the dot-separated version.
 *   * *type*: Either "single" (for an Elisp file) or "tar" (for a tarball).
 *
 * For example, the metadata for `sass-mode` version 3.0.13 might look like:
 *
 *     {
 *       name: "sass-mode",
 *       description: "Major mode for editing Sass files",
 *       commentary: "Blah blah blah",
 *       requires: [["haml-mode", [3, 0, 13]]],
 *       version: [3, 0, 13],
 *       type: "single"
 *     }
 */

var fs = require("fs"),
    sys = require("sys"),
    step = require("step"),
    _ = require("underscore")._,
    nStore = require("nStore"),
    util = require("./util"),
    packageParser = require("./packageParser");

/**
 * The path to the directory where packages are stored.
 * @type {string}
 */
var pkgDir = __dirname + '/packages';

/**
 * The path to the database containing the package metadata.
 * @type {string}
 */
var dbFile = __dirname + '/jelly.db';

/**
 * The nStore database containing the package metadata.
 * @type {nStore.store}
 */
var store;

/**
 * Returns the location of a package file on disk. Santizes the name so the
 * location will always be beneath `pkgDir`.
 * @param {string} name The name of the package.
 * @param {string} type "el" for an Elisp package, "tar" for a tarball pacakge.
 * @return {string} The path to the actual package file.
 */
function pkgFile(name, type) {
    return pkgDir + '/' + name.replace(/\.\.+/g, '.') + "." + type;
};

/**
 * An error class raised when the backend fails to load a given package. Note
 * that not all failed loads will cause this error in particular.
 * @constructor
 */
exports.LoadError = util.errorClass('LoadError');

/**
 * Initialize the backend. This must be called before any other backend
 * functions. Note that this function may actually block for a nontrivial amount
 * of time.
 */
exports.init = function() {
    store = nStore(dbFile);
};

/**
 * Load the contents and metadata of a package from the backing store.
 * @param {string} name The name of the package to load.
 * @param {Array.<number>} version The version of the package to load.
 * @param {string} type "el" for single-file elisp packages or "tar"
 *   for multi-file tar packages.
 * @param {function(Error=, Buffer=, Object=)} callback
 *   Passed a buffer containing the package contents and a metadata object
 *   of the sort returned by packageParser.parse*.
 */
exports.loadPackage = function(name, version, type, callback) {
    var pkg;
    step(
        function() {store.get(name, this)},
        function(err, pkg_) {
            if (!pkg) {
                throw new exports.LoadError(
                    "Package " + name + " does not exist");
            }

            pkg = pkg_;

            if (pkg.type === "single" ? type !== "el" : type !== "tar") {
                throw new exports.LoadError(
                    "Package " + name + " is in " + pkg.type + " format, not " +
                        type);
            }

            if (!_.isEqual(pkg.version, version)) {
                throw new exports.LoadError(
                    "Don't have " + name + "." + type + " version " +
                        version.join(".") + ", only version " +
                        pkg.version.join(".") + "\n");
            }

            return null;
        },
        function(err) {
            if (err) throw err;
            fs.readFile(pkgFile(name, type), this)
        },
        function(err, data) {
            if (err) callback(err);
            else callback(null, data, pkg);
        });
};

/**
 * Save a package, either in Elisp or Tarball format, to the archive.
 * @param {Buffer} data The contents of the package.
 * @param {string} type "el" for single-file elisp packages or "tar"
 *   for multi-file tar packages.
 * @param {functiom(Error=, Object=)} callback Passed the package metadata.
 */
exports.savePackage = function(data, type, callback) {
    if (type === 'el') exports.saveElisp(data.toString('utf8'), callback);
    else if (type === 'tar') exports.saveTarball(data, callback);
    else callback(new Error("Unknown filetype: " + type));
};

/**
 * Save an Elisp package that currently resides in a file on disk to the
 * archive.
 * @param {string} file The name of the file where the Elisp code lives.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
exports.saveElispFile = function(file, callback) {
    step(
        function() {fs.readFile(file, "utf8", this)},
        function(err, elisp) {
            if (err) {
              callback(err);
              return;
            }
            exports.saveElisp(elisp, this);
        }, callback);
};

/**
 * Save an in-memory Elisp package to the archive.
 * @param {string} elisp The Elisp package.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
exports.saveElisp = function(elisp, callback) {
    var pkg;
    step(
        function() {
            pkg = packageParser.parseElisp(elisp);
            return null;
        },
        function(err) {
            if (err) throw err;
            store.save(pkg.name, pkg, this);
        },
        function(err) {
            if (err) throw err;
            fs.writeFile(pkgFile(pkg.name, 'el'), elisp, "utf8", this);
        },
        function(err) {callback(err, pkg)});
};

/**
 * Save a tarred package that currently resides in a file on disk to the archive.
 * @param {string} file The name of the tar file.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
exports.saveTarFile = function(file, callback) {
    var pkg;
    step(
        function() {packageParser.parseTarFile(file, this)},
        function(err, pkg_) {
            if (err) throw err;
            pkg = pkg_;
            store.save(pkg.name, pkg, this);
        },
        function(err) {
            if (err) throw err;
            util.run("mv", [file, pkgFile(pkg.name, 'tar')], this);
        },
        function(err) {callback(err, pkg)});
};


/**
 * Save an in-memory tarred package to the archive.
 * @param {Buffer} tar The tar data.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
exports.saveTarball = function(tar, callback) {
    var pkg;
    step(
        function() {packageParser.parseTar(tar, this)},
        function(err, pkg_) {
            if (err) throw err;
            pkg = pkg_;
            store.save(pkg.name, pkg, this);
        },
        function(err) {
            if (err) throw err;
            fs.writeFile(pkgFile(pkg.name, "tar"), tar, this);
        },
        function(err) {callback(err, pkg)});
};


/**
 * Get a list of the metadata for all packages in the archive.
 * @param {function(Error=, Array.<Object>=)} callback Passed a list of all
 *   package metadata.
 */
exports.getPackages = function(callback) {
    store.all(callback);
};
