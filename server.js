var connect = require("connect"),
    express = require("express");

exports.create = function(middleware) {
    var app = express.createServer(
        connect.logger(),
        connect.gzip(),
        connect.errorHandler(),
        connect.conditionalGet()
    );
    app.use('/packages', connect.staticProvider(__dirname + '/packages'));

    app.addListener('listening', function() {
        var address = app.address();
        var hostname = address.address;
        if (hostname === "0.0.0.0") hostname = "localhost";
        console.log("Jelly's spread all over " + hostname + ":" + address.port);
    });

    app.get('/', function(req, res) {
        res.send("<h1>Jelly - Elisp Packages on Toast</h1>");
    });

    return app;
};
