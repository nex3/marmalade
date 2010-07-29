var fs = require("fs"),
    sys = require("sys"),
    step = require("step"),
    _ = require("underscore")._,
    packageParser = require("./packageParser");

var pkgDir = __dirname + '/packages';

function pkgFile(name, type) {
    return pkgDir + '/' + name + "." + type;
};

exports.savePackage = function(elisp, callback) {
    var pkg = packageParser.parseElisp(elisp);
    step(
        function() {fs.open(pkgFile(pkg.name, 'el'), "w", 0600, this)},
        function(err, fd) {
            if (err) throw err;
            fs.write(fd, elisp, null, "utf8", this)
        },
        function(err, written) {callback(err, pkg)});
};

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
            if (err) throw err;

            if (_.isEqual(pkg.version, version)) {
                callback(null, data, pkg);
                return;
            }

            err = new Error("Don't have " + name + ".el version " +
                            version.join(".") + ", only version " +
                            pkg.version.join(".") + "\n");
            err.name = "WrongVersionError";
            throw err;
        });
};

exports.saveTarball = function(tar, callback) {
    var pkg;
    step(
        function() {packageParser.parseTar(tar, this)},
        function(err, pkg_) {
            if (err) throw err;
            pkg = pkg_;
            fs.writeFile(pkgDir + "/" + pkg.name + ".tar", tar, this);
        },
        function(err) {
            callback(err, pkg);
        })
};

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
