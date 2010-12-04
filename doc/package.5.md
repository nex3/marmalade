marmalade-package(5) -- the marmalade package format
====================================================

## SUMMARY

Marmalade uses the [ELPA and `package.el`](http://tromey.com/elpa/) package
format, with a few extensions for providing additional metadata. This format is
designed to be easy to embed in existing Elisp packages without substantial
modification. It supports both single `.el` files and multi-file `.tar`
packages.

## SINGLE-FILE PACKAGES

A single-file package must have the file extension `.el`, and must obey a few
standard Elisp formatting conventions. It must be of the form

    ;;; <name>.el --- <description>

    <file contents>

    ;;; <name>.el ends here

`<name>` should be replaced by the package's name, and `<description>` with a
short description of the package. No text may come before the header or after
the footer, although blank lines are allowed.

All metadata about the package is placed in standard Elisp headers. Headers are
of the form `;;; <Header>: <value>`. They may be placed anywhere in the file
before the Elisp code.

The only required header is `Version`, the value of which must be a series of
numbers separated by periods that identify the package's version. The optional
`Package-Requires` header may contain an Elisp list of package/version pairs
that the package depends on.

## MULTI-FILE PACKAGES

A multi-file package *must* have the file extension `.tar` and contain a single
directory named `<name>-<version>/`. This directory in turn must contain at
least a file named `<name>-pkg.el`. This file must have a single call to the
``define-package'` function, with these parameters:

* `name': The case-insensitive package name.
* `version': The package version, numbers separated by periods.
* `description' (optional): A one-line description of the package.
* `requirements' (optional): A quoted list of package/version pairs that this
  package depends on.

## MARMALADE EXTENSIONS

The formats described above are the formats expected by `package.el`. However,
Marmalade adds several extensions to this format. These extensions mostly
involve parsing headers that many packages already have in order to provide more
information about the packages.

For multi-file packages, Marmalade will look at headers in `<name>.el` as well
as looking at the ``define-package'` call in `<name>-pkg.el`. `<name>.el`, if it
exists, is expected to be in the same format as a single-file package, although
it need not contain the `Version` header.

### ADDITIONAL HEADERS

The `Author` header is used to display the name of the package author. If an
email is given (e.g. `Nathan Weizenbaum <nweiz@google.com>`), the email is
stripped out.

The `Url` header is used to determine the homepage link for the package.

### PACKAGE COMMENTARY

In addition to the one-line description that `package.el` supports, Marmalade
allows packages to include longer descriptions of themselves that will be
displayed on the package page. The way this is done differs for single-file and
multi-file packages.

For single-file packages, the `Commentary` header section is used. Header
sections are of the form

    ;;; <Section Name>:

    ;; <text>
    ;; <text>

    ;; <text>
    ;; <text>

For multi-file packages, the `README` file is used.

When presenting the commentary text as HTML, Marmalade will separate paragraphs
with the `<p>` tag but will otherwise do no formatting.

## EXAMPLES

A single-file package might look like this:

    ;;; sass-mode.el --- Sass major mode

    ;; Copyright 2007-2010 Nathan Weizenbaum

    ;; Author: Nathan Weizenbaum <nex342@gmail.com>
    ;; URL: http://github.com/nex3/sass-mode
    ;; Version: 3.0.20
    ;; Package-Requires: ((haml-mode "3.0.20"))

    ;; Code goes here

    ;;; sass-mode.el ends here

A multi-file package's `<name>-pkg.el` file might look like this:

    (define-package "sass-mode" "3.0.20"
                    "Sass major mode"
                    '((haml-mode "3.0.20")))
