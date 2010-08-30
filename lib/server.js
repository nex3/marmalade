/**
 * The actual faux-ELPA server. The main job of this file is to hook up the
 * backend to an HTTP interface. This interface is a superset of ELPA's, and so
 * can be used as a package.el source. So far, the only extensions have to do
 * with presenting a web frontend (basically nonexistent at time of writing) and
 * providing facilities for user-uploaded packages.
 */

var Buffer = require("buffer").Buffer,
    queryString = require("querystring"),
    sys = require("sys"),
    connect = require("connect"),
    mime = require("connect/utils").mime,
    express = require("express"),
    step = require("step");
    backend = require("./backend"),
    sexp = require("./sexp").sexp,
    util = require("./util"),
    base = require("./server/base"),
    api = require("./server/api"),
    ui = require("./server/ui");


/**
 * Teach connect the Elisp mime type.
 */
mime.types['.el'] = 'text/x-script.elisp';

/**
 * Connect middleware that extends the request and response objects with useful
 * Jelly-specific functionality.
 */
function extensions(req, res, next) {
    /**
     * Extend res.send so that sent objects are rendered as either Elisp or
     * JSON, depending on the Accept headers.
     */
    var oldSend = res.send;
    res.send = function(body, headers, status) {
        // Allow status as second arg
        if (typeof headers === 'number') {
            status = headers,
            headers = null;
        }

        // Defaults
        status = status || 200;
        headers = headers || {};

        if (typeof body === 'object' && !(body instanceof Buffer) &&
              req.accepts('el') && !req.accepts('json')) {
            this.contentType('.el');
            body = sexp(body);
        }

        oldSend.call(this, body, headers, status);
    };

    /**
     * Gets a parameter, or throws an error if it doesn't exist.
     * @param {string} name The name of the parameter.
     * @return {string} value The value of the paramter.
     */
    req.requiredParam = function(name) {
        var val = this.param(name);
        if (val) return val;
        throw new base.HttpError('Required parameter "' + name + '" not given',
                                 400);
    };

    next();
};

/**
 * Create a Jelly server. This is a standard Express application, with routes
 * and configuration set up for Jelly. To start it, just call
 * `.create().listen()`.
 * @param {string} dataDir The root of the Jelly backend's data store.
 * @param {function(Error=, express.Server=)} callback Called with the new
 *   server.
 */
exports.create = function(dataDir, callback) {
    var app = express.createServer();

    /**
     * The Jelly backend. This will be set once the caller receives the app.
     * @type {backend.Backend}
     */
    app.backend = null;


    /** ## Configuration
     *
     * Logging is handy and gzipping is nice. I don't think `conditionalGet`
     * works without some effort on the server's part, so it's here as a
     * reminder to do that at some point.
     */

    app.configure(function() {
        app.set('views', __dirname + '/views');
        app.use(connect.logger());
        app.use(connect.gzip());
        app.use(connect.conditionalGet());
        app.use(connect.bodyDecoder());
        app.use(extensions);
    });


    /** # Routing
     *
     * The UI lives in `server/ui.js`.
     *
     * The API lives in `server/api.js`.
     */
    ui.install(app);
    api.install(app);


    /** ## Error Handling */

    /**
     * HttpErrors mean that we should send back a specific response code.
     */
    app.error(function(err, req, res, next) {
        if (err instanceof base.HttpError) {
            res.send({message: err.message}, err.code);
        } else next(err, req, res);
    });

    /**
     * Handle other errors using the standard error handler.
     */
    app.configure('development', function() {
        app.use(connect.errorHandler({dumpExceptions: true, showStack: true}));
    });

    app.configure('production', function() {
        app.use(connect.errorHandler());
    });


    /** ## Initialization */

    /**
     * Tell the user when we're ready to accept connections.
     */
    app.addListener('listening', function() {
        var address = app.address();
        var hostname = address.address;
        if (hostname === "0.0.0.0") hostname = "localhost";
        console.log("Jelly's spread all over " + hostname + ":" + address.port);
    });

    /**
     * Initialize the backend before we let the user start the server.
     */
    console.log("Loading database...");
    step(
        function() {backend.create(dataDir, this)},
        function(err, be) {
            if (err) throw err;
            app.backend = be;
            return app;
        }, callback);
};
