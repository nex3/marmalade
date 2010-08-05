var fs = require("fs"),
    sys = require("sys"),
    step = require("step"),
    _ = require("underscore")._,
    util = require("./util"),
    packageParser = require("./packageParser");

/**
 * The path to the directory where packages are stored.
 * @type {string}
 */
var pkgDir = __dirname + '/packages';

/**
 * Returns the location of a package file on disk. Santizes the name so the
 * location will always be beneath {@link pkgDir}.
 * @param {string} name The name of the package.
 * @param {string} type "el" for an Elisp package, "tar" for a tarball pacakge.
 * @return {string} The path to the actual package file.
 */
function pkgFile(name, type) {
    return pkgDir + '/' + name.replace(/\.\.+/g, '.') + "." + type;
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
    var data;
    step(
        function() {fs.readFile(pkgFile(name, type), this)},
        function(err, data_) {
            if (err) throw err;
            data = data_;
            packageParser.parsePackage(data, type, this);
        },
        function(err, pkg) {
            if (err) {
              callback(err);
              return;
            }

            if (_.isEqual(pkg.version, version)) {
                callback(null, data, pkg);
                return;
            }

            err = new Error("Don't have " + name + ".el version " +
                            version.join(".") + ", only version " +
                            pkg.version.join(".") + "\n");
            err.name = "WrongVersionError";
            callback(err);
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
        function() {pkg = packageParser.parseElisp(elisp)},
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
    step(
        function() {fs.readdir('packages', this)},
        function(err, files) {
            if (err) throw err;

            var fileGroup = this.group();
            _(files).each(function(file) {
                var cb = fileGroup();
                fs.readFile(pkgDir + '/' + file, function(err, data) {
                    cb(null, [file, data]);
                });
            });
        },
        function(err, packages) {
            if (err) throw err;
            var pkgGroup = this.group();
            _(packages).each(function(pkg) {
                var file = pkg[0],
                    data = pkg[1];
                packageParser.parsePackage(
                    data, file.match(/\.([a-z]+)$/)[1], pkgGroup());
            });
        },
        callback);
};
