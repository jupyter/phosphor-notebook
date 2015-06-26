// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import moment = require('moment');


export
  class WrappedError implements Error {

  message: string;
  name: string;
  errorStack: Error[];

  /**
   * Wrappable Error class
   *
   * The Error class doesn't actually act on `this`.  Instead it always
   * returns a new instance of Error.  Here we capture that instance so we
   * can apply it's properties to `this`.
   */
  constructor(message: string, error: Error) {

    var tmp = Error.apply(this, [message]);

    // Copy the properties of the error over to this.
    this.message = error.message;
    this.name = error.name;

    // Keep a stack of the original error messages.
    if (error instanceof WrappedError) {
      this.errorStack = error.errorStack;
    } else {
      this.errorStack = [error];
    }
    this.errorStack.push(tmp);

  }
}


/*
  Copy the contents of one object to another, recursively

  http://stackoverflow.com/questions/12317003/something-like-jquery-extend-but-standalone
*/
export
  var extend = function(target: any, source: any): any {
  target = target || {};
  for (var prop in source) {
    if (typeof source[prop] === 'object') {
      target[prop] = extend(target[prop], source[prop]);
    } else {
      target[prop] = source[prop];
    }
  }
  return target;
};

export
  var uuid = function(): string {
    /**
     * http://www.ietf.org/rfc/rfc4122.txt
     */
    var s: string[] = [];
    var hexDigits = "0123456789ABCDEF";
    for (var i = 0; i < 32; i++) {
      s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
    }
    s[12] = "4";  // bits 12-15 of the time_hi_and_version field to 0010
    s[16] = hexDigits.substr((Number(s[16]) & 0x3) | 0x8, 1);  // bits 6-7 of the clock_seq_hi_and_reserved to 01

    var uuid = s.join("");
    return uuid;
  };


/**
 * join a sequence of url components with '/'
 */
export
  var urlPathJoin = function(...paths: string[]): string {

    var url = '';
    for (var i = 0; i < paths.length; i++) {
      if (paths[i] === '') {
        continue;
      }
      if (url.length > 0 && url[url.length - 1] != '/') {
        url = url + '/' + paths[i];
      } else {
        url = url + paths[i];
      }
    }
    url = url.replace(/\/\/+/, '/');
    return url;
  };


/**
 * encode just the components of a multi-segment uri,
 * leaving '/' separators
 */
export
  var encodeURIComponents = function(uri: string): string {
    return uri.split('/').map(encodeURIComponent).join('/');
  };


/**
 * join a sequence of url components with '/',
 * encoding each component with encodeURIComponent
 */
export
  var urlJoinEncode = function(...args: string[]): string {
    return encodeURIComponents(urlPathJoin.apply(null, args));
  };


/**
 * get a url-encoded item from body.data and decode it
 * we should never have any encoded URLs anywhere else in code
 * until we are building an actual request
 */
export
  var getBodyData = function(key: string): string {
    var val = String($('body').data(key));
    if (!val)
      return val;
    return decodeURIComponent(val);
  };


// http://stackoverflow.com/questions/2400935/browser-detection-in-javascript
export
  var browser: string[] = (function() {
    if (typeof navigator === 'undefined') {
      // navigator undefined in node
      return ['None'];
    }
    var N: string = navigator.appName;
    var ua: string = navigator.userAgent
    var tem: RegExpMatchArray;
    var M: RegExpMatchArray = ua.match(/(opera|chrome|safari|firefox|msie)\/?\s*(\.?\d+(\.\d+)*)/i);
    if (M && (tem = ua.match(/version\/([\.\d]+)/i)) !== null) M[2] = tem[1];
    M = M ? [M[1], M[2]] : [N, navigator.appVersion, '-?'];
    return M;
  })();


/** 
 * Return a serialized object string suitable for a query

  http://stackoverflow.com/a/30707423
 */
 export
var jsonToQueryString = function(json: any) {
  return '?' +
    Object.keys(json).map(function(key: any): any {
      return encodeURIComponent(key) + '=' +
        encodeURIComponent(json[key]);
    }).join('&');
}


interface IAJaxSuccessType {
  data: any;
  status: string;
  xhr: XMLHttpRequest;
 };


interface IAJaxErrorType {
   xhr: XMLHttpRequest;
   status: string;
   err: string;
 };


export
 interface IAJaxSuccess {
   (data: any, status: string, xhr: XMLHttpRequest): void;
 };


export
 interface IAJaxError {
   (xhr: XMLHttpRequest, status: string, err: string): void;
 };


export
interface IAJaxSetttings {
  method: string;
  dataType: string;
  success: IAJaxSuccess;
  error: IAJaxError;
  contentType?: string;
  data?: any;
 };

/*
 * Asynchronous XMLHTTPRequest handler
 *
 * http://www.html5rocks.com/en/tutorials/es6/promises/#toc-promisifying-xmlhttprequest
 */
export
  var ajaxProxy = function(url: string, settings: IAJaxSetttings): Promise<any> {

    var success = function(resp: IAJaxSuccessType) {
      settings.success(resp.data, resp.status, resp.xhr);
    }

    var error = function(resp: IAJaxErrorType) {
      settings.error(resp.xhr, resp.status, resp.err);
    }

    return new Promise(function(resolve, reject) {
      var req = new XMLHttpRequest();
      req.open(settings.method, url);
      if (settings.contentType) {
        req.overrideMimeType(settings.contentType);
      }

      req.onload = function(evt: Event) {
        if (req.status == 200) {
          if (settings.dataType === 'json') {
            resolve({ data: JSON.parse(req.response), status: req.statusText, xhr: req });
          }
          else {
            resolve({ data: req.response, status: req.statusText, xhr: req });
          }
        }
        else {
          reject({ xhr: req, status: req.statusText, err: evt.type });
        }
      }

      req.onerror = function(evt: Event) {
        reject({ xhr: req, status: req.statusText, err: evt.type });
      }

      if (settings.data) {
        req.send(settings.data);
      } else {
        req.send();
      }
    }).then(success, error);
  };

/**
 * log ajax failures with informative messages
 */
export
  var logAjaxError = function(xhr: XMLHttpRequest, status: string, error: string) {

    var msg = "API request failed (" + xhr.status + "): ";
    console.log(xhr);
    msg += xhr.statusText;
    console.log(msg);
  }


/**
 * Tries to load a class
 *
 * Tries to load a class from a module using require.js, if a module 
 * is specified, otherwise tries to load a class from the global 
 * registry, if the global registry is provided.
 */
export
  var loadClass = function(class_name: string, module_name: string, registry: { [string: string]: Function; }) {
    return new Promise(function(resolve, reject) {

      // Try loading the view module using require.js
      if (module_name) {
        require([module_name], function(module: any) {
          if (module[class_name] === undefined) {
            reject(new Error('Class ' + class_name + ' not found in module ' + module_name));
          } else {
            resolve(module[class_name]);
          }
        }, reject);
      } else {
        if (registry && registry[class_name]) {
          resolve(registry[class_name]);
        } else {
          reject(new Error('Class ' + class_name + ' not found in registry '));
        }
      }
    });
  };


/**
 * Creates a wrappable Promise rejection function.
 * 
 * Creates a function that returns a Promise.reject with a new WrappedError
 * that has the provided message and wraps the original error that 
 * caused the promise to reject.
 */
export
  var reject = function(message: string, log?: boolean): (error: any) => any {

    return function(error: any): Promise<any> {
      var wrapped_error = new WrappedError(message, error);
      if (log) console.error(wrapped_error);
      return Promise.reject(wrapped_error);
    };
  };
