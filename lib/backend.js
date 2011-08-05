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
    streamUtil = require("./stream"),
    util = require("./util"),
    packageParser = require("./packageParser");


/**
 * An enum of MongoDB error codes.
 * @const
 */
var MongoError = {
    // Inserted a document that violated a unique index constraint.
    DUPLICATE_KEY: 11000
};


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
 * @param {string} hostname The name of the server on which this is running.
 *   Used for emails.
 * @param {function(Error=, Backend=} callback Called when the backend is fully
 *   loaded.
 * @return {Backend}
 */
exports.create = function(hostname, callback) {
    new Backend(hostname, callback);
};

/**
 * A class representing a Marmalade backend. This constructor may actually block
 * for a nontrivial amount of time.
 *
 * @param {string} hostname The name of the server on which this is running.
 *   Used for emails.
 * @param {function(Error=, Backend=} callback Called when the backend is fully
 *   loaded.
 * @constructor
 */
var Backend = function(hostname, callback) {
    var self = this;
    step(
        function() {
            self.email = "Marmalade Server <" + (process.env["USER"] || "") +
                "@" + hostname + ">";
            self.mongoServer_ = new mongodb.Server(
                  'localhost', mongodb.Connection.DEFAULT_PORT, {});
            new mongodb.Db('marmalade', self.mongoServer_).open(this);
        },
        function(err, db) {
            if (err) throw err;
            self.db_ = db;
            self.db_.collection('packages', self.checkErrorCb(this));
        },
        function(err, packages) {
            if (err) throw err;
            self.packages_ = packages;
            self.packages_.ensureIndex('_name', true /* unique */,
                                       self.checkErrorCb(this));
        },
        function(err) {
            if (err) throw err;
            self.db_.collection('packageVersions', self.checkErrorCb(this));
        },
        function(err, packageVersions) {
            if (err) throw err;
            self.packageVersions_ = packageVersions;
            self.packageVersions_.ensureIndex(
                  [['_name', 1], ['_version', 1]], true /* unique */,
                  self.checkErrorCb(this));
        },
        function(err) {
            if (err) throw err;
            self.db_.collection('users', self.checkErrorCb(this));
        },
        function(err, users) {
            if (err) throw err;
            self.users_ = users;
            self.users_.ensureIndex('_name', true /* unique */,
                                    self.checkErrorCb(this));
        },
        function(err) {
            if (err) throw err;
            return self;
        }, callback);
};

/**
 * The email address used as the From address for emails sent by Marmalade. At
 * time of writing, these are only password-reset email.
 *
 * Defaults to `Marmalade Server <$USER@hostname>`.
 *
 * @type {String}
 */
Backend.prototype.email;

/**
 * Returns the name of the GridFS file where the given package goes.
 *
 * @param {string} name The name of the package.
 * @param {string} type `"el"` or `"tar"`.
 * @param {Array.<number>} version The version of the package.
 * @return {string} The GridFS filename for the package.
 */
function pkgFile_(name, type, version) {
    return name + '.' + type + '/' + version.join('.');
};

/**
 * Converts a version array into a value suitable for use as an index for a
 * MongoDB document. This is necessary because Mongo treats array values as sets
 * rather than ordered arrays when looking up values on them.
 *
 * @param {Array.<number>} version The version array.
 * @return {Object} A usable index.
 */
function versionIx_(version) {
    var ix = {};
    for (var i = 0; i < version.length; i++) {
        ix[i] = version[i];
    }
    return ix;
};

/**
 * Read a file from the MongoDB GridStore. This used to use the native library's
 * grid implementation, but that ended up having many bizarre chunking and
 * encoding issues.
 * @param {string} filename The name of the file to read.
 * @param {function(Error=, Buffer=)} callback Passed the contents of the file.
 */
Backend.prototype.read_ = function(filename, callback) {
    var tempfile;
    step(
        function() {util.run('tempfile', ['-p', 'marmalade'], this)},
        function(err, tempfile_) {
            if (err) throw err;
            tempfile = tempfile_.replace(/\n$/, '');
            util.run('mongofiles',
                     ['get', '-d', 'marmalade', '-l', tempfile, filename],
                     this);
        },
        function(err) {
            if (err) throw err;
            fs.readFile(tempfile, this);
        },
        function(err, buf) {
            if (tempfile) fs.unlink(tempfile) // ignore errors from this
            if (err) throw err;
            return buf;
        },
        callback);
};

/**
 * Write a file to the MongoDB GridStore. This used to use the native library's
 * grid implementation, but that ended up having many bizarre chunking and
 * encoding issues.
 * @param {string} filename The name of the file to write.
 * @param {string|Buffer} data The data to write.
 * @param {function(Error=)} callback
 */
Backend.prototype.write_ = function(filename, data, callback) {
    var tempfile;
    step(
        function() {util.run('tempfile', ['-p', 'marmalade'], this)},
        function(err, tempfile_) {
            if (err) throw err;
            tempfile = tempfile_;
            fs.writeFile(tempfile, data, 'binary', this);
        },
        function(err) {
            if (err) throw err;
            util.run('mongofiles',
                     ['put', '-d', 'marmalade', '-l', tempfile, filename],
                     this);
        },
        function(err) {
            if (tempfile) fs.unlink(tempfile) // ignore errors from this
            if (err) throw err;
            this();
        },
        callback);
};

/**
 * Remove a file from the MongoDB GridStore. This used to use the native
 * library's grid implementation, but that ended up having many bizarre chunking
 * and encoding issues.
 * @param {string} filename The name of the file to remove.
 * @param {function(Error=)} callback
 */
Backend.prototype.rm_ = function(filename, callback) {
    util.run('mongofiles', ['delete', '-d', 'marmalade', filename], callback);
};

/**
 * Load the contents and metadata of a package from the backing store.
 * @param {string} name The name of the package to load.
 * @param {Array.<number>} version The version of the package to load.
 * @param {string} type "el" for single-file elisp packages or "tar"
 *   for multi-file tar packages.
 * @param {function(Error=, Buffer=, Object=)} callback Passed a buffer
 *   containing the package contents and a package version object.
 */
Backend.prototype.loadPackageData = function(name, version, type, callback) {
    var self = this;
    var key = {_name: this.key(name), _version: versionIx_(version)};
    var pkg;
    step(
        function() {
            self.packageVersions_.findOne(key, self.checkErrorCb(this))
        },
        function(err, pkg_) {
            if (!pkg_) return self.handleLoadError(name, version, this);

            pkg = pkg_;
            if (pkg.type === "single" ? type !== "el" : type !== "tar") {
                throw new exports.LoadError(
                    "Package " + name + " is in " + pkg.type + " format, not " +
                        type);
            }
            this();
        },
        function(err) {
            if (err) throw err;
            self.read_(pkgFile_(pkg._name, type, version), this);
        },
        function(err, data) {
            if (err) callback(err);
            else {
                // Doesn't *really* matter if these succeed
                self.packageVersions_.update(
                      key, {$inc: {downloads: 1}}, _.identity);
                self.packages_.update({_name: self.key(name)},
                                      {$inc: {downloads: 1}},
                                      _.identity);
                callback(null, data, pkg);
            }
        });
};


/**
 * Load the metadata for a package from the backing store.
 *
 * @param {string} name The name of the package to load.
 * @param {function(Error=, Object=)} callback Passed the package metadata,
 *   including the most recent package version.
 */
Backend.prototype.loadPackage = function(name, callback) {
    this.packages_.findOne({_name: this.key(name)}, callback)
};


/**
 * Load the metadata for a specific package version from the backing store.
 *
 * @param {string} name The name of the package to load.
 * @param {!Array.<number>} version The version of the package to load.
 * @param {function(Error=, Object=, Object=)} callback Passed the package
 *   metadata and the requested package version metadata. The package metadata
 *   will be null if and only if the package version metadata is null.
 */
Backend.prototype.loadPackageVersion = function(name, version, callback) {
    var self = this;
    var pkg;
    step(
        function() {self.packages_.findOne({_name: self.key(name)}, this)},
        function(err, pkg_) {
            if (err) throw err
            if (!pkg_) return callback(null, null, null);
            pkg = pkg_;
            self.packageVersions_.findOne({
                _name: self.key(name), _version: versionIx_(version)
            }, this);
        },
        function(err, pkgVersion) {
            if (err) throw err;
            if (!pkgVersion) return callback(null, null, null);
            callback(null, pkg, pkgVersion);
        });
};


/**
 * Present a useful error message to the user in the case that a package of a
 * given name and version wasn't found.
 *
 * @param {string} name The name of the package requested.
 * @param {Array.<number>} The version of the package requested.
 * @param {function(Error=)} callback
 */
Backend.prototype.handleLoadError = function(name, version, callback) {
  var self = this;
  step(
      function() {
          self.packageVersions_.findOne(
                {_name: self.key(name)},
                ['version'],
                {sort: {version: 1}},
                self.checkErrorCb(this));
      }, function(err, pkg) {
          if (err) throw err;
          if (!pkg) {
              throw new exports.LoadError(
                  "Package " + name + " does not exist");
          } else {
              throw new exports.LoadError(
                  "Package " + name + " doesn't have version " +
                      version.join(".") + ". Most recent version is " +
                      pkg.version.join(".") + "\n");
          }
      }, callback);
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
    if (type === 'el') this.saveElisp(data.toString('utf8'), user, callback);
    else if (type === 'tar') this.saveTarball(data, user, callback);
    else callback(new Error("Unknown filetype: " + type));
};

/**
 * Save a package, either in Elisp or Tarball format, that currently resides in
 * a file on disk to the Jarchive.
 * @param {string} file The name of the file on disk.
 * @param {Object} user The uploader of the package.
 * @param {string} type "el" for single-file elisp packages or "tar"
 *   for multi-file tar packages.
 * @param {functiom(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.savePackageFile = function(path, user, type, callback) {
    if (type === 'el') this.saveElispFile(path, user, callback);
    else if (type === 'tar') this.saveTarFile(path, user, callback);
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
    var pkgVer;
    var pkg;
    step(
        function() {
            try {
                pkgVer = packageParser.parseElisp(elisp);
            } catch (e) {
                if (e instanceof packageParser.SyntaxError) {
                    throw new exports.InputError("Parsing error: " + e.message);
                } else throw e;
            }
            self.savePackage_(pkgVer, user, this);
        },
        function(err, pkg_) {
            if (err) throw err;
            pkg = pkg_;
            self.write_(pkgFile_(pkgVer.name, 'el', pkgVer.version),
                        elisp, this);
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
            if (err instanceof packageParser.SyntaxError) {
                throw new exports.InputError("Parsing error: " + err.message);
            } else if (err) throw err;
            pkg = pkg_;
            fs.readFile(file, this);
        },
        function(err, tar) {
            if (err) throw err;
            self.saveTar_(pkg, tar, user, this);
        }, callback);
};

/**
 * Save an in-memory tarred package to the archive.
 * @param {Buffer} tar The tar data.
 * @param {Object} user The uploader of the tarball.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.saveTarball = function(tar, user, callback) {
    var self = this;
    step(
        function() {
            try {
                packageParser.parseTar(this)
            } catch (e) {
                console.log("2: " + e);
                exit(1);
            }
        },
        function(err, pkg) {
            if (err instanceof packageParser.SyntaxError) {
                throw new exports.InputError("Parsing error: " + err.message);
            } else if (err) throw err;
            self.saveTar_(pkg, tar, user, this);
        });
};

/**
 * Save a pre-parsed in-memory tarred package to the archive.
 * @param {Object} pkgVer The parsed package version metadata.
 * @param {Buffer} tar The tar data.
 * @param {Object} user The uploader of the tarball.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.saveTar_ = function(pkgVer, tar, user, callback) {
    var self = this;
    var pkg;
    step(
        function() {self.savePackage_(pkgVer, user, this)},
        function(err, pkg_) {
            if (err) throw err;
            pkg = pkg_;
            self.write_(pkgFile_(pkgVer.name, 'tar', pkgVer.version), tar, this);
        },
        function(err) {callback(err, pkg)});
};

/**
 * Save a package in the database with the default options.
 *
 * @param {Object} pkg The package.
 * @param {Object} user The user attempting to save the package.
 * @param {function(Error=, Object=)} callback Passed the package metadata.
 */
Backend.prototype.savePackage_ = function(pkg, user, callback) {
    var self = this;
    var pkgMeta;
    step(
        function() {
            self.packages_.findOne({_name: pkg._name}, this);
        },
        function(err, pkgMeta_) {
            if (err) throw err;
            pkgMeta = pkgMeta_;
            if (!pkgMeta) {
                self.saveNewPackage_(pkg, user, this);
            } else if (pkgMeta.owners[user._name]) {
                this();
            } else {
                throw new exports.PermissionsError(
                      'User "' + user.name + '" does not own package "' +
                          pkg.name + '"',
                      user, pkg);
            }
        },
        function(err, pkgMeta_) {
            if (err) throw err;
            pkgMeta = pkgMeta || pkgMeta_;
            pkg._version = versionIx_(pkg.version);
            self.packageVersions_.insert(pkg, self.checkErrorCb(this));
        },
        function(err) {
            if (err) {
                if (err.code == MongoError.DUPLICATE_KEY) {
                    throw new exports.InputError(
                          'Package "' + pkg.name + '" version ' +
                              pkg.version.join('.') + ' already exists');
                } else {
                    throw err;
                }
            }
            self.packages_.update(
                {_name: pkg._name},
                {$set: {_latestVersion: pkg}},
                self.checkErrorCb(this));
        },
        function(err) {
            if (err) throw err;
            pkgMeta.versions = [pkg];
            return pkgMeta;
        }, callback);
};

/**
 * Save a new package. This means that this is the first version yet uploaded
 * for this package name. This only saves to the package collection, not the
 * packageVersions collection.
 *
 * @param {Object} pkg The package object.
 * @param {Object} owner The user object for the user who's uploading the
 *   package.
 * @param {function(Error=, Object=)} callback Passed the metadata of the new
 *   package.
 */
Backend.prototype.saveNewPackage_ = function(pkg, owner, callback) {
    var self = this;
    var pkgMeta;
    step(
        function() {
            var owners = {};
            owners[owner._name] = owner.email;
            self.packages_.insert({
                _name: pkg._name,
                name: pkg.name,
                owners: owners
            }, self.checkErrorCb(this));
        },
        function(err, pkgMeta_) {
            // Don't need to check for duplicate key error since we've already
            // ensured that the package doesn't exist.
            if (err) throw err;
            pkgMeta = pkgMeta_[0];
            self.users_.update(
                {_name: owner._name},
                {$push: {packages: pkg._name}},
                self.checkErrorCb(this));
        },
        function(err) {
            if (err) throw err;
            return pkgMeta;
        }, callback);
};


/**
 * Add an owner for a package.
 *
 * @param {string} pkgName The name of the package.
 * @param {Object} owner The user object for a current owner of the package.
 * @param {string} newOwnerName The name of the owner being added.
 * @param {function(Error=)} callback
 */
Backend.prototype.addPackageOwner = function(
      pkgName, owner, newOwnerName, callback) {
    var pkgKey = this.key(pkgName);
    var self = this;
    step(
        function() {
            if (!_.include(owner.packages, pkgKey)) {
                throw new exports.PermissionsError(
                      'User "' + owner.name + '" does not own package "' +
                          pkgName + '"');
            }
            self.users_.findOne({_name: self.key(newOwnerName)},
                                {fields: ['_name', 'email']}, this);
        },
        function(err, newOwner) {
            if (err) throw err;
            if (!newOwner) { 
                throw new exports.InputError('No user named ' + newOwnerName);
            }

            var set = {};
            set['owners.' + newOwner._name] = newOwner.email;
            self.packages_.update(
                  {_name: pkgKey}, {$set: set}, this.parallel());

            self.users_.update({_id: newOwner._id},
                               {$addToSet: {packages: pkgKey}},
                               this.parallel());
        },
        function(err) {
            callback(err);
        });
};


/**
 * Remove an owner for a package.
 *
 * @param {string} pkgName The name of the package.
 * @param {Object} owner The user object for a current owner of the package.
 * @param {string} removedOwnerName The name of the owner being removed.
 * @param {function(Error=)} callback
 */
Backend.prototype.removePackageOwner = function(
      pkgName, owner, removedOwnerName, callback) {
    var pkgKey = this.key(pkgName);
    var self = this;
    step(
        function() {
            if (!_.include(owner.packages, pkgKey)) {
                throw new exports.PermissionsError(
                      'User "' + owner.name + '" does not own package "' +
                          pkgName + '"');
            }

            var unset = {};
            unset['owners.' + self.key(removedOwnerName)] = 1;
            self.packages_.update(
                  {_name: pkgKey}, {$unset: unset}, this.parallel());

            self.users_.update({_key: self.key(removedOwnerName)},
                               {$pull: {packages: pkgKey}},
                               this.parallel());
        },
        function(err) {
            callback(err);
        });
};


/**
 * Remove a package version, including its uploaded contents.
 *
 * @param {string} name The name of the package.
 * @param {!Array.<number>} version The version of the package to remove.
 * @param {function(Error=)} callback Called when the removal is finished.
 */
Backend.prototype.removePackageVersion = function(name, version, callback) {
    var self = this;
    var key = self.key(name);
    step(
        function() {
            console.log({
                _name: key,
                _version: versionIx_(version)
            });
            self.packageVersions_.findOne({
                _name: key,
                _version: versionIx_(version)
            }, {fields: ['type']}, this);
        },
        function(err, pkg) {
            if (err) throw err;
            if (!pkg) {
                throw new exports.LoadError(
                    "Package " + name + ", version " + version.join('.') +
                        " does not exist.");
            }
            self.rm_(pkgFile_(key, pkg.type, version), this);
        },
        function(err) {
            if (err) throw err;
            self.packageVersions_.remove({
                _name: key,
                _version: versionIx_(version)
            }, this);
        },
        function(err) {
            if (err) throw err;
            streamUtil.all(
                  self.packageVersionStream(
                        {_name: key}, [], {sort: [['$natural', 'descending']]}),
                  this);
        },
        function(err, pkgVer_) {
            if (err) throw err;
            pkgVer = pkgVer_ && pkgVer_[0];
            if (!pkgVer) {
                self.packages_.remove({_name: key}, this);
            } else {
                self.packages_.update(
                      {_name: key}, {$set: {_latestVersion: pkgVer}}, this);
            }
        }, callback);
};


/**
 * Remove a package entirely, including all its versions and their uploaded
 * contents.
 *
 * @param {string} name The name of the package.
 * @param {function(Error=)} callback Called when the removal is finished.
 */
Backend.prototype.removePackage = function(name, callback) {
    var self = this;
    var key = self.key(name);
    step(
        function() {
            streamUtil.all(self.packageVersionStream({_name: key}), this);
        },
        function(err, pkgVersions) {
            if (err) throw err;
            var next = this;
            _.each(pkgVersions, function(pkgVer) {
                // Ignore results from this
                self.rm_(pkgFile_(pkgVer._name, pkgVer.type, pkgVer.version),
                         function() {});
            });
            self.packageVersions_.remove({_name: key}, this.parallel());
            self.packages_.remove({_name: key}, this.parallel());
        },
        callback);
};


/**
 * Get a stream of the package version metadata for all packages.
 *
 * @param {Object} opt_selector Passed to `collection.find`. Default `{}`.
 * @param {Array.<string>} opt_fields Passed to `mongodb.Collection#find`.
 *   Default `[]`.
 * @param {Object} opt_opts Passed to `mongodb.Collection#find`. Default `{}`.
 * @return {EventEmitter} A stream of package version metadata. This works just
 *   like a standard node stream, except that the data are package version
 *   metadata objects.
 */
Backend.prototype.packageVersionStream = function(
      opt_selector, opt_fields, opt_opts) {
    return stream(this.packageVersions_, opt_selector, opt_fields, opt_opts);
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
Backend.prototype.packageStream = function(
      opt_selector, opt_fields, opt_opts) {
    opt_selector = opt_selector || {};
    if (!('_latestVersion' in opt_selector)) {
        opt_selector['_latestVersion'] = {$exists: true};
    }
    return stream(this.packages_, opt_selector, opt_fields, opt_opts);
};


/**
 * Get a stream of the package metadata matching a search query.
 *
 * @param {string} query The search query.
 * @param {Array.<string>} opt_fields Passed to `mongodb.Collection#find`.
 *   Default `[]`.
 * @param {Object} opt_opts Passed to `mongodb.Collection#find`. Default `{}`.
 * @return {EventEmitter} A stream of package metadata. This works just like a
 *   standard node stream, except that the data are package metadata objects.
 */
Backend.prototype.searchPackages = function(query, opt_fields, opt_opts) {
    // TODO: Use an actual full-text search engine.
    return this.packageStream(
        {_name: new RegExp(util.regexpEscape(this.key(query)))},
        opt_fields, opt_opts);
};


/**
 * Stream documents from a collection using the standard node stream interface.
 *
 * @param {mongodb.Collection} collection The collection to stream from.
 * @param {?Object} selector Passed to `collection.find`.
 * @param {?Array.<string>} opt_fields Passed to `mongodb.Collection#find`.
 * @param {?Object} opts Passed to `collection.find`.
 * @return {EventHandler} The stream.
 */
function stream(collection, selector, fields, opts) {
    var stream = new process.EventEmitter();
    if (!selector) selector = {};
    if (!fields) fields = [];
    if (!opts) opts = {};

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
    var key = this.key(name);
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
            self.users_.findOne({_name: key}, this);
        },
        function(err, user) {
            if (err) throw err;
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
                _name: key,
                name: name,
                email: email,
                digest: hashPassword(password, salt),
                salt: salt,
                token: token,
                packages: []
            };
            self.users_.insert(user, self.checkErrorCb(this));
        },
        function(err) {
            // Don't need to check for duplicate key since we've already ensured
            // that the user doesn't exist
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
    var key = this.key(user.name);
    step(
        function() {self.users_.findOne({_name: key}, this)},
        function(err, user) {
            if (!user)
                callback(new Error("Trying to save user " + user.name + ", " +
                                   "who doesn't exist"));
            self.users_.update({_name: key}, user, this);
        }, this.checkErrorCb(callback));
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
        function() {self.users_.findOne({_name: self.key(name)}, this)},
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
 * @param {function(Error=, Object=)} callback Passed the user object, or an
 *   InputError if the username or token was invalid.
 */
Backend.prototype.loadUserWithToken = function(name, token, callback) {
    var self = this;
    step(
        function() {self.users_.findOne({_name: self.key(name)}, this)},
        function(err, user) {
            if (err) throw err;
            if (!user || user.token !== token)
                throw new exports.InputError('Username or token invalid');
            return user;
        }, callback);
};


/**
 * Load the public information about a user.
 * @param {string} name The user's name.
 * @param {function(Error=, Object=)} callback Passed the user object, or null
 *   if the username was invalid.
 */
Backend.prototype.loadPublicUser = function(name, callback) {
    var self = this;
    self.users_.findOne({_name: this.key(name)}, {
        fields: ['_name', 'name', 'email', 'packages']
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
            self.users_.findOne({_name: self.key(name)}, this.group()());
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
 * Checks whether a given user owns a given package.
 *
 * @param {Object} user The user.
 * @param {string} packageName The name of the package.
 * @param {function(Error=)} callback Passed an error if the user doesn't own
 *     the package or something else goes wrong.
 */
Backend.prototype.checkPackageOwner = function(user, packageName, callback) {
    var self = this;
    step(
        function() {
            self.packages_.findOne({_name: self.key(packageName)},
                                   self.checkErrorCb(this));
        },
        function(err, pkg) {
            if (err) throw err;
            if (!pkg) {
                throw new exports.LoadError(
                      "Package " + packageName + " does not exist");
            } else if (user._name in pkg.owners) {
                return null;
            } else {
                throw new exports.PermissionsError(
                      'User "' + user.name + '" does not own package "' +
                          packageName + '"');
            }
        },
        callback);
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
            if (err) throw err;
            err = docs[0] && docs[0].err;
            if (err && _.isString(err)) {
                err = new Error(err);
                err.code = docs[0].code;
                err.ok = docs[0].ok;
            }
            callback(err, val);
        });
    };
};



/**
 * Sanitize a key for use in the database. This converts it to lower case and
 * replaces any `.` or `$` chars with their full-width unicode equivalents.
 *
 * @param {string} str The key to sanitize.
 * @return {string} The sanitized key.
 */
Backend.prototype.key = function(str) {
    return str.toLowerCase().replace('.', '\uff0e').replace('$', '\uff04');
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
    return hash.digest('base64');
};

