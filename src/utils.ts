// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

module jupyter.utils {

/**
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


/**
 * Get a uuid as a string.
 *
 * http://www.ietf.org/rfc/rfc4122.txt
 */
export
function uuid(): string {
  var s: string[] = [];
  var hexDigits = "0123456789ABCDEF";
  for (var i = 0; i < 32; i++) {
    s[i] = hexDigits.charAt(Math.floor(Math.random() * 0x10));
  }
  s[12] = "4";  // bits 12-15 of the time_hi_and_version field to 0010
  s[16] = hexDigits.substr((Number(s[16]) & 0x3) | 0x8, 1);  // bits 6-7 of the clock_seq_hi_and_reserved to 01
  return s.join("");
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
 * Get a url-encoded item from document body and decode it.
 * We should never have any encoded URLs anywhere else in code
 * until we are building an actual request.
 */
export 
function getBodyData(key: string): string {
  var val = document.body.getAttribute(key);
  if (val) {
    return decodeURIComponent(val);
  }
  return null;
}


/**
 * Join a sequence of url components with '/',
 * encoding each component with encodeURIComponent.
 */
export
function urlJoinEncode(...args: string[]): string {
  return encodeURIComponents(urlPathJoin.apply(null, args));
}


/**
 * Properly detect the current browser.
 * http://stackoverflow.com/questions/2400935/browser-detection-in-javascript
 */
export
var browser: string[] = (() => {
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
 *
 * http://stackoverflow.com/a/30707423
 */
export
function jsonToQueryString(json: any): string {
  return '?' +
    Object.keys(json).map((key: string): any => {
      return encodeURIComponent(key) + '=' +
        encodeURIComponent(json[key]);
    }).join('&');
}


/**
 * Input settings for an AJAX request.
 */
export
interface IAjaxSetttings {
  method: string;
  dataType: string;
  contentType?: string;
  data?: any;
}


/**
 * Asynchronous XMLHTTPRequest handler.
 *
 * http://www.html5rocks.com/en/tutorials/es6/promises/#toc-promisifying-xmlhttprequest
 */
export
function ajaxRequest(url: string, settings: IAjaxSetttings): Promise<any> {
  return new Promise((resolve, reject) => {
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
 * Try to load a class.
 *
 * Try to load a class from a module using require.js, if a module 
 * is specified, otherwise tries to load a class from the global 
 * registry, if the global registry is provided.
 */
export
function loadClass(class_name: string, module_name: string, registry: { [string: string]: Function; }) : Promise<string> {
  return new Promise((resolve, reject) => {
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

} // module jupyter.utils
