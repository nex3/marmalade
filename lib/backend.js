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
 * This file handles persisting the package data and metadata, as well as
 * extracting the metadata from the data.
 *
 * Currently the archive is just backed by the filesystem. This means that in
 * order to generate the list of package metadata, we have to parse each package
 * individually. This is obviously suboptimal and will change shortly.
 *
 * The "package metadata" referenced here and elsewhere is described in the
 * marmalade-api(7) manpage, under Packages.
 */

var fs = require("fs"),
    sys = require("sys"),
    crypto = require("crypto"),
    step = require("step"),
    _ = require("underscore")._,
    mongodb = require("mongodb"),
    Email = require("email").Email,
    util = require("./util"),
    packageParser = require("./packageParser");


/**
 * An exception class raised when invalid user input causes a backend operation
 * to fail.
 * @constructor
 */
exports.InputError = util.errorClass('InputError');


/**
 * An error class raised when the backend fails to load a given package. Note
 * that not all failed loads will cause this error in particular.
 * @constructor
 */
exports.LoadError = util.errorClass('LoadError');

/**
 * Initialize a Marmalade backend. Note that this function may actually block
 * for a nontrivial amount of time.
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
 * A class representing a Marmalade backend. This constructor may actually block
 * for a nontrivial amount of time.
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
        function (err) {
            if (err) throw err;
            util.run("hostname", [], this);
        },
        function (err, hostname) {
            if (err) throw err;
            self.email = "Marmalade Server <" + (process.env["USER"] || "") +
                "@" + hostname + ">";
            self.mongoServer_ = new mongodb.Server(
                  'localhost', mongodb.Connection.DEFAULT_PORT, {});
            new mongodb.Db('marmalade', self.mongoServer_).open(this);
        },
        function(err, db) {
            if (err) throw err;
            self.db_ = db;
            self.db_.collection('packages', this);
        },
        function(err, packages) {
            if (err) throw err;
            self.packages_ = packages;
            self.db_.collection('users', this);
        },
        function(err, users) {
            if (err) throw err;
            self.users_ = users;
            return self;
        }, callback);
};

/**
 * The email address used as the From address for emails sent by Marmalade. At
 * time of writing, these are only password-reset email.
 *
 * Defaults to `Marmalade Server <$USER@$HOSTNAME>`. `$HOSTNAME` is taken from
 * the `hostname` command-line program.
 *
 * @type {String}
 */
Backend.prototype.email;

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
        function() {self.packages_.findOne({'_id': name.toLowerCase()}, this)},
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
 * An error class that's raised when users try to modify packages they don't
 * own.
 * @constructor
 * @param {Object} user The user object.
 * @param {Object} package The package the user attempted to modify, in
 *     unmodified form.
 */
exports.PermissionsError = util.errorClass(
    function PermissionsError(user, pkg) {
        this.user = user;
        this.pkg = pkg;
    });

/**
 * Save a package, either in Elisp or Tarball format, to the archive.
 * @param {Buffer} data The contents of the package.
 * @param {Object} user The uploader of the package.
 * @param {string} type "el" for single-file elisp packages or "tar"
 *   for multi-file tar packages.
 * @param {functiom(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.savePackage = function(data, user, type, callback) {
    if (type === 'el') this.saveElisp(data.toString('utf8'), callback);
    else if (type === 'tar') this.saveTarball(data, user, callback);
    else callback(new Error("Unknown filetype: " + type));
};

/**
 * Save an Elisp package that currently resides in a file on disk to the
 * archive.
 * @param {string} file The name of the file where the Elisp code lives.
 * @param {Object} user The uploader of the Elisp package.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.saveElispFile = function(file, user, callback) {
    var self = this;
    step(
        function() {fs.readFile(file, "utf8", this)},
        function(err, elisp) {
            if (err) {
              callback(err);
              return;
            }
            self.saveElisp(elisp, user, this);
        }, callback);
};

/**
 * Save an in-memory Elisp package to the archive.
 * @param {string} elisp The Elisp package.
 * @param {Object} user The uploader of the Elisp package.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.saveElisp = function(elisp, user, callback) {
    var self = this;
    var pkg;
    step(
        function() {
            pkg = packageParser.parseElisp(elisp);
            self.checkOwner_(pkg, user, this);
        },
        function(err) {
            if (err) throw err;
            self.savePackage_(pkg, this);
        },
        function(err) {
            if (err) throw err;
            fs.writeFile(self.pkgFile_(pkg.name, 'el'), elisp, "utf8", this);
        },
        function(err) {
            if (err) throw err;
            self.saveUser(user, this);
        },
        function(err) {callback(err, pkg)});
};

/**
 * Save a tarred package that currently resides in a file on disk to the archive.
 * @param {string} file The name of the tar file.
 * @param {Object} user The uploader of the tar file.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.saveTarFile = function(file, user, callback) {
    var self = this;
    var pkg;
    step(
        function() {packageParser.parseTarFile(file, this)},
        function(err, pkg_) {
            if (err) throw err;
            pkg = pkg_;
            self.checkOwner_(pkg, user, this);
        },
        function(err) {
            if (err) throw err;
            self.savePackage_(pkg, this);
        },
        function(err) {
            if (err) throw err;
            util.run("mv", [file, self.pkgFile_(pkg.name, 'tar')], this);
        },
        function(err) {
            if (err) throw err;
            self.saveUser(user, this);
        },
        function(err) {callback(err, pkg)});
};


/**
 * Save an in-memory tarred package to the archive.
 * @param {Buffer} tar The tar data.
 * @param {Object} user The uploader of the tarball.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.saveTarball = function(tar, user, callback) {
    var self = this;
    var pkg;
    step(
        function() {packageParser.parseTar(tar, this)},
        function(err, pkg_) {
            if (err) throw err;
            pkg = pkg_;
            self.checkOwner_(pkg, user, this);
        },
        function(err) {
            self.savePackage_(pkg, this);
        },
        function(err) {
            if (err) throw err;
            fs.writeFile(self.pkgFile_(pkg.name, "tar"), tar, this);
        },
        function(err) {
            if (err) throw err;
            self.saveUser(user, this);
        },
        function(err) {callback(err, pkg)});
};


/**
 * Save a package in the database with the default options.
 *
 * @param {Object} pkg The package.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.savePackage_ = function(pkg, callback) {
    pkg._id = pkg.name.toLowerCase();
    this.packages_.update({'_id': pkg._id}, pkg, {upsert: true},
                          this.checkErrorCb(callback));
};


/**
 * Ensures that the given user is in fact an owner of the given (just parsed)
 * package. If the package does not yet exist, adds the user as an owner.
 *
 * @param {Object} pkg The package metadata.
 * @param {Object} uesr The user object.
 * @param {Function(Error=)} callback
 */
Backend.prototype.checkOwner_ = function(pkg, user, callback) {
    var self = this;
    step(
        function() {
            self.packages_.findOne({'_id': pkg.name.toLowerCase()}, this)
        },
        function(err, oldPkg) {
            if (err) throw err;
            var name = user.name.toLowerCase();

            // Package doesn't exist yet
            if (!oldPkg) {
                pkg.owners[name] = true;
                user.packages[pkg.name] = true;
                return null;
            }

            if (!oldPkg.owners[name]) {
                throw new exports.PermissionsError(
                    'User "' + user.name + '" does not own package "' +
                        oldPkg.name + '"',
                    user, oldPkg);
            }
            pkg.owners = oldPkg.owners;
            return null;
        }, callback);
};


/**
 * Get a stream of the package metadata for all packages.
 *
 * @param {Object} opt_selector Passed to `collection.find`. Default `{}`.
 * @param {Array.<string>} opt_fields Passed to `mongodb.Collection#find`.
 *   Default `[]`.
 * @param {Object} opt_opts Passed to `mongodb.Collection#find`. Default `{}`.
 * @return {EventEmitter} A stream of package metadata. This works just like a
 *   standard node stream, except that the data are package metadata objects.
 */
Backend.prototype.packageStream = function(opt_selector, opt_fields, opt_opts) {
    if (!opt_selector) opt_selector = {};
    if (!opt_fields) opt_fields = [];
    if (!opt_opts) opt_opts = {};
    return stream(this.packages_, opt_selector, opt_fields, opt_opts);
};


/**
 * Stream documents from a collection using the standard node stream interface.
 *
 * @param {mongodb.Collection} collection The collection to stream from.
 * @param {Object} selector Passed to `collection.find`.
 * @param {Array.<string>} opt_fields Passed to `mongodb.Collection#find`.
 * @param {Object} opts Passed to `collection.find`.
 * @return {EventHandler} The stream.
 */
function stream(collection, selector, fields, opts) {
    var stream = new process.EventEmitter();

    collection.find(selector, fields, opts, function(err, cursor) {
        if (err) {
            stream.emit('err', err);
            return;
        }

        var handler = function(err, obj) {
            if (err) {
                stream.emit('err', err);
                return;
            }

            if (obj == null) {
                stream.emit('end');
                return;
            }

            stream.emit('data', obj);
            cursor.nextObject(handler);
        };
        cursor.nextObject(handler);
    });

    return stream;
}


/**
 * Add a new user.
 *
 * @param {string} name The name of the user to register.
 * @param {string} email The email address of the user to register.
 * @param {string} password The user's password.
 * @param {function(Error=, Object=)} Passed the newly-created user object.
 */
Backend.prototype.registerUser = function(name, email, password, callback) {
    var self = this;
    var key = name.toLowerCase();
    var token;
    var user;
    step(
        function() {
            if (!name || name.length === 0)
                throw new exports.InputError("Usernames can't be empty");
            if (!password || password.length <= 5)
                throw new exports.InputError(
                    "Passwords must be at least six characters long.");
            // TODO: check for email uniqueness and allow password resets
            // without specifying a username.
            if (!email.match(/.+@.+/)) // emails are crazy, so be very liberal
                throw new exports.InputError("Invalid email address: " + email);
            self.users_.findOne({'_id': key}, this);
        },
        function(err, user) {
            if (user)
                throw new exports.InputError(
                    "User " + name + " already exists");

            util.run("openssl", ["rand", "-base64", "32"], this);
        },
        function(err, token_) {
            if (err) throw err;
            token = token_.replace(/\n$/, '');
            util.run("openssl", ["rand", "-base64", "32"], this);
        },
        function(err, salt) {
            if (err) throw err;

            user = {
                '_id': key,
                name: name,
                email: email,
                digest: hashPassword(password, salt),
                salt: salt,
                token: token,
                packages: {}
            };
            self.users_.insert(user, self.checkErrorCb(this));
        },
        function(err) {
            if (err) throw err;
            return user;
        }, callback);
};


/**
 * Save an update to an existing user record. This automatically hashes the
 * `password` key of the user object.
 *
 * @param {Object} user The user object.
 * @param {function(Error=)} callback
 */
Backend.prototype.saveUser = function(user, callback) {
    if (user.password) {
        var password = user.password;
        delete user.password;
        user.digest = hashPassword(password, user.salt);
    }

    var self = this;
    var key = user.name.toLowerCase();
    step(
        function() {self.users_.findOne({'_id': key}, this)},
        function(err, user) {
            if (!user)
                callback(new Error("Trying to save user " + user.name + ", " +
                                   "who doesn't exist"));
            this.users_.update({'_id': key}, user, this.checkErrorCb(callback));
        });
};


/**
 * Check the validity of a user's password and get that user's object.
 * @param {string} name The user's name.
 * @param {string} password The user's password.
 * @param {function(Error=, Object=} callback Passed the user object, or null if
 *   the username or password was invalid.
 */
Backend.prototype.loadUser = function(name, password, callback) {
    var self = this;
    step(
        function() {self.users_.findOne({'_id': name.toLowerCase()}, this)},
        function(err, user) {
            if (err) throw err;
            if (!user) return null;

            if (hashPassword(password, user.salt) != user.digest) return null;

            return user;
        }, callback);
};


/**
 * Check the validity of a user's token and get that user's object.
 * @param {string} name The user's name.
 * @param {string} token The user's token.
 * @param {function(Error=, Object=} callback Passed the user object, or null if
 *   the username or token was invalid.
 */
Backend.prototype.loadUserWithToken = function(name, token, callback) {
    var self = this;
    step(
        function() {self.users_.findOne({'_id': name.toLowerCase()}, this)},
        function(err, user) {
            if (err) throw err;
            if (!user || user.token !== token) return null;
            return user;
        }, callback);
};


/**
 * Reset the password for the given user, and send them an email containing this
 * password.
 *
 * The email is sent via sendmail. The From address is taken from
 * `Backend#email`.
 *
 * @param {string} name The user's name.
 * @param {function(Error=)} callback
 */
Backend.prototype.resetPassword = function(name, callback) {
    var user, password;
    var self = this;
    step(
        function() {
            self.users_.findOne({'_id': name.toLowerCase()}, this.group()());
            util.run("openssl", ["rand", "-hex", "10"], this.group()());
        },
        function(err, user_, password_) {
            if (err) throw err;
            user = user_[0];
            user.password = password_[0].replace(/\n$/, '');
            if (!user) throw new exports.InputError(
                "User " + name + " doesn't exist");
            self.saveUser(user, this);
        },
        function(err) {
            if (err) throw err;
            new Email({
                to: user.email,
                from: self.email,
                subject: "Marmalade password reset",
                body: "Temporary password: " + password
            }).send(this);
        }, callback);
};


/**
 * Wraps a callback for MongoDB with error handling.
 * Before the callback is run, this checks for an error,
 * and passes that error in the standard node style.
 * For some reason, the mongo API doesn't do this itself.
 *
 * @param {function(Error=, *=)} callback The wrapped callback.
 */
Backend.prototype.checkErrorCb = function(callback) {
    var self = this;
    return function(err, val) {
        if (err) {
            callback(err, val);
            return;
        }

        self.db_.error(function(err, docs) {
            callback(err || (docs[0] && docs[0].err), val);
        });
    };
};


/**
 * Hash a password for saving to the database.
 * @param {string} password
 * @param {string} salt
 * @private
 */
function hashPassword(password, salt) {
    var hash = crypto.createHash('sha1');
    hash.update(password);
    hash.update(salt);
    var digest = hash.digest('base64');
    console.log("Hashing " + password + ", " + salt + ": " + digest);
    return digest;
};
