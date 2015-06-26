// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

"use strict";

import utils = require('./utils');
import comm = require('./comm');
import serialize = require('./serialize');

import Signal = phosphor.core.Signal;
import emit = phosphor.core.emit;

import IKernelMsg = comm.IKernelMsg;


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

    static sendInputReply = new Signal<Kernel, any>();
    static created = new Signal<Kernel, void>();
    static reconnecting = new Signal<Kernel, number>();
    static starting = new Signal<Kernel, void>();
    static restarting = new Signal<Kernel, void>();
    static autorestarting = new Signal<Kernel, number>();
    static interrupting = new Signal<Kernel, void>();
    static disconnected = new Signal<Kernel, void>();
    static idle = new Signal<Kernel, void>();
    static busy = new Signal<Kernel, void>();
    static ready = new Signal<Kernel, void>();
    static killed = new Signal<Kernel, void>();
    static dead = new Signal<Kernel, void>();
    static connected = new Signal<Kernel, void>();
    static connectionFailed = new Signal<Kernel, { ws_url: string; attempt: number; }>();
    static connectionDead = new Signal<Kernel, number>();
    static executionRequest = new Signal<Kernel, comm.IMsgContent>();
    static inputReply = new Signal<Kernel, comm.IMsgContent>();
    static shellReply = new Signal<Kernel, IKernelMsg>();
    static receivedUnsolicitedMessage = new Signal<Kernel, IKernelMsg>();

    id: string;
    name: string;
    kernel_service_url: string;
    kernel_url: string;
    ws_url: string;
    username: string;
    session_id: string;
    ws: WebSocket;
    info_reply: any;
    WebSocket: any;
    comm_manager: comm.CommManager;
    last_msg_id: string;
    last_msg_callbacks: any;
    reconnect_limit: number;

    constructor(kernel_service_url: string, ws_url: string, name: string) {

        this.id = null;
        this.name = name;
        this.ws = null;

        this.kernel_service_url = kernel_service_url;
        this.kernel_url = null;
        this.ws_url = ws_url;
        if (!this.ws_url) {
            // trailing 's' in https will become wss for secure web sockets
            this.ws_url = location.protocol.replace('http', 'ws') + "//" + location.host;
        }

        this.username = "username";
        this.session_id = utils.uuid();
        this._msg_callbacks = {};
        this._msg_queue = Promise.resolve();
        this.info_reply = {}; // kernel_info_reply stored here after starting

        if (typeof (WebSocket) === 'undefined') {
            alert('Your browser does not have WebSocket support, please try Chrome, Safari, or Firefox ≥ 11.');
        }

        this.initIOPubHandlers();
        this.comm_manager = new comm.CommManager(this);

        this.last_msg_id = null;
        this.last_msg_callbacks = {};

        this._autorestart_attempt = 0;
        this._reconnect_attempt = 0;
        this.reconnect_limit = 7;
    }

    /**
     * @function _get_msg
     */
    private _getMsg(msg_type: string, content: comm.IMsgContent,
        metadata: comm.IMsgMetadata = {}, buffers: string[] = []): comm.IKernelMsg {
        var msg: IKernelMsg = {
            header: {
                msg_id: utils.uuid(),
                username: this.username,
                session: this.session_id,
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

    private _recordStatus(status: string) {
        console.log('Kernel: ' + status + ' (' + this.id + ')');
    }

    /**
     * Initialize the iopub handlers.
     *
     * @function init_iopub_handlers
     */
    initIOPubHandlers(): void {
        var output_msg_types = ['stream', 'display_data', 'execute_result', 'error'];
        this._iopub_handlers = {};
        this.registerIOPubHandler('status', this._handleStatusMessage);
        this.registerIOPubHandler('clear_output', this._handle_clear_output);
        this.registerIOPubHandler('execute_input', this._handleInputMessage);

        for (var i = 0; i < output_msg_types.length; i++) {
            this.registerIOPubHandler(output_msg_types[i], this._handleOutputMessage);
        }
    }

    /**
     * GET /api/kernels
     *
     * Get the list of running kernels.
     *
     * @function list
     * @param {function} [success] - function executed on ajax success
     * @param {function} [error] - functon executed on ajax error
     */
    list(success: utils.IAJaxSuccess, error: Function): void {
        utils.ajaxProxy(this.kernel_service_url, {
            method: "GET",
            dataType: "json",
            success: success,
            error: this._onError(error)
        });
    }

    /**
     * POST /api/kernels
     *
     * Start a new kernel.
     *
     * In general this shouldn't be used -- the kernel should be
     * started through the session API. If you use this function and
     * are also using the session API then your session and kernel
     * WILL be out of sync!
     *
     * @function start
     * @param {params} [Object] - parameters to include in the query string
     * @param {function} [success] - function executed on ajax success
     * @param {function} [error] - functon executed on ajax error
     */
    start(params: Object, success: Function, error: Function): string {
        var url: string = this.kernel_service_url;
        var qs = utils.jsonToQueryString(params || {}); // query string for sage math stuff
        if (qs !== "") {
            url = url + "?" + qs;
        }

        this._recordStatus('starting');
        var on_success = (msg: comm.IMsgSuccess) => {
            this._kernelCreated(msg.data);
            if (success) {
                success(msg.data, msg.status, msg.xhr);
            }
        };

        utils.ajaxProxy(url, {
            method: "POST",
            data: JSON.stringify({ name: this.name }),
            contentType: 'application/json',
            dataType: "json",
            success: this._onSuccess(on_success),
            error: this._onError(error)
        });

        return url;
    }

    /**
     * GET /api/kernels/[:kernel_id]
     *
     * Get information about the kernel.
     *
     * @function get_info
     * @param {function} [success] - function executed on ajax success
     * @param {function} [error] - functon executed on ajax error
     */
    getInfo(success: Function, error: Function): void {
        utils.ajaxProxy(this.kernel_url, {
            method: "GET",
            dataType: "json",
            success: this._onSuccess(success),
            error: this._onError(error)
        });
    }

    /**
     * DELETE /api/kernels/[:kernel_id]
     *
     * Shutdown the kernel.
     *
     * If you are also using sessions, then this function shoul NOT be
     * used. Instead, use Session.delete. Otherwise, the session and
     * kernel WILL be out of sync.
     *
     * @function kill
     * @param {function} [success] - function executed on ajax success
     * @param {function} [error] - functon executed on ajax error
     */
    kill(success: Function, error: Function): void {
        this._recordStatus('killed');
        emit(this, Kernel.killed, void 0);
        this._kernelDead();
        utils.ajaxProxy(this.kernel_url, {
            method: "DELETE",
            dataType: "json",
            success: this._onSuccess(success),
            error: this._onError(error)
        });
    }

    /**
     * POST /api/kernels/[:kernel_id]/interrupt
     *
     * Interrupt the kernel.
     *
     * @function interrupt
     * @param {function} [success] - function executed on ajax success
     * @param {function} [error] - functon executed on ajax error
     */
    interrupt(success: Function, error: Function): void {
        this._recordStatus('interrupting');
        emit(this, Kernel.interrupting, void 0);

        var on_success = (msg: comm.IMsgSuccess) => {
            /**
             * get kernel info so we know what state the kernel is in
             */
            this.kernelInfo();
            if (success) {
                success(msg.data, msg.status, msg.xhr);
            }
        };

        var url = utils.urlJoinEncode(this.kernel_url, 'interrupt');
        utils.ajaxProxy(url, {
            method: "POST",
            dataType: "json",
            success: this._onSuccess(on_success),
            error: this._onError(error)
        });
    }

    /**
     * POST /api/kernels/[:kernel_id]/restart
     *
     * Restart the kernel.
     *
     * @function interrupt
     * @param {function} [success] - function executed on ajax success
     * @param {function} [error] - functon executed on ajax error
     */
    restart(success: Function, error: Function): void {
        this._recordStatus('restarting');
        emit(this, Kernel.restarting, void 0);
        this.stopChannels();

        var on_success = (msg: comm.IMsgSuccess) => {
            this._kernelCreated(msg.data);
            if (success) {
                success(msg.data, msg.status, msg.xhr);
            }
        };

        var on_error = (xhr: XMLHttpRequest, status: string, err: string) => {
            this._kernelDead();
            if (error) {
                error(xhr, status, err);
            }
        };

        var url = utils.urlJoinEncode(this.kernel_url, 'restart');
        utils.ajaxProxy(url, {
            method: "POST",
            dataType: "json",
            success: this._onSuccess(on_success),
            error: this._onError(on_error)
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
        this._reconnect_attempt = this._reconnect_attempt + 1;
        this._recordStatus('reconnecting');
        emit(this, Kernel.reconnecting, this._reconnect_attempt);
        this.startChannels();
    }

    /**
     * Handle a successful AJAX request by updating the kernel id and
     * name from the response, and then optionally calling a provided
     * callback.
     *
     * @function _on_success
     * @param {function} success - callback
     */
    private _onSuccess(success: Function): utils.IAJaxSuccess {
        return (msg: comm.IMsgSuccess) => {
            if (msg.data) {
                this.id = msg.data.id;
                this.name = msg.data.name;
            }
            this.kernel_url = utils.urlJoinEncode(this.kernel_service_url, this.id);
            if (success) {
                success(msg.data, msg.status, msg.xhr);
            }
        };
    }

    /**
     * Handle a failed AJAX request by logging the error message, and
     * then optionally calling a provided callback.
     *
     * @function _on_error
     * @param {function} error - callback
     */
    private _onError(error?: Function): utils.IAJaxError {

        return (xhr: XMLHttpRequest, status: string, err: string) => {
            utils.logAjaxError(xhr, status, err);
            if (error) {
                error(xhr, status, err);
            }
        };
    }

    /**
     * Perform necessary tasks once the kernel has been started,
     * including actually connecting to the kernel.
     *
     * @function _kernel_created
     * @param {Object} data - information about the kernel including id
     */
    private _kernelCreated(data: comm.IMsgData): void {
        this._recordStatus('created');
        emit(this, Kernel.created, void 0);
        this.id = data.id;
        this.kernel_url = utils.urlJoinEncode(this.kernel_service_url, this.id);
        this.startChannels();
    }

    /**
     * Perform necessary tasks once the connection to the kernel has
     * been established. This includes requesting information about
     * the kernel.
     *
     * @function _kernel_connected
     */
    private _kernelConnected(): void {
        this._recordStatus('connected');
        this._reconnect_attempt = 0;
        emit(this, Kernel.connected, void 0);
        // get kernel info so we know what state the kernel is in
        this.kernelInfo((reply?: comm.IKernelMsg) => {
            this.info_reply = reply.content;
            this._recordStatus('ready');
            this._autorestart_attempt = 0;
            emit(this, Kernel.ready, void 0);
        });
    }

    /**
     * Perform necessary tasks after the kernel has died. This closing
     * communication channels to the kernel if they are still somehow
     * open.
     *
     * @function _kernel_dead
     */
    private _kernelDead(): void {
        this._recordStatus('dead');
        emit(this, Kernel.dead, void 0);
        this.stopChannels();
    }

    /**
     * Start the websocket channels.
     * Will stop and restart them if they already exist.
     *
     * @function start_channels
     */
    startChannels(): void {
        this.stopChannels();
        var ws_host_url = this.ws_url + this.kernel_url;

        console.log("Starting WebSockets:", ws_host_url);

        this.ws = new WebSocket([
            this.ws_url,
            utils.urlJoinEncode(this.kernel_url, 'channels'),
            "?session_id=" + this.session_id
        ].join('')
            );

        var already_called_onclose = false; // only alert once
        this.ws.onclose = (evt: comm.IKernelEvent) => {
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
                this.getInfo(function() {
                    this._ws_closed(ws_host_url, false);
                }, function() {
                    this._kernel_dead();
                });
            }
        };
        this.ws.onerror = (evt: comm.IKernelEvent) => {
            if (already_called_onclose) {
                return;
            }
            already_called_onclose = true;
            this._wsClosed(ws_host_url, true);
        };

        this.ws.onopen = (evt: comm.IKernelEvent) => {
            this._wsOpened(evt);
        };
        var ws_closed_late = (evt: comm.IKernelEvent) => {
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
            if (this.ws !== null) {
                this.ws.onclose = ws_closed_late;
            }
        }, 1000);
        this.ws.onmessage = (evt: comm.IKernelEvent) => {
            this._handleWSMessage(evt);
        };
    }

    /**
     * Handle a websocket entering the open state,
     * signaling that the kernel is connected when websocket is open.
     *
     * @function _ws_opened
     */
    private _wsOpened(evt: comm.IKernelEvent): void {
        if (this.isConnected()) {
            // all events ready, trigger started event.
            this._kernelConnected();
        }
    }

    /**
     * Handle a websocket entering the closed state.  If the websocket
     * was not closed due to an error, try to reconnect to the kernel.
     *
     * @function _ws_closed
     * @param {string} ws_url - the websocket url
     * @param {bool} error - whether the connection was closed due to an error
     */
    private _wsClosed(ws_url: string, error: boolean): void {

        this.stopChannels();

        this._recordStatus('disconnected');
        emit(this, Kernel.disconnected, void 0);
        if (error) {
            console.log('WebSocket connection failed: ', ws_url);
            emit(this, Kernel.connectionFailed,
                { ws_url: ws_url, attempt: this._reconnect_attempt });
        }
        this._scheduleReconnect();
    }

    /**
     * function to call when kernel connection is lost
     * schedules reconnect, or fires 'connection_dead' if reconnect limit is hit
     */
    private _scheduleReconnect(): void {

        if (this._reconnect_attempt < this.reconnect_limit) {
            var timeout = Math.pow(2, this._reconnect_attempt);
            console.log("Connection lost, reconnecting in " + timeout + " seconds.");
            setTimeout(() => { this.reconnect(); }, 1e3 * timeout);
        } else {
            emit(this, Kernel.connectionDead, this._reconnect_attempt);
            console.log("Failed to reconnect, giving up.");
        }
    }

    /**
     * Close the websocket. After successful close, the value
     * in `this.ws` will be null.
     *
     * @function stop_channels
     */
    stopChannels(): void {

        var close = () => {
            if (this.ws && this.ws.readyState === WebSocket.CLOSED) {
                this.ws = null;
            }
        };
        if (this.ws !== null) {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.onclose = close;
                this.ws.close();
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
     * @function is_connected
     * @returns {bool} - whether there is a connection
     */
    isConnected(): boolean {

        // if any channel is not ready, then we're not connected
        if (this.ws === null) {
            return false;
        }
        if (this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        return true;
    }

    /**
     * Check whether the connection to the kernel has been completely
     * severed. This function only returns true if all channel objects
     * are null.
     *
     * @function is_fully_disconnected
     * @returns {bool} - whether the kernel is fully disconnected
     */
    isFullyDisconnected(): boolean {

        return (this.ws === null);
    }

    /**
     * Send a message on the Kernel's shell channel
     *
     * @function send_shell_message
     */
    sendShellMessage(msg_type: string, content: comm.IMsgContent, callbacks: comm.IKernelCallbacks, metadata: comm.IMsgMetadata = {}, buffers: string[] = []): string {

        if (!this.isConnected()) {
            throw new Error("kernel is not connected");
        }
        var msg = this._getMsg(msg_type, content, metadata, buffers);
        msg.channel = 'shell';
        this.ws.send(serialize.serialize(msg));
        this.setCallbacksForMsg(msg.header.msg_id, callbacks);
        return msg.header.msg_id;
    }

    /**
     * Get kernel info
     *
     * @function kernel_info
     * @param callback {function}
     *
     * When calling this method, pass a callback function that expects one argument.
     * The callback will be passed the complete `kernel_info_reply` message documented
     * [here](http://ipython.org/ipython-doc/dev/development/messaging.html#kernel-info)
     */
    kernelInfo(callback?: Function): string {

        var callbacks: comm.IKernelShellCallbacks;
        if (callback) {
            callbacks = { shell: { reply: callback } };
        }
        return this.sendShellMessage("kernel_info_request", {}, callbacks);
    }

    /**
     * Get info on an object
     *
     * When calling this method, pass a callback function that expects one argument.
     * The callback will be passed the complete `inspect_reply` message documented
     * [here](http://ipython.org/ipython-doc/dev/development/messaging.html#object-information)
     *
     * @function inspect
     * @param code {string}
     * @param cursor_pos {integer}
     * @param callback {function}
     */
    inspect(code: string, cursor_pos: number, callback: Function): string {

        var callbacks: comm.IKernelShellCallbacks;
        if (callback) {
            callbacks = { shell: { reply: callback } };
        }

        var content = {
            code: code,
            cursor_pos: cursor_pos,
            detail_level: 0
        };
        return this.sendShellMessage("inspect_request", content, callbacks);
    }

    /**
     * Execute given code into kernel, and pass result to callback.
     *
     * @async
     * @function execute
     * @param {string} code
     * @param [callbacks] {Object} With the following keys (all optional)
     *      @param callbacks.shell.reply {function}
     *      @param callbacks.shell.payload.[payload_name] {function}
     *      @param callbacks.iopub.output {function}
     *      @param callbacks.iopub.clear_output {function}
     *      @param callbacks.input {function}
     * @param {object} [options]
     *      @param [options.silent=false] {Boolean}
     *      @param [options.user_expressions=empty_dict] {Dict}
     *      @param [options.allow_stdin=false] {Boolean} true|false
     *
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
     * When calling this method pass a callbacks structure of the
     * form:
     *
     *      callbacks = {
     *       shell : {
     *         reply : execute_reply_callback,
     *         payload : {
     *           set_next_input : set_next_input_callback,
     *         }
     *       },
     *       iopub : {
     *         output : output_callback,
     *         clear_output : clear_output_callback,
     *       },
     *       input : raw_input_callback
     *      }
     *
     * Each callback will be passed the entire message as a single
     * arugment.  Payload handlers will be passed the corresponding
     * payload and the execute_reply message.
     */
    execute(code: string, callbacks: comm.IKernelCallbacks, options: comm.IKernelOptions): string {

        var content: comm.IMsgContent = {
            code: code,
            silent: true,
            store_history: false,
            user_expressions: {},
            allow_stdin: false
        };
        callbacks = callbacks || {};
        if (callbacks.input !== undefined) {
            content.allow_stdin = true;
        }
        utils.extend(content, options);
        emit(this, Kernel.executionRequest, content);
        return this.sendShellMessage("execute_request", content, callbacks);
    }

    /**
     * When calling this method, pass a function to be called with the
     * `complete_reply` message as its only argument when it arrives.
     *
     * `complete_reply` is documented
     * [here](http://ipython.org/ipython-doc/dev/development/messaging.html#complete)
     *
     * @function complete
     * @param code {string}
     * @param cursor_pos {integer}
     * @param callback {function}
     */
    complete(code: string, cursor_pos: number, callback: Function): string {
        var callbacks: comm.IKernelCallbacks;
        if (callback) {
            callbacks = { shell: { reply: callback } };
        }
        var content = {
            code: code,
            cursor_pos: cursor_pos
        };
        return this.sendShellMessage("complete_request", content, callbacks);
    }

    /**
     * @function send_input_reply
     */
    sendInputReply(input: comm.IKernelInput): string {
        if (!this.isConnected()) {
            throw new Error("kernel is not connected");
        }
        var content: comm.IMsgContent = {
            value: input
        };
        emit(this, Kernel.inputReply, content);
        var msg = this._getMsg("input_reply", content);
        msg.channel = 'stdin';
        this.ws.send(serialize.serialize(msg));
        return msg.header.msg_id;
    }

    /**
     * @function register_iopub_handler
     */
    registerIOPubHandler(msg_type: string, callback: Function): void {
        this._iopub_handlers[msg_type] = () => { callback(); };
    }

    /**
     * Get the iopub handler for a specific message type.
     *
     * @function get_iopub_handler
     */
    getIOPubHandler(msg_type: string): any {
        return this._iopub_handlers[msg_type];
    }

    /**
     * Get callbacks for a specific message.
     *
     * @function get_callbacks_for_msg
     */
    getCallbacksForMsg(msg_id: string): any {
        if (msg_id == this.last_msg_id) {
            return this.last_msg_callbacks;
        } else {
            return this._msg_callbacks[msg_id];
        }
    }

    /**
     * Clear callbacks for a specific message.
     *
     * @function clear_callbacks_for_msg
     */
    clearCallbacksForMsg(msg_id: string): void {
        if (this._msg_callbacks[msg_id] !== undefined) {
            delete this._msg_callbacks[msg_id];
        }
    }
    
    /**
     * @function _finish_shell
     */
    private _finishShell(msg_id: string): void {
        var callbacks = this._msg_callbacks[msg_id];
        if (callbacks !== undefined) {
            callbacks.shell_done = true;
            if (callbacks.iopub_done) {
                this.clearCallbacksForMsg(msg_id);
            }
        }
    }

    /**
     * @function _finish_iopub
     */
    private _finishIOPub(msg_id: string): void {
        var callbacks = this._msg_callbacks[msg_id];
        if (callbacks !== undefined) {
            callbacks.iopub_done = true;
            if (callbacks.shell_done) {
                this.clearCallbacksForMsg(msg_id);
            }
        }
    }
    
    /**
     * Set callbacks for a particular message.
     * Callbacks should be a struct of the following form:
     * shell : {
     * 
     * }
     *
     * @function set_callbacks_for_msg
     */
    setCallbacksForMsg(msg_id: string, callbacks: comm.IKernelCallbacks): void {
        this.last_msg_id = msg_id;
        if (callbacks) {
            // shallow-copy mapping, because we will modify it at the top level
            var cbcopy: any = this._msg_callbacks[msg_id] = this.last_msg_callbacks = {};
            cbcopy.shell = callbacks.shell;
            cbcopy.iopub = callbacks.iopub;
            cbcopy.input = callbacks.input;
            cbcopy.shell_done = (!callbacks.shell);
            cbcopy.iopub_done = (!callbacks.iopub);
        } else {
            this.last_msg_callbacks = {};
        }
    }

    private _handleWSMessage(e: comm.IKernelEvent): Promise<any> {
        this._msg_queue = this._msg_queue.then(() => {
            return serialize.deserialize(e.data);
        }).then(function(msg) { return this._finish_ws_message(msg); })
            .catch(utils.reject("Couldn't process kernel message", true));
        return;
    }

    private _finishWSMessage(msg: IKernelMsg): Promise<any> {
        switch (msg.channel) {
            case 'shell':
                return this._handleShellReply(msg);
                break;
            case 'iopub':
                this._handleIOPubMessage(msg);
                break;
            case 'stdin':
                this._handleInputRequest(msg);
                break;
            default:
                console.error("unrecognized message channel", msg.channel, msg);
        }
        return Promise.resolve();
    }

    private _handleShellReply(reply: IKernelMsg): Promise<any> {
        emit(this, Kernel.shellReply, reply);
        var content = reply.content;
        var metadata = reply.metadata;
        var parent_id = reply.parent_header.msg_id;
        var callbacks = this.getCallbacksForMsg(parent_id);
        var promise = Promise.resolve();
        if (!callbacks || !callbacks.shell) {
            return promise;
        }
        var shell_callbacks = callbacks.shell;
        
        // signal that shell callbacks are done
        this._finishShell(parent_id);

        if (shell_callbacks.reply !== undefined) {
            promise = promise.then(function() { return shell_callbacks.reply(reply) });
        }
        if (content.payload && shell_callbacks.payload) {
            promise = promise.then(() => {
                return this._handlePayload(content.payload, shell_callbacks.payload, reply);
            });
        }
        return promise;
    }

    /**
     * @function _handle_payloads
     */
    private _handlePayload(payloads: comm.IMsgPayload[],
        payload_callbacks: comm.IMsgPayloadCallbacks,
        msg: IKernelMsg): Promise<any> {
        var promise: comm.IKernelCallbacks[] = [];
        var l = payloads.length;
        // Payloads are handled by triggering events because we don't want the Kernel
        // to depend on the Notebook or Pager classes.
        for (var i = 0; i < l; i++) {
            var payload = payloads[i];
            var callback = payload_callbacks[payload.source];
            if (callback) {
                promise.push(callback(payload, msg));
            }
        }
        return Promise.all(promise);
    }

    /**
     * @function _handle_status_message
     */
    private _handleStatusMessage(msg: IKernelMsg): void {
        var execution_state = msg.content.execution_state;
        var parent_id = msg.parent_header.msg_id;
        
        // dispatch status msg callbacks, if any
        var callbacks = this.getCallbacksForMsg(parent_id);
        if (callbacks && callbacks.iopub && callbacks.iopub.status) {
            try {
                callbacks.iopub.status(msg);
            } catch (e) {
                console.log("Exception in status msg handler", e, e.stack);
            }
        }

        if (execution_state === 'busy') {
            // uncomment for debugging
            //this._recordStatus('busy');
            emit(this, Kernel.busy, void 0);

        } else if (execution_state === 'idle') {
            // signal that iopub callbacks are (probably) done
            // async output may still arrive,
            // but only for the most recent request
            this._finishIOPub(parent_id);
            
            // trigger status_idle event
            // uncomment for debugging
            //this._recordStatus('idle');
            emit(this, Kernel.idle, void 0);

        } else if (execution_state === 'starting') {
            this._recordStatus('starting');
            emit(this, Kernel.starting, void 0);
            this.kernelInfo((reply: IKernelMsg) => {
                this.info_reply = reply.content;
                this._recordStatus('ready');
                this._autorestart_attempt = 0;
                emit(this, Kernel.ready, void 0);
            });

        } else if (execution_state === 'restarting') {
            // autorestarting is distinct from restarting,
            // in that it means the kernel died and the server is restarting it.
            // kernel_restarting sets the notification widget,
            // autorestart shows the more prominent dialog.
            this._autorestart_attempt = this._autorestart_attempt + 1;
            this._recordStatus('restarting');
            emit(this, Kernel.restarting, void 0);
            this._recordStatus('autorestarting');
            emit(this, Kernel.autorestarting, this._autorestart_attempt);

        } else if (execution_state === 'dead') {
            this._kernelDead();
        }
    }
    
    /**
     * Handle clear_output message
     *
     * @function _handle_clear_output
     */
    private _handle_clear_output(msg: IKernelMsg): void {
        var callbacks = this.getCallbacksForMsg(msg.parent_header.msg_id);
        if (!callbacks || !callbacks.iopub) {
            return;
        }
        var callback = callbacks.iopub.clear_output;
        if (callback) {
            callback(msg);
        }
    }

    /**
     * handle an output message (execute_result, display_data, etc.)
     *
     * @function _handle_output_message
     */
    private _handleOutputMessage(msg: IKernelMsg): void {
        var callbacks = this.getCallbacksForMsg(msg.parent_header.msg_id);
        if (!callbacks || !callbacks.iopub) {
            // The message came from another client. Let the UI decide what to
            // do with it.
            emit(this, Kernel.receivedUnsolicitedMessage, msg);
            return;
        }
        var callback = callbacks.iopub.output;
        if (callback) {
            callback(msg);
        }
    }

    /**
     * Handle an input message (execute_input).
     *
     * @function _handle_input message
     */
    private _handleInputMessage(msg: IKernelMsg): void {
        var callbacks = this.getCallbacksForMsg(msg.parent_header.msg_id);
        if (!callbacks) {
            // The message came from another client. Let the UI decide what to
            // do with it.
            emit(this, Kernel.receivedUnsolicitedMessage, msg);
        }
    }

    /**
     * Dispatch IOPub messages to respective handlers. Each message
     * type should have a handler.
     *
     * @function _handle_iopub_message
     */
    private _handleIOPubMessage(msg: IKernelMsg): void {
        var handler = this.getIOPubHandler(msg.header.msg_type);
        if (handler !== undefined) {
            handler(msg);
        }
    }

    /**
     * @function _handle_input_request
     */
    private _handleInputRequest(request: IKernelMsg): void {
        var header = request.header;
        var content = request.content;
        var metadata = request.metadata;
        var msg_type = header.msg_type;
        if (msg_type !== 'input_request') {
            console.log("Invalid input request!", request);
            return;
        }
        var callbacks = this.getCallbacksForMsg(request.parent_header.msg_id);
        if (callbacks) {
            if (callbacks.input) {
                callbacks.input(request);
            }
        }
    }

    private _msg_callbacks: any;
    private _msg_queue: Promise<any>;
    private _autorestart_attempt: number;
    private _reconnect_attempt: number;
    private _iopub_handlers: any;

}
