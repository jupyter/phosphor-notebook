// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

"use strict";

import $ = require('jquery');
import utils = require('./utils');
import comm = require('./comm');
import serialize = require('./serialize');


interface IPayload {
    source: string;

};


interface IPayloadCallbacks {
    [s: string]: Function;
};


interface IContent {
    payload?: IPayload[];
    execution_state?: string;
};


interface IMetadata {

};


interface IKernelInput {

};


interface IKernelInfo {
    kernel: { id: string };
};



interface IKernelData {
    id: string;
    name: string;
};


interface IKernelReply {
    content: Object;
};


interface IKernelSuccess {
    data: IKernelData;
    status: string;
    xhr: JQueryXHR;
};


interface IKernelShellCallbacks {
    reply?: Function;
    payload?: any;
};


interface IKernelIOPubCallbacks {
    output?: Function;
    clear_output?: Function;
};


interface IKernelCallbacks {
    // @param callbacks.shell.payload.[payload_name] {function}
    shell?: IKernelShellCallbacks;
    iopub?: IKernelIOPubCallbacks;
    input?: Function;
};


interface IKernelOptions {
    silent?: boolean;
    user_expressions?: Object;
    allow_stdin?: boolean;
};


interface IKernelEvent extends Event {
    wasClean?: boolean;
    data?: string | ArrayBuffer | Blob;
};


interface IKernelParentHeader {
    msg_id: string;
};


interface IChannel {

};


interface IHeader {
    msg_type: string;
};


interface IKernelMessage {
    channel: IChannel;
    content: IContent;
    metadata: IMetadata;
    parent_header: IKernelParentHeader;
    header: IHeader;
};


interface IAjaxSuccess {
    (data: any, status: string, xhr: JQueryXHR): void;
};


interface IAjaxError {
    (xhr: JQueryXHR, status: string, err: string): void;
};


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
export class Kernel {

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
    events: JQuery;

    constructor(kernel_service_url: string, ws_url: string, name: string) {

        this.id = null;
        this.name = name;
        this.ws = null;

        this.kernel_service_url = kernel_service_url;
        this.kernel_url = null;
        this.ws_url = ws_url || utils.get_body_data("wsUrl");
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

        this.bind_events();
        this.init_iopub_handlers();
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
    protected _get_msg(msg_type: string, content: IContent,
        metadata: IMetadata = {}, buffers: string[] = []): any {
        var msg: any = {
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

    /**
     * @function bind_events
     */
    bind_events(): void {
        this.events.on('send_input_reply.Kernel', (evt: JQueryEventObject, data: any) => {
            this.send_input_reply(data);
        });

        var record_status = (evt: Event, info: IKernelInfo) => {
            console.log('Kernel: ' + evt.type + ' (' + info.kernel.id + ')');
        };

        this.events.on('kernel_created.Kernel', record_status);
        this.events.on('kernel_reconnecting.Kernel', record_status);
        this.events.on('kernel_connected.Kernel', record_status);
        this.events.on('kernel_starting.Kernel', record_status);
        this.events.on('kernel_restarting.Kernel', record_status);
        this.events.on('kernel_autorestarting.Kernel', record_status);
        this.events.on('kernel_interrupting.Kernel', record_status);
        this.events.on('kernel_disconnected.Kernel', record_status);
        // these are commented out because they are triggered a lot, but can
        // be uncommented for debugging purposes
        //this.events.on('kernel_idle.Kernel', record_status);
        //this.events.on('kernel_busy.Kernel', record_status);
        this.events.on('kernel_ready.Kernel', record_status);
        this.events.on('kernel_killed.Kernel', record_status);
        this.events.on('kernel_dead.Kernel', record_status);

        this.events.on('kernel_ready.Kernel', () => {
            this._autorestart_attempt = 0;
        });
        this.events.on('kernel_connected.Kernel', () => {
            this._reconnect_attempt = 0;
        });
    }

    /**
     * Initialize the iopub handlers.
     *
     * @function init_iopub_handlers
     */
    init_iopub_handlers(): void {
        var output_msg_types = ['stream', 'display_data', 'execute_result', 'error'];
        this._iopub_handlers = {};
        this.register_iopub_handler('status', $.proxy(this._handle_status_message, this));
        this.register_iopub_handler('clear_output', $.proxy(this._handle_clear_output, this));
        this.register_iopub_handler('execute_input', $.proxy(this._handle_input_message, this));

        for (var i = 0; i < output_msg_types.length; i++) {
            this.register_iopub_handler(output_msg_types[i], $.proxy(this._handle_output_message, this));
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
    list(success: IAjaxSuccess, error: Function): void {
        $.ajax(this.kernel_service_url, {
            processData: false,
            cache: false,
            type: "GET",
            dataType: "json",
            success: success,
            error: this._on_error(error)
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
        var qs = $.param(params || {}); // query string for sage math stuff
        if (qs !== "") {
            url = url + "?" + qs;
        }

        this.events.trigger('kernel_starting.Kernel', { kernel: this });
        var on_success = (msg: IKernelSuccess) => {
            this.events.trigger('kernel_created.Kernel', { kernel: this });
            this._kernel_created(msg.data);
            if (success) {
                success(msg.data, msg.status, msg.xhr);
            }
        };

        $.ajax(url, {
            processData: false,
            cache: false,
            type: "POST",
            data: JSON.stringify({ name: this.name }),
            contentType: 'application/json',
            dataType: "json",
            success: this._on_success(on_success),
            error: this._on_error(error)
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
    get_info(success: Function, error: Function): void {
        $.ajax(this.kernel_url, {
            processData: false,
            cache: false,
            type: "GET",
            dataType: "json",
            success: this._on_success(success),
            error: this._on_error(error)
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
        this.events.trigger('kernel_killed.Kernel', { kernel: this });
        this._kernel_dead();
        $.ajax(this.kernel_url, {
            processData: false,
            cache: false,
            type: "DELETE",
            dataType: "json",
            success: this._on_success(success),
            error: this._on_error(error)
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
        this.events.trigger('kernel_interrupting.Kernel', { kernel: this });

        var on_success = (msg: IKernelSuccess) => {
            /**
             * get kernel info so we know what state the kernel is in
             */
            this.kernel_info();
            if (success) {
                success(msg.data, msg.status, msg.xhr);
            }
        };

        var url = utils.url_join_encode(this.kernel_url, 'interrupt');
        $.ajax(url, {
            processData: false,
            cache: false,
            type: "POST",
            contentType: false,  // there's no data with this
            dataType: "json",
            success: this._on_success(on_success),
            error: this._on_error(error)
        });
    }

    restart(success: Function, error: Function): void {
        /**
         * POST /api/kernels/[:kernel_id]/restart
         *
         * Restart the kernel.
         *
         * @function interrupt
         * @param {function} [success] - function executed on ajax success
         * @param {function} [error] - functon executed on ajax error
         */
        this.events.trigger('kernel_restarting.Kernel', { kernel: this });
        this.stop_channels();

        var on_success = (msg: IKernelSuccess) => {
            this.events.trigger('kernel_created.Kernel', { kernel: this });
            this._kernel_created(msg.data);
            if (success) {
                success(msg.data, msg.status, msg.xhr);
            }
        };

        var on_error = (xhr: JQueryXHR, status: string, err: string) => {
            this.events.trigger('kernel_dead.Kernel', { kernel: this });
            this._kernel_dead();
            if (error) {
                error(xhr, status, err);
            }
        };

        var url = utils.url_join_encode(this.kernel_url, 'restart');
        $.ajax(url, {
            processData: false,
            cache: false,
            type: "POST",
            contentType: false,  // there's no data with this
            dataType: "json",
            success: this._on_success(on_success),
            error: this._on_error(on_error)
        });
    }

    reconnect(): void {
        /**
         * Reconnect to a disconnected kernel. This is not actually a
         * standard HTTP request, but useful function nonetheless for
         * reconnecting to the kernel if the connection is somehow lost.
         *
         * @function reconnect
         */
        if (this.is_connected()) {
            return;
        }
        this._reconnect_attempt = this._reconnect_attempt + 1;
        this.events.trigger('kernel_reconnecting.Kernel', {
            kernel: this,
            attempt: this._reconnect_attempt,
        });
        this.start_channels();
    }

    protected _on_success(success: Function): IAjaxSuccess {
        /**
         * Handle a successful AJAX request by updating the kernel id and
         * name from the response, and then optionally calling a provided
         * callback.
         *
         * @function _on_success
         * @param {function} success - callback
         */
        return (msg: IKernelSuccess) => {
            if (msg.data) {
                this.id = msg.data.id;
                this.name = msg.data.name;
            }
            this.kernel_url = utils.url_join_encode(this.kernel_service_url, this.id);
            if (success) {
                success(msg.data, msg.status, msg.xhr);
            }
        };
    }

    protected _on_error(error?: Function): IAjaxError {
        /**
         * Handle a failed AJAX request by logging the error message, and
         * then optionally calling a provided callback.
         *
         * @function _on_error
         * @param {function} error - callback
         */
        return (xhr: JQueryXHR, status: string, err: string) => {
            utils.log_ajax_error(xhr, status, err);
            if (error) {
                error(xhr, status, err);
            }
        };
    }

    protected _kernel_created(data: IKernelData): void {
        /**
         * Perform necessary tasks once the kernel has been started,
         * including actually connecting to the kernel.
         *
         * @function _kernel_created
         * @param {Object} data - information about the kernel including id
         */
        this.id = data.id;
        this.kernel_url = utils.url_join_encode(this.kernel_service_url, this.id);
        this.start_channels();
    }

    protected _kernel_connected(): void {
        /**
         * Perform necessary tasks once the connection to the kernel has
         * been established. This includes requesting information about
         * the kernel.
         *
         * @function _kernel_connected
         */
        this.events.trigger('kernel_connected.Kernel', { kernel: this });
        // get kernel info so we know what state the kernel is in
        this.kernel_info((reply?: IKernelReply) => {
            this.info_reply = reply.content;
            this.events.trigger('kernel_ready.Kernel', { kernel: this });
        });
    }

    protected _kernel_dead(): void {
        /**
         * Perform necessary tasks after the kernel has died. This closing
         * communication channels to the kernel if they are still somehow
         * open.
         *
         * @function _kernel_dead
         */
        this.stop_channels();
    }

    start_channels(): void {
        /**
         * Start the websocket channels.
         * Will stop and restart them if they already exist.
         *
         * @function start_channels
         */
        this.stop_channels();
        var ws_host_url = this.ws_url + this.kernel_url;

        console.log("Starting WebSockets:", ws_host_url);

        this.ws = new WebSocket([
            this.ws_url,
            utils.url_join_encode(this.kernel_url, 'channels'),
            "?session_id=" + this.session_id
        ].join('')
            );

        var already_called_onclose = false; // only alert once
        var ws_closed_early = (evt: IKernelEvent) => {
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
                this.get_info(function() {
                    this._ws_closed(ws_host_url, false);
                }, function() {
                    this.events.trigger('kernel_dead.Kernel', { kernel: this });
                    this._kernel_dead();
                });
            }
        };
        var ws_closed_late = (evt: IKernelEvent) => {
            if (already_called_onclose) {
                return;
            }
            already_called_onclose = true;
            if (!evt.wasClean) {
                this._ws_closed(ws_host_url, false);
            }
        };
        var ws_error = (evt: IKernelEvent) => {
            if (already_called_onclose) {
                return;
            }
            already_called_onclose = true;
            this._ws_closed(ws_host_url, true);
        };

        this.ws.onopen = $.proxy(this._ws_opened, this);
        this.ws.onclose = ws_closed_early;
        this.ws.onerror = ws_error;
        // switch from early-close to late-close message after 1s
        setTimeout(() => {
            if (this.ws !== null) {
                this.ws.onclose = ws_closed_late;
            }
        }, 1000);
        this.ws.onmessage = $.proxy(this._handle_ws_message, this);
    }

    protected _ws_opened(evt: IKernelEvent): void {
        /**
         * Handle a websocket entering the open state,
         * signaling that the kernel is connected when websocket is open.
         *
         * @function _ws_opened
         */
        if (this.is_connected()) {
            // all events ready, trigger started event.
            this._kernel_connected();
        }
    }

    protected _ws_closed(ws_url: string, error: boolean): void {
        /**
         * Handle a websocket entering the closed state.  If the websocket
         * was not closed due to an error, try to reconnect to the kernel.
         *
         * @function _ws_closed
         * @param {string} ws_url - the websocket url
         * @param {bool} error - whether the connection was closed due to an error
         */
        this.stop_channels();

        this.events.trigger('kernel_disconnected.Kernel', { kernel: this });
        if (error) {
            console.log('WebSocket connection failed: ', ws_url);
            this.events.trigger('kernel_connection_failed.Kernel', { kernel: this, ws_url: ws_url, attempt: this._reconnect_attempt });
        }
        this._schedule_reconnect();
    }

    protected _schedule_reconnect(): void {
        /**
         * function to call when kernel connection is lost
         * schedules reconnect, or fires 'connection_dead' if reconnect limit is hit
         */
        if (this._reconnect_attempt < this.reconnect_limit) {
            var timeout = Math.pow(2, this._reconnect_attempt);
            console.log("Connection lost, reconnecting in " + timeout + " seconds.");
            setTimeout($.proxy(this.reconnect, this), 1e3 * timeout);
        } else {
            this.events.trigger('kernel_connection_dead.Kernel', {
                kernel: this,
                reconnect_attempt: this._reconnect_attempt,
            });
            console.log("Failed to reconnect, giving up.");
        }
    }

    stop_channels(): void {
        /**
         * Close the websocket. After successful close, the value
         * in `this.ws` will be null.
         *
         * @function stop_channels
         */
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

    is_connected(): boolean {
        /**
         * Check whether there is a connection to the kernel. This
         * function only returns true if websocket has been
         * created and has a state of WebSocket.OPEN.
         *
         * @function is_connected
         * @returns {bool} - whether there is a connection
         */
        // if any channel is not ready, then we're not connected
        if (this.ws === null) {
            return false;
        }
        if (this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        return true;
    }

    is_fully_disconnected(): boolean {
        /**
         * Check whether the connection to the kernel has been completely
         * severed. This function only returns true if all channel objects
         * are null.
         *
         * @function is_fully_disconnected
         * @returns {bool} - whether the kernel is fully disconnected
         */
        return (this.ws === null);
    }

    send_shell_message(msg_type: string, content: IContent, callbacks: IKernelCallbacks, metadata: IMetadata = {}, buffers: string[] = []): string {
        /**
         * Send a message on the Kernel's shell channel
         *
         * @function send_shell_message
         */
        if (!this.is_connected()) {
            throw new Error("kernel is not connected");
        }
        var msg = this._get_msg(msg_type, content, metadata, buffers);
        msg.channel = 'shell';
        this.ws.send(serialize.serialize(msg));
        this.set_callbacks_for_msg(msg.header.msg_id, callbacks);
        return msg.header.msg_id;
    }

    kernel_info(callback?: Function): string {
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
        var callbacks: IKernelShellCallbacks;
        if (callback) {
            callbacks = { shell: { reply: callback } };
        }
        return this.send_shell_message("kernel_info_request", {}, callbacks);
    }

    inspect(code: string, cursor_pos: number, callback: Function): string {
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
        var callbacks: IKernelShellCallbacks;
        if (callback) {
            callbacks = { shell: { reply: callback } };
        }

        var content = {
            code: code,
            cursor_pos: cursor_pos,
            detail_level: 0
        };
        return this.send_shell_message("inspect_request", content, callbacks);
    }

    execute(code: string, callbacks: IKernelCallbacks, options: IKernelOptions): string {
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
        var content = {
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
        $.extend(true, content, options);
        this.events.trigger('execution_request.Kernel', { kernel: this, content: content });
        return this.send_shell_message("execute_request", content, callbacks);
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
        var callbacks: IKernelCallbacks;
        if (callback) {
            callbacks = { shell: { reply: callback } };
        }
        var content = {
            code: code,
            cursor_pos: cursor_pos
        };
        return this.send_shell_message("complete_request", content, callbacks);
    }

    /**
     * @function send_input_reply
     */
    send_input_reply(input: IKernelInput): string {
        if (!this.is_connected()) {
            throw new Error("kernel is not connected");
        }
        var content = {
            value: input
        };
        this.events.trigger('input_reply.Kernel', { kernel: this, content: content });
        var msg = this._get_msg("input_reply", content);
        msg.channel = 'stdin';
        this.ws.send(serialize.serialize(msg));
        return msg.header.msg_id;
    }

    /**
     * @function register_iopub_handler
     */
    register_iopub_handler(msg_type: string, callback: Function): void {
        this._iopub_handlers[msg_type] = callback;
    }

    /**
     * Get the iopub handler for a specific message type.
     *
     * @function get_iopub_handler
     */
    get_iopub_handler(msg_type: string): any {
        return this._iopub_handlers[msg_type];
    }

    /**
     * Get callbacks for a specific message.
     *
     * @function get_callbacks_for_msg
     */
    get_callbacks_for_msg(msg_id: string): any {
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
    clear_callbacks_for_msg(msg_id: string): void {
        if (this._msg_callbacks[msg_id] !== undefined) {
            delete this._msg_callbacks[msg_id];
        }
    }
    
    /**
     * @function _finish_shell
     */
    protected _finish_shell(msg_id: string): void {
        var callbacks = this._msg_callbacks[msg_id];
        if (callbacks !== undefined) {
            callbacks.shell_done = true;
            if (callbacks.iopub_done) {
                this.clear_callbacks_for_msg(msg_id);
            }
        }
    }

    /**
     * @function _finish_iopub
     */
    protected _finish_iopub(msg_id: string): void {
        var callbacks = this._msg_callbacks[msg_id];
        if (callbacks !== undefined) {
            callbacks.iopub_done = true;
            if (callbacks.shell_done) {
                this.clear_callbacks_for_msg(msg_id);
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
    set_callbacks_for_msg(msg_id: string, callbacks: IKernelCallbacks): void {
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

    protected _handle_ws_message(e: IKernelEvent): Promise<any> {
        this._msg_queue = this._msg_queue.then(() => {
            return serialize.deserialize(e.data);
        }).then(function(msg) { return this._finish_ws_message(msg); })
            .catch(utils.reject("Couldn't process kernel message", true));
        return;
    }

    protected _finish_ws_message(msg: IKernelMessage): Promise<any> {
        switch (msg.channel) {
            case 'shell':
                return this._handle_shell_reply(msg);
                break;
            case 'iopub':
                this._handle_iopub_message(msg);
                break;
            case 'stdin':
                this._handle_input_request(msg);
                break;
            default:
                console.error("unrecognized message channel", msg.channel, msg);
        }
        return Promise.resolve();
    }

    protected _handle_shell_reply(reply: IKernelMessage): Promise<any> {
        this.events.trigger('shell_reply.Kernel', { kernel: this, reply: reply });
        var content = reply.content;
        var metadata = reply.metadata;
        var parent_id = reply.parent_header.msg_id;
        var callbacks = this.get_callbacks_for_msg(parent_id);
        var promise = Promise.resolve();
        if (!callbacks || !callbacks.shell) {
            return promise;
        }
        var shell_callbacks = callbacks.shell;
        
        // signal that shell callbacks are done
        this._finish_shell(parent_id);

        if (shell_callbacks.reply !== undefined) {
            promise = promise.then(function() { return shell_callbacks.reply(reply) });
        }
        if (content.payload && shell_callbacks.payload) {
            promise = promise.then(() => {
                return this._handle_payload(content.payload, shell_callbacks.payload, reply);
            });
        }
        return promise;
    }

    /**
     * @function _handle_payloads
     */
    protected _handle_payload(payloads: IPayload[],
        payload_callbacks: IPayloadCallbacks,
        msg: IKernelMessage): Promise<any> {
        var promise: IKernelCallbacks[] = [];
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
    protected _handle_status_message(msg: IKernelMessage): void {
        var execution_state = msg.content.execution_state;
        var parent_id = msg.parent_header.msg_id;
        
        // dispatch status msg callbacks, if any
        var callbacks = this.get_callbacks_for_msg(parent_id);
        if (callbacks && callbacks.iopub && callbacks.iopub.status) {
            try {
                callbacks.iopub.status(msg);
            } catch (e) {
                console.log("Exception in status msg handler", e, e.stack);
            }
        }

        if (execution_state === 'busy') {
            this.events.trigger('kernel_busy.Kernel', { kernel: this });

        } else if (execution_state === 'idle') {
            // signal that iopub callbacks are (probably) done
            // async output may still arrive,
            // but only for the most recent request
            this._finish_iopub(parent_id);
            
            // trigger status_idle event
            this.events.trigger('kernel_idle.Kernel', { kernel: this });

        } else if (execution_state === 'starting') {
            this.events.trigger('kernel_starting.Kernel', { kernel: this });
            this.kernel_info((reply: IKernelMessage) => {
                this.info_reply = reply.content;
                this.events.trigger('kernel_ready.Kernel', { kernel: this });
            });

        } else if (execution_state === 'restarting') {
            // autorestarting is distinct from restarting,
            // in that it means the kernel died and the server is restarting it.
            // kernel_restarting sets the notification widget,
            // autorestart shows the more prominent dialog.
            this._autorestart_attempt = this._autorestart_attempt + 1;
            this.events.trigger('kernel_restarting.Kernel', { kernel: this });
            this.events.trigger('kernel_autorestarting.Kernel', { kernel: this, attempt: this._autorestart_attempt });

        } else if (execution_state === 'dead') {
            this.events.trigger('kernel_dead.Kernel', { kernel: this });
            this._kernel_dead();
        }
    }
    
    /**
     * Handle clear_output message
     *
     * @function _handle_clear_output
     */
    protected _handle_clear_output(msg: IKernelMessage): void {
        var callbacks = this.get_callbacks_for_msg(msg.parent_header.msg_id);
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
    private _handle_output_message(msg: IKernelMessage): void {
        var callbacks = this.get_callbacks_for_msg(msg.parent_header.msg_id);
        if (!callbacks || !callbacks.iopub) {
            // The message came from another client. Let the UI decide what to
            // do with it.
            this.events.trigger('received_unsolicited_message.Kernel', msg);
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
    protected _handle_input_message(msg: IKernelMessage): void {
        var callbacks = this.get_callbacks_for_msg(msg.parent_header.msg_id);
        if (!callbacks) {
            // The message came from another client. Let the UI decide what to
            // do with it.
            this.events.trigger('received_unsolicited_message.Kernel', msg);
        }
    }

    /**
     * Dispatch IOPub messages to respective handlers. Each message
     * type should have a handler.
     *
     * @function _handle_iopub_message
     */
    protected _handle_iopub_message(msg: IKernelMessage): void {
        var handler = this.get_iopub_handler(msg.header.msg_type);
        if (handler !== undefined) {
            handler(msg);
        }
    }

    /**
     * @function _handle_input_request
     */
    protected _handle_input_request(request: IKernelMessage): void {
        var header = request.header;
        var content = request.content;
        var metadata = request.metadata;
        var msg_type = header.msg_type;
        if (msg_type !== 'input_request') {
            console.log("Invalid input request!", request);
            return;
        }
        var callbacks = this.get_callbacks_for_msg(request.parent_header.msg_id);
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
