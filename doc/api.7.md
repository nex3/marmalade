marmalade-api(7) -- the marmalade HTTP API
==========================================

## SUMMARY

Marmalade supports a simple HTTP interface for uploading packages.

## RESPONSE FORMAT

Marmalade can send responses either as JSON objects or Emacs Lisp assoc lists.
If the user agent sends `application/json` in its `Accept` header, it will be
served JSON. If it sends `text/x-script.elisp`, it will be served Elisp.
Otherwise, if nothing is specified, Marmalade will default to JSON.

All responses, including error responses, will have a `message` key. The value
of this key will be a human-readable description of the server event (or the
error).

All requests will return a 400 status if any required parameters are missing.

An example JSON response to a user registration might look like this:

    {
      "message": "Successfully registered nex3",
      "name": "nex3",
      "token": "some base64 token"
    }

The same response as Elisp might look like this:

    (
      (message . "Successfully registered nex3")
      (name . "nex3")
      (token , "some base64 token")
    )


## AUTHENTICATION

Every user has a randomly-generated 256-bit authentication token. This token and
the user's username are required for any request that needs authentication. The
username is case-insensitive, while the token is not.

All requests that require authentication will return a 400 status if the
authentication fails.

## USERS

Users are represented as objects with the following fields:

* `name`: The string name of the user.
* `packages`: A list of names of packages for which the user has the right to
    post updates.
* `created`: The date and time the user was created, as a timestamp integer.

For example, the user object for `nex3` might look like:

    {
      name: "nex3",
      packages: ["sass-mode", "haml-mode"],
      created: 1291252865000
    }

### GET /v1/users/:name

*Parameters*: `name`

*Response*: `user`

*Error Codes*: 404

Gets the user object for a given user.

This will have a 404 status if the user doesn't exist.

### POST /v1/users/login

*Parameters*: `name`, `password`

*Response*: `name`, `token`

*Error Codes*: 400

Gets the authentication token for a user. This is the only time the API requires
password authentication. The token can also be obtained from the web interface
(TODO: actually it can't yet).

This will have a 400 status if the username or password is wrong.

### POST /v1/users/reset

*Parameters*: `name`

*Error Codes*: 400

Resets a user's password. This generates a new, random password for the
user and sends that password to the email the user provided during
registration.

This will have a 400 status if the username isn't registered.

### POST /v1/users

*Parameters*: `name`, `email`, `password`

*Response*: `name`, `token`

*Error Codes*: 400

Registers a new user, and returns the authentication token for that user.

The email is only ever used for resetting lost passwords.

This will have a 400 status if the username was already taken, or the password
is invalid.

### PUT /v1/users

*Parameters*: `name`, `token`, `email`, `password`

*Error Codes*: 400

Updates a user's information. The `token` parameter is used for authentication.
Both the `password` parameter and the `email` parameter are optional. If either
is given, it overwrites the current value for that attribute.


## PACKAGES

Packages are represented as objects with the following fields:

* `name`: The string name of the package.
* `owners`: A list of names of users who have the right to post updates for
    the package.
* `created`: The date and time the package was created, as a timestamp integer.
* `versions`: A list of version objects containing data about an individual
    package version. These are ordered reverse-chronologically, meaning that the
    first version is the current one.

In turn, version objects have the following fields:

* `name`: The same as the package name.
* `description`: A single-line description of the package, taken from the
    header line for Elisp packages.
* `commentary`: An optional longer description of the package, taken from
    the Commentary section for Elisp packages and the README file for
    tarballs.
* `headers`: A map from (lower-case) header names to their values. Contains all
    the headers in the package, completely unprocessed.
* `requires`: An array of name/version pairs describing the dependencies of
    the package. The format for the versions is the same as the `version`
    field.
* `version`: An array of numbers representing the dot-separated version.
* `type`: Either "single" (for an Elisp file) or "tar" (for a tarball).

For example, the package for `sass-mode` might look like:

    {
      name: "sass-mode",
      owners: ["nex3"],
      created: 1287015817229,
      versions: [{
        name: "sass-mode",
        description: "Major mode for editing Sass files",
        commentary: "Blah blah blah",
        headers: {author: "Nathan Weizenbaum", ...},
        requires: [["haml-mode", [3, 0, 13]]],
        version: [3, 0, 13],
        type: "single",
        created: 1287693178133,
      }, {
        name: "sass-mode",
        description: "Major mode for editing Sass files",
        commentary: "Blah blah blah",
        headers: {author: "Nathan Weizenbaum", ...},
        requires: [["haml-mode", [3, 0, 12]]],
        version: [3, 0, 12],
        type: "single",
        created: 1287015817229,
      }]
    }


### GET /v1/packages/:package

*Parameters*: `package`

*Response*: `package`

*Error Codes*: 404

Gets the package object for a given package, including *all* versions of that
package. `package` should be the name of the package. If you only need a single
version, `/v1/packages/:package/:version` or `/v1/packages/:package/latest` is a
better choice.

The response will have a 404 status if the package doesn't exist.


### GET /v1/packages/:package/:version

*Parameters*: `package`, `version`

*Response*: `package`

*Error Codes*: 404

Gets the package object for a given package with a single version of that
package. If you need the most recent version of the package, use
`/v1/packages/:package/latest` instead. `package` should be the name of the
package.

The response will have a 404 status if the package doesn't exist or doesn't have
the given version.


### GET /v1/packages/:package/latest

*Parameters*: `package`

*Response*: `package`

*Error Codes*: 404

Gets the package object for a given package with the most recent (version-wise)
version of that package. `package` should be the name of the package.

The response will have a 404 status if the package doesn't exist or doesn't have
the given version.


### POST /v1/packages

*Parameters*: `name`, `token`, `package`

*Response*: `package`

*Error Codes*: 400, 403

Uploads a new package, or a new version of an existing package. This request
should use the `multipart/form-data` content type, with `name` and `token` as
fields and `package` as a file.

`package` can be either a single Elisp file or a tarball containing multiple
files. In either case, it must conform to the [ELPA packaging
standards](http://tromey.com/elpa/upload.html).

This returns the package object that has been parsed out of the uploaded
package. This will only include the version just uploaded, not any other
versions that were uploaded before.

The response will have a 400 status if the package is improperly formatted.

The response will have a 403 status if the username and token are valid, but the
user in question doesn't have permission to upload the given package.


### POST /v1/packages/:package/owners

*Parameters*: `name`, `token`, `package`, `owner[0-9]*`

*Error Codes*: 400, 403

Adds one or more owners to an existing package.

`package` should be the name of the package. All parameters matching
`owner[0-9]*` should be names of existing users to add as owners.

The response will have a 400 status if any parameters are improperly formatted,
or if any owner does not exist.

The response will have a 403 status if the username and token are valid, but the
user in question doesn't have permission to add owners to this package.


### DELETE /v1/packages/:package/owners

*Parameters*: `name`, `token`, `package`, `owner[0-9]*`

*Error Codes*: 400, 403

Removes one or more owners from a package.

`package` should be the name of the package. All parameters matching
`owner[0-9]*` should be names of users to remove as owners.

The response will have a 400 status if any parameters are improperly formatted,
or if any owner does not exist.

The response will have a 403 status if the username and token are valid, but the
user in question doesn't have permission to remove owners from this package.
