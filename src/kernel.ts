// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

"use strict";

import utils = require('./utils');
import serialize = require('./serialize');

import Signal = phosphor.core.Signal;
import emit = phosphor.core.emit;
import Disposable = phosphor.utility.Disposable;


export
interface IKernelMsgHeader {
  username: string;
  version: string;
  session: string;
  msg_id: string;
  msg_type: string;
};


export
  interface IKernelMsg {
  header: IKernelMsgHeader;
  metadata: any;
  content: any;
  parent_header: any;
  msg_id?: string;
  msg_type?: string;
  channel?: string;
  buffers?: string[]| ArrayBuffer[];
};


interface IKernelCommMsg {
  comm_id: string;
  data: any;
  target_name?: string;
};


interface IWebSocketEvent extends Event {
  wasClean: boolean;
  data: string | ArrayBuffer | Blob;
};


export
interface IKernelFuture {
  /**
   * Dispose and unregister the future.
   */   
  dispose(): void;

  /**
   * Regsiter a reply handler. Returns 'this'.
   */
  onReply(cb: (msg: IKernelMsg) => void): IKernelFuture;

  /**
   * Regsiter an output handler. Returns 'this'.
   */
  onOutput(cb: (msg: IKernelMsg) => void): IKernelFuture;

  /**
   * Regsiter a done handler. Returns 'this'.
   */
  onDone(cb: (msg: IKernelMsg) => void): IKernelFuture;

  /**
   * Regsiter an input handler. Returns 'this'.
   */
  onInput(cb: (msg: IKernelMsg) => void): IKernelFuture;

  autoDispose: boolean;

}


enum KernelFutureFlag {
  GotReply = 0x1,
  GotIdle = 0x2,
  AutoDispose = 0x4
}


class KernelFutureHandler extends Disposable implements IKernelFuture {

  /**
   * Dispose and unregister the future.
   */
  dispose(): void {
    super.dispose();
    this._input = null;
    this._output = null;
    this._reply = null;
    this._done = null;
  }

  /**
   * Register a reply handler. Returns 'this'.
   */
  onReply(cb: (msg: IKernelMsg) => void): IKernelFuture {
    this._reply = cb;
    return this;
  }

  /**
   * Register an output handler. Returns 'this'.
   */
  onOutput(cb: (msg: IKernelMsg) => void): IKernelFuture {
    this._output = cb;
    return this;
  }

  /**
   * Register a done handler. Returns 'this'.
   */
  onDone(cb: (msg: IKernelMsg) => void): IKernelFuture {
    this._done = cb;
    return this;
  }

  /**
   * Register an input handler. Returns 'this'.
   */
  onInput(cb: (msg: IKernelMsg) => void): IKernelFuture {
    this._input = cb;
    return this;
  }

  get autoDispose(): boolean {
    return this._testFlag(KernelFutureFlag.AutoDispose);
  }

  set autoDispose(value: boolean) {
    if (value) {
      this._setFlag(KernelFutureFlag.AutoDispose);
    } else {
      this._clearFlag(KernelFutureFlag.AutoDispose);
    }
  }

  handleMsg(msg: IKernelMsg): void {
    if (msg.channel === 'iopub') {
      if (msg.msg_type === 'status' && msg.content.execution_state === 'idle') {
        this._setFlag(KernelFutureFlag.GotIdle);
        if (this._testFlag(KernelFutureFlag.GotReply)) {
          this._handleDone(msg);
        }
      }
      if (this._output) {
        this._output(msg);
      }
    } else if (msg.channel === 'shell') {
      this._setFlag(KernelFutureFlag.GotReply)
      if (this._testFlag(KernelFutureFlag.GotIdle)) {
        this._handleDone(msg);
      }
      if (this._reply) {
        this._reply(msg);
      }
    } else if (msg.channel == 'stdin') {
      if (this._input) {
        this._input(msg);
      }
    }
  }

  private _handleDone(msg: IKernelMsg) : void {
    if (this._done) {
      this._done(msg);
    }
    if (this._testFlag(KernelFutureFlag.AutoDispose)) {
      this.dispose();
    }
  }

  /**
   * Test whether the given future flag is set.
   */
  private _testFlag(flag: KernelFutureFlag): boolean {
    return (this._status & flag) !== 0;
  }

  /**
   * Set the given future flag.
   */
  private _setFlag(flag: KernelFutureFlag): void {
    this._status |= flag;
  }

  /**
   * Clear the given future flag.
   */
  private _clearFlag(flag: KernelFutureFlag): void {
    this._status &= ~flag;
  }

  private _status: number;
  private _input: (msg: IKernelMsg) => void = null;
  private _output: (msg: IKernelMsg) => void = null;
  private _reply: (msg: IKernelMsg) => void = null;
  private _done: (msg: IKernelMsg) => void = null;
}


/**
 * A Kernel class to communicate with the Python kernel. This
 * should generally not be constructed directly, but be created
 * by.  the `Session` object. Once created, this object should be
 * used to communicate with the kernel.
 * 
 * @class Kernel
 * @param {string} kernel_service_url - the URL to access the kernel REST api
 * @param {string} ws_url - the websockets URL
 * @param {string} name - the kernel type (e.g. python3)
 */
export
class Kernel {

  static statusChange = new Signal<Kernel, string>();

  constructor(kernel_service_url: string, ws_url: string, name: string) {
    this._id = null;
    this._name = name;
    this._ws = null;

    this._kernelServiceUrl = kernel_service_url;
    this._kernelUrl = null;
    this._wsUrl = ws_url;
    if (!this._wsUrl) {
      // trailing 's' in https will become wss for secure web sockets
      this._wsUrl = location.protocol.replace('http', 'ws') + "//" + location.host;
    }

    this._username = "username";
    this._sessionId = utils.uuid();
    this._infoReply = {}; // kernel_info_reply stored here after starting
    this._handlerMap = new Map<string, KernelFutureHandler>();

    if (typeof WebSocket === 'undefined') {
      alert('Your browser does not have WebSocket support, please try Chrome, Safari, or Firefox ≥ 11.');
    }

    this._autorestartAttempt = 0;
    this._reconnectAttempt = 0;
    this._reconnectLimit = 7;
  }

  /**
   * GET /api/kernels
   *
   * Get the list of running kernels.
   *
   * @function list
   */
  list(): Promise<any> {
    return utils.ajaxProxy(this._kernelServiceUrl, {
      method: "GET",
      dataType: "json"
    }).then((data: any) => {
        this._onSuccess(data);
    }, (status: string) => {
        this._onError(status);
    });
  }


  /**
   * GET /api/kernels/[:kernel_id]
   *
   * Get information about the kernel.
   *
   * @function get_info
   */
  getInfo(): Promise<any> {
    return utils.ajaxProxy(this._kernelUrl, {
      method: "GET",
      dataType: "json"
    }).then((data: any) => {
        this._onSuccess(data);
    }, (status: string) => {
        this._onError(status);
    });
  }

  /**
   * POST /api/kernels/[:kernel_id]/interrupt
   *
   * Interrupt the kernel.
   *
   * @function interrupt
   */
  interrupt(): Promise<any> {
    this._handleStatus('interrupting');

    var url = utils.urlJoinEncode(this._kernelUrl, 'interrupt');
    return utils.ajaxProxy(url, {
      method: "POST",
      dataType: "json"
    }).then((data: any) => {
      /**
       * get kernel info so we know what state the kernel is in
       */
      this.kernelInfo();
      this._onSuccess(data);
    }, (status: string) => {
      this._onError(status);
    });
  }

  /**
   * POST /api/kernels/[:kernel_id]/restart
   *
   * Restart the kernel.
   *
   * @function restart
   */
  restart(): Promise<any> {
    this._handleStatus('restarting');
    this.stopChannels();

    var url = utils.urlJoinEncode(this._kernelUrl, 'restart');
    return utils.ajaxProxy(url, {
      method: "POST",
      dataType: "json"
    }).then((data: any) => {
      this._kernelCreated(data);
      this._onSuccess(data);
    }, (status: string) => {
      this._kernelDead();
      this._onError(status);
    });
  }

  /**
   * Reconnect to a disconnected kernel. This is not actually a
   * standard HTTP request, but useful function nonetheless for
   * reconnecting to the kernel if the connection is somehow lost.
   *
   * @function reconnect
   */
  reconnect(): void {
    if (this.isConnected()) {
      return;
    }
    this._reconnectAttempt = this._reconnectAttempt + 1;
    this._handleStatus('reconnecting');
    this.startChannels();
  }

  /**
   * Close the websocket. After successful close, the value
   * in `this.ws` will be null.
   *
   * @function stopChannels
   */
  stopChannels(): void {
    var close = () => {
      if (this._ws && this._ws.readyState === WebSocket.CLOSED) {
        this._ws = null;
      }
    };
    if (this._ws !== null) {
      if (this._ws.readyState === WebSocket.OPEN) {
        this._ws.onclose = close;
        this._ws.close();
      } else {
        close();
      }
    }
  }

  /**
   * Check whether there is a connection to the kernel. This
   * function only returns true if websocket has been
   * created and has a state of WebSocket.OPEN.
   *
   * @function isConnected
   * @returns {bool} - whether there is a connection
   */
  isConnected(): boolean {
    // if any channel is not ready, then we're not connected
    if (this._ws === null) {
      return false;
    }
    if (this._ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    return true;
  }

  /**
   * Check whether the connection to the kernel has been completely
   * severed. This function only returns true if all channel objects
   * are null.
   *
   * @function isFullyDisconnected
   * @returns {bool} - whether the kernel is fully disconnected
   */
  isFullyDisconnected(): boolean {
    return (this._ws === null);
  }

  /**
   * Send a message on the Kernel's shell channel
   *
   * @function sendShellMessage
   * @returns {KernelFuture} - Kernel Future callback handler
   */
  sendShellMessage(msg_type: string, content: any, metadata = {}, buffers: string[] = []): IKernelFuture {
    if (!this.isConnected()) {
        throw new Error("kernel is not connected");
    }
    var msg = this._getMsg(msg_type, content, metadata, buffers);
    msg.channel = 'shell';

    this._ws.send(serialize.serialize(msg));

    var future = new KernelFutureHandler(() => {
      this._handlerMap.delete(msg.header.msg_id);
    });

    this._handlerMap.set(msg.header.msg_id, future);

    return future;
  }

  /**
   * Get kernel info
   *
   * @function kernelInfo
   *
   * Returns a KernelFuture that will resolve to a `kernel_info_reply` message documented
   * [here](http://ipython.org/ipython-doc/dev/development/messaging.html#kernel-info)
   */
  kernelInfo(): IKernelFuture {
    return this.sendShellMessage("kernel_info_request", {});
  }

  /**
   * Get info on an object
   *
   * Returns a KernelFuture that will resolve to a `inspect_reply` message documented
   * [here](http://ipython.org/ipython-doc/dev/development/messaging.html#object-information)
   *
   * @function inspect
   * @param code {string}
   * @param cursor_pos {integer}
   */
  inspect(code: string, cursor_pos: number): IKernelFuture {
    var content = {
      code: code,
      cursor_pos: cursor_pos,
      detail_level: 0
    };
    return this.sendShellMessage("inspect_request", content);
  }

  /**
   * Execute given code into kernel, returning a KernelFuture.
   *
   * @async
   * @function execute
   * @param {string} code
   * @param {object} [options]
   *      @param [options.silent=false] {Boolean}
   *      @param [options.user_expressions=empty_dict] {Dict}
   *      @param [options.allow_stdin=false] {Boolean} true|false
   * @example
   *
   * The options object should contain the options for the execute
   * call. Its default values are:
   *
   *      options = {
   *        silent : true,
   *        user_expressions : {},
   *        allow_stdin : false
   *      }
   *
   */
  execute(code: string, options?: any): IKernelFuture {
    var content = {
      code: code,
      silent: true,
      store_history: false,
      user_expressions: {},
      allow_stdin: false
    };
    utils.extend(content, options);
    return this.sendShellMessage("execute_request", content);
  }

  /**
   * Returns a KernelFuture with will resolve to a `complete_reply` documented
   * [here](http://ipython.org/ipython-doc/dev/development/messaging.html#complete)
   *
   * @function complete
   * @param code {string}
   * @param cursor_pos {integer}
   */
  complete(code: string, cursor_pos: number): IKernelFuture {
    var content = {
      code: code,
      cursor_pos: cursor_pos
    };
    return this.sendShellMessage("complete_request", content);
  }

  /**
   * @function sendInputReply

   * TODO: how to handle this?  Right now called by
   * ./static/notebook/js/outputarea.js:827:        this.events.trigger('send_input_reply.Kernel', value);
   *
   * which has no referense to the session or the kernel
   */
  sendInputReply(input: any): string {
    if (!this.isConnected()) {
      throw new Error("kernel is not connected");
    }
    var content = {
      value: input
    };
    var msg = this._getMsg("input_reply", content);
    msg.channel = 'stdin';
    this._ws.send(serialize.serialize(msg));
    return msg.header.msg_id;
  }

  /**
   * @function _getMsg
   */
  private _getMsg(msg_type: string, content: any,
    metadata = {}, buffers: string[] = []): IKernelMsg {
    var msg: IKernelMsg = {
      header: {
        msg_id: utils.uuid(),
        username: this._username,
        session: this._sessionId,
        msg_type: msg_type,
        version: "5.0"
      },
      metadata: metadata || {},
      content: content,
      buffers: buffers || [],
      parent_header: {}
    };
    return msg;
  }

  private _handleStatus(status: string) {
    emit(this, Kernel.statusChange, status);
    if (status === 'idle' || status === 'busy') {
      return;
    }
    console.log('Kernel: ' + status + ' (' + this._id + ')');
  }

  /**
   * Handle a successful AJAX request by updating the kernel id and
   * name from the response.
   *
   * @function _onSuccess
   * @param {Object} data - AJAX request data
   */
  private _onSuccess(data: any): void {
    if (data) {
      this._id = data.id;
      this._name = data.name;
    }
    this._kernelUrl = utils.urlJoinEncode(this._kernelServiceUrl, this._id);
  }

  /**
   * Handle a failed AJAX request by logging the error message, and
   * then optionally calling a provided callback.
   *
   * @function _onError
   * @param {string} status - Ajax Error Message
   */
  private _onError(status: string): void {
    utils.logAjaxError(status);
    throw status;
  }

  /**
   * Perform necessary tasks once the kernel has been started,
   * including actually connecting to the kernel.
   *
   * @function _kernelCreated
   * @param {Object} data - information about the kernel including id
   */
  private _kernelCreated(data: any): void {
    this._handleStatus('created');
    this._id = data.id;
    this._kernelUrl = utils.urlJoinEncode(this._kernelServiceUrl, this._id);
    this.startChannels();
  }

  /**
   * Perform necessary tasks once the connection to the kernel has
   * been established. This includes requesting information about
   * the kernel.
   *
   * @function _kernelConnected
   */
  private _kernelConnected(): void {
    this._handleStatus('connected');
    this._reconnectAttempt = 0;
    // get kernel info so we know what state the kernel is in
    this.kernelInfo().onReply((reply?: IKernelMsg) => {
      this._infoReply = reply.content;
      this._handleStatus('ready');
      this._autorestartAttempt = 0;
    });
  }

  /**
   * Perform necessary tasks after the kernel has died. This closing
   * communication channels to the kernel if they are still somehow
   * open.
   *
   * @function _kernelDead
   */
  private _kernelDead(): void {
    this._handleStatus('dead');
    this.stopChannels();
  }

  /**
   * Start the websocket channels.
   * Will stop and restart them if they already exist.
   *
   * @function startChannels
   */
  startChannels(): void {
    this.stopChannels();
    var ws_host_url = this._wsUrl + this._kernelUrl;

    console.log("Starting WebSockets:", ws_host_url);

    this._ws = new WebSocket([
        this._wsUrl,
        utils.urlJoinEncode(this._kernelUrl, 'channels'),
        "?session_id=" + this._sessionId
    ].join('')
        );

    var already_called_onclose = false; // only alert once
    this._ws.onclose = (evt: CloseEvent) => {
      if (already_called_onclose) {
        return;
      }
      already_called_onclose = true;
      if (!evt.wasClean) {
        // If the websocket was closed early, that could mean
        // that the kernel is actually dead. Try getting
        // information about the kernel from the API call --
        // if that fails, then assume the kernel is dead,
        // otherwise just follow the typical websocket closed
        // protocol.
        this.getInfo().then(function() {
          this._ws_closed(ws_host_url, false);
        }, function() {
          this._kernel_dead();
        });
      }
    };
    this._ws.onerror = (evt: ErrorEvent) => {
      if (already_called_onclose) {
        return;
      }
      already_called_onclose = true;
      this._wsClosed(ws_host_url, true);
    };

    this._ws.onopen = (evt: IWebSocketEvent) => {
      this._wsOpened(evt);
    };
    var ws_closed_late = (evt: CloseEvent) => {
      if (already_called_onclose) {
        return;
      }
      already_called_onclose = true;
      if (!evt.wasClean) {
        this._wsClosed(ws_host_url, false);
      }
    };
    // switch from early-close to late-close message after 1s
    setTimeout(() => {
      if (this._ws !== null) {
        this._ws.onclose = ws_closed_late;
      }
    }, 1000);
    this._ws.onmessage = (evt: MessageEvent) => {
      this._handleWSMessage(evt);
    };
  }

  /**
   * Handle a websocket entering the open state,
   * signaling that the kernel is connected when websocket is open.
   *
   * @function _wsOpened
   */
  private _wsOpened(evt: IWebSocketEvent): void {
    if (this.isConnected()) {
      // all events ready, trigger started event.
      this._kernelConnected();
    }
  }

  /**
   * Handle a websocket entering the closed state.  If the websocket
   * was not closed due to an error, try to reconnect to the kernel.
   *
   * @function _wsClosed
   * @param {string} ws_url - the websocket url
   * @param {bool} error - whether the connection was closed due to an error
   */
  private _wsClosed(ws_url: string, error: boolean): void {
    this.stopChannels();
    this._handleStatus('disconnected');
    if (error) {
      console.log('WebSocket connection failed: ', ws_url);
      this._handleStatus('connectionFailed');
    }
    this._scheduleReconnect();
  }

  /**
   * function to call when kernel connection is lost
   * schedules reconnect, or fires 'connection_dead' if reconnect limit is hit
   */
  private _scheduleReconnect(): void {
    if (this._reconnectAttempt < this._reconnectLimit) {
      var timeout = Math.pow(2, this._reconnectAttempt);
      console.log("Connection lost, reconnecting in " + timeout + " seconds.");
      setTimeout(() => { this.reconnect(); }, 1e3 * timeout);
    } else {
       this._handleStatus('connectionDead');
       console.log("Failed to reconnect, giving up.");
    }
  }

  private _handleWSMessage(e: MessageEvent): Promise<IKernelMsg> {
    this._msgQueue = this._msgQueue.then(() => {
      return serialize.deserialize(e.data);
    }).then(function(msg) { return this._finishWSMessage(msg); })
      .catch(utils.reject("Couldn't process kernel message", true));
    return;
  }

  private _finishWSMessage(msg: IKernelMsg): void {
    if (msg.channel === 'iopub' && msg.msg_type === 'status'){
      this._handleStatusMessage(msg);
    }
    if (msg.parent_header) {
      var future = this._handlerMap.get(msg.parent_header.msg_id);
      if (future) {
        future.handleMsg(msg);
      }
    }
  }

  /**
   * @function _handleStatusMessage
   */
  private _handleStatusMessage(msg: IKernelMsg): void {
    var execution_state = msg.content.execution_state;

    if (execution_state !== 'dead') {
        this._handleStatus(execution_state);
    }

    if (execution_state === 'starting') {
      this.kernelInfo().onReply((reply: IKernelMsg) => {
        this._infoReply = reply.content;
        this._handleStatus('ready');
        this._autorestartAttempt = 0;
      });

    } else if (execution_state === 'restarting') {
      // autorestarting is distinct from restarting,
      // in that it means the kernel died and the server is restarting it.
      // kernel_restarting sets the notification widget,
      // autorestart shows the more prominent dialog.
      this._autorestartAttempt = this._autorestartAttempt + 1;
      this._handleStatus('autorestarting');

    } else if (execution_state === 'dead') {
      this._kernelDead();
    }
  }

  private _id: string;
  private _name: string;
  private _kernelServiceUrl: string;
  private _kernelUrl: string;
  private _wsUrl: string;
  private _username: string;
  private _sessionId: string;
  private _ws: WebSocket;
  private _infoReply: any;
  private _WebSocket: any;
  private _reconnectLimit: number;
  private _msgQueue: Promise<IKernelMsg>;
  private _autorestartAttempt: number;
  private _reconnectAttempt: number;
  private _handlerMap: Map<string, KernelFutureHandler>;
  private _iopubHandlers: Map<string, (msg: IKernelMsg) => void>;
}
