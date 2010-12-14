;;; furl.el --- Friendly URL retrieval

;; Copyright (C) 2010 Google Inc.

;; Author: Nathan Weizenbaum <nweiz@google.com>
;; Version: 0.0.0

;;; Commentary:

;; furl.el is a friendlier layer on top of url.el. It makes the most common use
;; cases (sending parameters and receiving a string response) easier, at the
;; expense of making less common use cases (non-default error handling, reading
;; response headers) somewhat more complex.

;; One simplification furl.el makes is not using cbargs parameters for
;; asynchronous functions. These are omitted because `lexical-let' from cl.el
;; can accomplish the same purpose when necessary.

;;; Code:

(require 'url)
(eval-when-compile (require 'cl))

(defvar furl-silent nil
  "Whether to retrieve URLs without messaging progress reports.
Only works in Emacs 24 and later.

TODO: Currently this has no effect.")

(defvar furl-charset "utf-8"
  "The character set to declare for POST requests.")

(defvar furl-error-function 'signal
  "Called when there is an error retrieving a URL.
Passed ERROR-SYMBOL and DATA, as would be passed to `signal'.
Called in a buffer containing the HTTP response.

If this function signals an error or returns nil, handling of the
HTTP response is halted. If it returns non-nil, handling
continues as though the error didn't happen.")

(defvar furl-request-data nil
  "An assoc list of parameter names to values to send with the next request.
Any parameters with nil values will not be included.")

(defun furl--handle-errors (status)
  "Look for HTTP errors and handle any that are found.
The actual handling of each error is done by `furl-error-function'."
  (loop for (name val) on status by 'cddr
        if (eq name :error)
          unless (funcall furl-error-function (car val) (cdr val))
            return nil)
  t)

(defun furl--make-query-string (params)
  "Return a query string constructed from PARAMS.
PARAMS is an assoc list of parameter names to values.

Any parameters with nil values are ignored."
  (replace-regexp-in-string
   "&+" "&"
   (mapconcat
    (lambda (param)
      (when (cdr param)
        (concat (url-hexify-string (format "%s" (car param))) "="
                (url-hexify-string (format "%s" (cdr param))))))
    params "&")))

(defun furl--get-response-body (&optional buffer)
  "Return the body of the response in BUFFER.
BUFFER defaults to `current-buffer'."
  (with-current-buffer (or buffer (current-buffer))
    (save-excursion
      (goto-char (point-min))
      (search-forward "\n\n" nil t) ; Move past headers
      (buffer-substring-no-properties (point) (point-max)))))

(defmacro furl-with-header (name value &rest body)
  "Set the HTTP header NAME to VALUE for requests within BODY.
This sets the header so that other headers set elsewhere are
preserved."
  (declare (indent 2))
  `(let ((url-request-extra-headers
          (cons (cons ,name ,value) url-request-extra-headers)))
     ,@body))

(defmacro furl--set-post-content-type (&rest body)
  "Make sure POST requests are made properly.
If a POST request is being made, set the Content-Type properly,
including the charset."
  (declare (indent 0))
  `(if (equal url-request-method "POST")
       (furl-with-header "Content-Type"
           (format "application/x-www-form-urlencoded; charset=%s" furl-charset)
         ,@body)
     ,@body))

(defun furl-retrieve (url callback)
  "Retrieve URL asynchronously and call CALLBACK when finished.
URL is either a string or a parsed URL.

CALLBACK is passed a single argument, a string containing the
body of the retrieved document. CALLBACK is applied at an
indeterminate point in a buffer containing the response.

In addition to the variables that can be dynamically bound around
`url-retrieve', `furl-silent', `furl-charset', and
`furl-error-function' can be dynamically bound around this
function."
  (furl--set-post-content-type
    (let ((url-request-data
           (or url-request-data (furl--make-query-string furl-request-data))))
      (lexical-let ((furl-error-function- furl-error-function))
        (url-retrieve url (lambda (status callback)
                            (let ((furl-error-function furl-error-function-))
                              (when (furl--handle-errors status)
                                (funcall callback (furl--get-response-body)))))
                      (list callback))))))

(defun furl-retrieve-synchronously (url)
  "Retrieve URL synchronously.
URL is either a string or a parsed URL.

In addition to the variables that can be dynamically bound around
`url-retrieve-synchronously', `furl-silent', `furl-charset', and
`furl-error-function' can be dynamically bound around this
function."
  (furl--set-post-content-type
    (let ((url-request-data
           (or url-request-data (furl--make-query-string furl-request-data))))
      (with-current-buffer (url-retrieve-synchronously url)
        (let ((str (furl--get-response-body)))
          (kill-buffer)
          str)))))

;;; furl.el ends here
