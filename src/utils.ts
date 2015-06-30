// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import moment = require('moment');


/**
 * Wrappable Error class.
 *
 * The Error class doesn't actually act on `this`.  Instead it always
 * returns a new instance of Error.  Here we capture that instance so we
 * can apply it's properties to `this`.
 */
export
class WrappedError implements Error {

  message: string;
  name: string;
  errorStack: Error[];

  /*
   * Create a new WrappedError.
   */
  constructor(message: string, error: Error) {

    var tmp = Error.call(this, message)

    // Copy the properties of the error over to this.
    this.message = error.message;
    this.name = error.name;

    // Keep a stack of the original error messages.
    if (error instanceof WrappedError) {
      this.errorStack = error.errorStack.slice();
    } else {
      this.errorStack = [error];
    }
    this.errorStack.push(tmp);

  }
}


/*
 * Copy the contents of one object to another, recursively.
 *
 * http://stackoverflow.com/questions/12317003/something-like-jquery-extend-but-standalone
 */
export
function extend(target: any, source: any): any {
  target = target || {};
  for (var prop in source) {
    if (typeof source[prop] === 'object') {
      target[prop] = extend(target[prop], source[prop]);
    } else {
      target[prop] = source[prop];
    }
  }
  return target;
}


/*
 * Get a uuid as a string.
 */
export
function uuid(): string {
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
}


/**
 * Join a sequence of url components with '/'.
 */
export
function urlPathJoin(...paths: string[]): string {

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
}


/**
 * Encode just the components of a multi-segment uri,
 * leaving '/' separators.
 */
export
function encodeURIComponents(uri: string): string {
  return uri.split('/').map(encodeURIComponent).join('/');
}


/**
 * Join a sequence of url components with '/',
 * encoding each component with encodeURIComponent.
 */
export
function urlJoinEncode(...args: string[]): string {
  return encodeURIComponents(urlPathJoin.apply(null, args));
}


// Properly detect the current browser.
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
 * Return a serialized object string suitable for a query.

  http://stackoverflow.com/a/30707423
 */
export
function jsonToQueryString(json: any) {
  return '?' +
    Object.keys(json).map(function(key: string): any {
      return encodeURIComponent(key) + '=' +
        encodeURIComponent(json[key]);
    }).join('&');
}


/**
 * Input settings for an AJAX query.
 */
export
interface IAjaxSetttings {
  method: string;
  dataType: string;
  contentType?: string;
  data?: any;
}


/*
 * Asynchronous XMLHTTPRequest handler.
 *
 * http://www.html5rocks.com/en/tutorials/es6/promises/#toc-promisifying-xmlhttprequest
 */
export
function ajaxProxy(url: string, settings: IAjaxSetttings): Promise<any> {
  return new Promise(function(resolve, reject) {
    var req = new XMLHttpRequest();
    req.open(settings.method, url);
    if (settings.contentType) {
      req.overrideMimeType(settings.contentType);
    }

    req.onload = () => {
      if (req.status == 200) {
        if (settings.dataType === 'json') {
          resolve(JSON.parse(req.response));
        } else {
          resolve(req.response);
        }
      } else {
        reject(req.statusText);
      }
    }

    req.onerror = () => {
      reject(req.statusText);
    }

    if (settings.data) {
      req.send(settings.data);
    } else {
      req.send();
    }
  });
}


/**
 * Log ajax failures with informative messages.
 */
export
function logAjaxError(status: string) {
  var msg = "API request failed (" + status + "): ";
  console.log(msg);
}


declare
function require(modules: string[], success: Function, reject?: Function): void;


/**
 * Try to load a class.
 *
 * Try to load a class from a module using require.js, if a module 
 * is specified, otherwise tries to load a class from the global 
 * registry, if the global registry is provided.
 */
export
function loadClass(class_name: string, module_name: string, registry: { [string: string]: Function; }) {
  return new Promise(function(resolve, reject) {
    // Try loading the view module using require.js
    if (module_name) {
      require([module_name], (module: any) => {
        if (module[class_name] === undefined) {
          reject(new Error('Class ' + class_name + ' not found in module ' + module_name));
        } else {
          resolve(module[class_name]);
        }
      });
    } else {
      if (registry && registry[class_name]) {
        resolve(registry[class_name]);
      } else {
        reject(new Error('Class ' + class_name + ' not found in registry '));
      }
    }
  });
}


/**
 * Creates a wrappable Promise rejection function.
 * 
 * Creates a function that returns a Promise.reject with a new WrappedError
 * that has the provided message and wraps the original error that 
 * caused the promise to reject.
 */
export
function reject(message: string, log?: boolean): (error: Error) => Promise<any> {

  return function(error: Error): Promise<any> {
    var wrapped_error = new WrappedError(message, error);
    if (log) console.error(wrapped_error);
    return Promise.resolve(wrapped_error);
  };
}
