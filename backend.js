var fs = require("fs"),
    packageParser = require("./packageParser");

exports.savePackage = function(elisp, callback) {
    var pkg = packageParser.parse(elisp);
    fs.open("packages/" + pkg.name + ".el", "w", 0600, function(err, fd) {
        if (err) return callback(err, pkg);
        fs.write(fd, elisp, null, "utf8", function(err, written) {
            callback(err, pkg)
        });
    });
};
