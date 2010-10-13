marmalade(7) -- spreadable elisp
================================

## SUMMARY

Marmalade is an Emacs Lisp package server that allows authors to easily upload their
packages. It follows the protocol expected by `package.el`, the standard Emacs
package manager, and so can be used in conjunction with the [official GNU
repository](http://elpa.gnu.org/) or the original [ELPA
repository](http://tromey.com/elpa).

## RUNNING MARMALADE

Marmalade is designed to be easy to get up and running on your own server. It only
takes six steps:

1. Install [node.js](http://nodejs.org/#download).
2. Install the [Node package manager](http://github.com/isaacs/npm#readme).
3. Install [MongoDB](http://www.mongodb.org/downloads).
4. `hg clone https://marmalade.googlecode.com/hg/ marmalade`
5. `npm install ./marmalade`
6. `marmalade`

## INSTALLING PACKAGES FROM A MARMALADE ARCHIVE

### Get package.el

To use Marmalade, you first need `package.el`. If you're using Emacs 24 or later,
you've already got it. Otherwise, download it from
[here](http://github.com/technomancy/package.el/raw/master/package.el)
(currently the official ELPA `package.el` doesn't support multiple archives).

### Enable the Archive

Add this line to your `.emacs`:

    (add-to-list 'package-archives '("marmalade" . "http://your.domain/packages/"))

### That's It!

Your archive is now active! Run `M-x package-list` and see all the new packages,
and run `M-x package-install` to install them.
