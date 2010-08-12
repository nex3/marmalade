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
    crypto = require("crypto"),
    step = require("step"),
    _ = require("underscore")._,
    nStore = require("nStore"),
    util = require("./util"),
    packageParser = require("./packageParser");

/**
 * The nStore database containing the package metadata.
 * @type {nStore.store}
 */
var store;

/**
 * An error class raised when the backend fails to load a given package. Note
 * that not all failed loads will cause this error in particular.
 * @constructor
 */
exports.LoadError = util.errorClass('LoadError');

/**
 * Initialize a Jelly backend. Note that this function may actually block for a
 * nontrivial amount of time.
 *
 * @param {string} dataDir The root of the backend's data store. This is used
 *   for storing various different sorts of data. It will be created if it
 *   doesn't already exist.
 * @param {function(Error=, Backend=} callback Called when the backend is fully
 *   loaded.
 * @return {Backend}
 */
exports.create = function(dataDir, callback) {
    new Backend(dataDir, callback);
};

/**
 * A class representing a Jelly backend. This constructor may actually block for
 * a nontrivial amount of time.
 *
 * @param {string} dataDir The root of the backend's data store. This is used
 *   for storing various different sorts of data.
 * @param {function(Error=, Backend=} callback Called when the backend is fully
 *   loaded.
 * @constructor
 */
var Backend = function(dataDir, callback) {
    this.dataDir_ = dataDir;
    var self = this;
    step(
        function () {util.run("mkdir", ["-p", dataDir + "/packages"], this)},
        function (err) {util.run("mkdir", ["-p", dataDir + "/packages"], this)},
        function (err) {
            if (err) throw err;
            self.packages_ = nStore(dataDir + "/packages.db");
            self.users_ = nStore(dataDir + "/users.db");
            return self;
        }, callback);
};

/**
 * Returns the location of a package file on disk. Santizes the name so the
 * location will always be in the proper directory.
 * @param {string} name The name of the package.
 * @param {string} type "el" for an Elisp package, "tar" for a tarball pacakge.
 * @return {string} The path to the actual package file.
 * @private
 */
Backend.prototype.pkgFile_ = function(name, type) {
    return this.dataDir_ + '/packages/' + name.replace(/\.\.+/g, '.') +
        "." + type;
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
Backend.prototype.loadPackage = function(name, version, type, callback) {
    var self = this;
    var pkg;
    step(
        function() {self.packages_.get(name, this)},
        function(err, pkg_) {
            if (!pkg_) {
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
            fs.readFile(self.pkgFile_(name, type), this)
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
Backend.prototype.savePackage = function(data, type, callback) {
    if (type === 'el') this.saveElisp(data.toString('utf8'), callback);
    else if (type === 'tar') this.saveTarball(data, callback);
    else callback(new Error("Unknown filetype: " + type));
};

/**
 * Save an Elisp package that currently resides in a file on disk to the
 * archive.
 * @param {string} file The name of the file where the Elisp code lives.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.saveElispFile = function(file, callback) {
    var self = this;
    step(
        function() {fs.readFile(file, "utf8", this)},
        function(err, elisp) {
            if (err) {
              callback(err);
              return;
            }
            self.saveElisp(elisp, this);
        }, callback);
};

/**
 * Save an in-memory Elisp package to the archive.
 * @param {string} elisp The Elisp package.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.saveElisp = function(elisp, callback) {
    var self = this;
    var pkg;
    step(
        function() {
            pkg = packageParser.parseElisp(elisp);
            return null;
        },
        function(err) {
            if (err) throw err;
            self.packages_.save(pkg.name, pkg, this);
        },
        function(err) {
            if (err) throw err;
            fs.writeFile(self.pkgFile_(pkg.name, 'el'), elisp, "utf8", this);
        },
        function(err) {callback(err, pkg)});
};

/**
 * Save a tarred package that currently resides in a file on disk to the archive.
 * @param {string} file The name of the tar file.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.saveTarFile = function(file, callback) {
    var self = this;
    var pkg;
    step(
        function() {packageParser.parseTarFile(file, this)},
        function(err, pkg_) {
            if (err) throw err;
            pkg = pkg_;
            self.packages_.save(pkg.name, pkg, this);
        },
        function(err) {
            if (err) throw err;
            util.run("mv", [file, self.pkgFile_(pkg.name, 'tar')], this);
        },
        function(err) {callback(err, pkg)});
};


/**
 * Save an in-memory tarred package to the archive.
 * @param {Buffer} tar The tar data.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.saveTarball = function(tar, callback) {
    var self = this;
    var pkg;
    step(
        function() {packageParser.parseTar(tar, this)},
        function(err, pkg_) {
            if (err) throw err;
            pkg = pkg_;
            self.packages_.save(pkg.name, pkg, this);
        },
        function(err) {
            if (err) throw err;
            fs.writeFile(self.pkgFile_(pkg.name, "tar"), tar, this);
        },
        function(err) {callback(err, pkg)});
};


/**
 * Get a stream of the package metadata for all packages.
 * @return {EventEmitter} A stream of package metadata. This works just like a
 *   standard node stream, except that the data are package metadata objects.
 */
Backend.prototype.packageStream = function() {
    // Currently, the stream from the store is actually precisely what we want.
    return this.packages_.stream();
};


exports.RegistrationError = util.errorClass('RegistrationError');

/**
 * Add a new user.
 *
 * @param {string} name The name of the user to register.
 * @param {string} password The user's password.
 * @param {function(Error=, Object=)} Passed the newly-created user object.
 */
Backend.prototype.registerUser = function(name, password, callback) {
    var self = this;
    var key = name.toLowerCase();;
    var user;
    step(
        function() {
            if (!name || name.length === 0)
                throw new exports.RegistrationError("Usernames can't be empty");
            if (!password || password.length <= 5)
                throw new exports.RegistrationError(
                    "Passwords must be at least six characters long.");
            if (self.users_.index[key])
                throw new exports.RegistrationError(
                    "User " + name + " already exists");

            util.run("openssl", ["rand", "-base64", "32"], this);
        },
        function(err, salt) {
            if (err) throw err;
            var hash = crypto.createHash('sha1');
            hash.update(password);
            hash.update(salt);
            var digest = hash.digest('base64');

            user = {
                name: name,
                digest: digest,
                salt: salt,
                packages: []
            };
            self.users_.save(key, user, this);
        },
        function(err) {
            if (err) throw err;
            return user;
        }, callback);
};


/**
 * Check the validity of a user's password and get that user's object.
 * @param {string} name The user's name.
 * @param {string} password The user's password.
 * @param {function(Error=, Object=} callback Passed the user object, or null if
 *   the username or password was invalid.
 */
Backend.prototype.loadUser = function(name, password, callback) {
    var key = name.toLowerCase();
    if (!this.users_.index[key]) callback(null, null);

    var self = this;
    step(
        function() {self.users_.get(name.toLowerCase(), this)},
        function(err, user) {
            if (err) throw err;
            if (!user) return null;

            var hash = crypto.createHash('sha1');
            hash.update(password);
            hash.update(user.salt);
            if (hash.digest('base64') != user.digest) return null;

            return user;
        }, callback);
};
