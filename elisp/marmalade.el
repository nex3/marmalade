;;; marmalade.el --- Elisp interface for the Emacs Lisp package server.

;; Copyright (C) 2010 Google Inc.

;; Author: Nathan Weizenbaum <nweiz@google.com>
;; URL: http://code.google.com/p/marmalade
;; Version: 0.0.3
;; Package-Requires: ((furl 0.0.1))

;;; Commentary:

;; marmalade.el provides an Emacs Lisp interface to the Marmalade package
;; server. You can already use package.el to download and install packages in
;; Marmalade; this package adds the ability to upload them.

;; To use marmalade.el, you must set `marmalade-server' to the URL of the
;; Marmalade server to which pakages will be uploaded.
;; TODO: This should default to the main server.

;;; License:

;; Copyright (C) 2010 Google Inc.

;; This program is free software: you can redistribute it and/or modify
;; it under the terms of the GNU General Public License as published by
;; the Free Software Foundation, either version 3 of the License, or
;; (at your option) any later version.
;;
;; This program is distributed in the hope that it will be useful,
;; but WITHOUT ANY WARRANTY; without even the implied warranty of
;; MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
;; GNU General Public License for more details.
;;
;; You should have received a copy of the GNU General Public License
;; along with this program.  If not, see <http://www.gnu.org/licenses/>.

;;; Code:

(require 'furl)
(eval-when-compile (require 'cl))

(defgroup marmalade nil
  "An interface for the Marmalade package server"
  :prefix "marmalade-"
  :group 'applications)

(defcustom marmalade-server nil
  "The URL of the server to which to upload packages."
  :type 'string
  :group 'marmalade)

(defcustom marmalade-token nil
  "The authentication token for the Marmalade API.
If this is not set, marmalade.el will prompt for username and
password for the first Marmalade request of each session."
  :type 'string
  :group 'marmalade)

(defun marmalade-retrieve (path callback)
  "Make a request to the Marmalade API at PATH.
Like `furl-retrieve', but the result is passed to CALLBACK as a
list of some sort."
  (let ((url-request-extra-headers
         (cons '("Accept" . "text/x-script.elisp") url-request-extra-headers)))
    (lexical-let ((callback callback))
      (furl-retrieve (concat marmalade-server "/v1/" path)
                     (lambda (str)
                       (funcall callback (read str)))))))

(defun marmalade-retrieve-synchronously (path)
  "Make a request to the Marmalade API at PATH.
Like `furl-retrieve-synchronously', but the result is returned as
a list of some sort."
  (let ((url-request-extra-headers
         (cons '("Accept" . "text/x-script.elisp") url-request-extra-headers)))
    (read (furl-retrieve-synchronously (concat marmalade-server "/v1/" path)))))

(defun marmalade-login (&optional callback)
  "Log in to Marmalade and get the authentication token.
Prompt interactively for the user's username and password, then
use these to retreive the token.

CALLBACK is called when the login is completed, and passed the
authentication token."
  (interactive)
  (if marmalade-token (when callback (funcall callback marmalade-token))
    (let* ((name (read-string "Marmalade username: "))
           (password (read-passwd "Marmalade password: "))
           (url-request-method "POST")
           (furl-request-data `(("name" . ,name) ("password" . ,password))))
      (lexical-let ((callback callback))
        (marmalade-retrieve
         "users/login"
         (lambda (res)
           (let ((token (cdr (assoc 'token res))))
             (if (yes-or-no-p "Save Marmalade auth token? ")
                 (customize-save-variable 'marmalade-token token)
               (setq marmalade-token token))
             (when callback (funcall callback token)))))))))


;;; marmalade.el ends here
