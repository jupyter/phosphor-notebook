// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import utils = require('./utils');
import kernel = require('./kernel');


export interface Data { };
export interface Callbacks { (): void };
export interface Metadata { };


interface IContent {
    comm_id: string;
    target_name: string;
    target_module: string;
};


export interface Msg {
    content: IContent;
};


export interface TargetName extends String { };


export class CommManager {

    comms: { [id: string]: Promise<Comm> };
    targets: { [string: string]: Function; };
    kernel: kernel.Kernel;

    //-----------------------------------------------------------------------
    // CommManager class
    //-----------------------------------------------------------------------
    
    constructor(kernel: kernel.Kernel) {
        this.comms = {};
        this.targets = {};
        if (kernel !== undefined) {
            this.init_kernel(kernel);
        };
    }

    init_kernel(kernel: kernel.Kernel) {
        /**
         * connect the kernel, and register message handlers
         */
        this.kernel = kernel;
        kernel.registerIOPubHandler('comm_open', 
                                      (msg: Msg) => this._commOpen(msg));
        kernel.registerIOPubHandler('comm_close', 
                                      (msg: Msg) => this._commClose(msg));
        kernel.registerIOPubHandler('comm_msg', 
                                      (msg: Msg) => this._commMsg(msg));
    }

    newComm(target_name: string, data: Data, callbacks: Callbacks, metadata: Metadata): Comm {
        /**
         * Create a new Comm, register it, and open its Kernel-side counterpart
         * Mimics the auto-registration in `Comm.__init__` in the Jupyter Comm
         */
        var comm = new Comm(target_name);
        this.registerComm(comm);
        comm.open(data, callbacks, metadata);
        return comm;
    }

    registerTarget(target_name: TargetName, f: Function): void {
        /**
         * Register a target function for a given target name
         */
        this.targets[<string>target_name] = f;
    }

    unregisterTarget(target_name: TargetName, f: Function) {
        /**
         * Unregister a target function for a given target name
         */
        delete this.targets[<string>target_name];
    }

    registerComm(comm: Comm) {
        /**
         * Register a comm in the mapping
         */
        this.comms[<string>comm.comm_id] = (Promise.resolve(comm));
        comm.kernel = this.kernel;
        return comm.comm_id;
    }

    unregisterComm(comm: Comm): void {
        /**
         * Remove a comm from the mapping
         */
        delete this.comms[<string>comm.comm_id];
    }
    
    // comm message handlers
    
    private _commOpen(msg: Msg): Promise<Comm> {
        var content = msg.content;
        var that = this;
        var comm_id = content.comm_id;

        this.comms[comm_id] = utils.loadClass(content.target_name, content.target_module,
            this.targets).then(function(target: (a: any, b: any) => Promise<any>) {
                var comm = new Comm(content.target_name, comm_id);
                comm.kernel = that.kernel;
                try {
                    var response = target(comm, msg);
                } catch (e) {
                    comm.close();
                    that.unregisterComm(comm);
                    var wrapped_error = new utils.WrappedError("Exception opening new comm", e);
                    console.error(wrapped_error);
                    return Promise.reject(wrapped_error);
                }
                // Regardless of the target return value, we need to
                // then return the comm
                return Promise.resolve(response).then(function() { return comm; });
            }, utils.reject('Could not open comm', true));
        return this.comms[comm_id];
    }

    private _commClose(msg: Msg): Promise<void> {
        var content = msg.content;
        if (this.comms[content.comm_id] === undefined) {
            console.error('Comm promise not found for comm id ' + content.comm_id);
            return;
        }
        this.comms[content.comm_id].then((comm) => {
            this.unregisterComm(comm);
            try {
                comm.handleClose(msg);
            } catch (e) {
                console.log("Exception closing comm: ", e, e.stack, msg);
            }
            // don't return a comm, so that further .then() functions
            // get an undefined comm input
        });
        delete this.comms[content.comm_id];
        return Promise.resolve(undefined);
    }

    private _commMsg(msg: Msg) {
        var content = msg.content;
        if (this.comms[content.comm_id] === undefined) {
            console.error('Comm promise not found for comm id ' + content.comm_id);
            return;
        }

        this.comms[content.comm_id] = this.comms[content.comm_id].then(function(comm) {
            try {
                comm.handleMsg(msg);
            } catch (e) {
                console.log("Exception handling comm msg: ", e, e.stack, msg);
            }
            return comm;
        });
        return this.comms[content.comm_id];
    }
    
    //-----------------------------------------------------------------------
    // Comm base class
    //-----------------------------------------------------------------------
}

export interface CommID extends String { }

export class Comm {

    kernel: kernel.Kernel;
    target_name: string;
    comm_id: CommID;

    constructor(target_name: string, comm_id?: CommID) {
        this.target_name = target_name;
        this.comm_id = comm_id || <CommID>utils.uuid();
        this._msg_callback = null;
        this._close_callback = null;
    }
    
    // methods for sending messages
    open(data: Data, callbacks: Callbacks, metadata: Metadata) {
        var content = {
            comm_id: this.comm_id,
            target_name: this.target_name,
            data: data || {},
        };
        return this.kernel.sendShellMessage("comm_open", content, callbacks, metadata);
    }

    send(data: Data, callbacks: Callbacks, metadata: Metadata, buffers: string[] = []) {
        var content = {
            comm_id: this.comm_id,
            data: data || {},
        };
        return this.kernel.sendShellMessage("comm_msg", content, callbacks, metadata, buffers);
    }

    close(data?: Data, callbacks?: Callbacks, metadata?: Metadata) {
        var content = {
            comm_id: this.comm_id,
            data: data || {},
        };
        return this.kernel.sendShellMessage("comm_close", content, callbacks, metadata);
    }

    onMsg(callback: Callbacks) {
        this._msg_callback = callback;
    }

    onClose(callback: Callbacks) {
        this._close_callback = callback;
    }
    
    // methods for handling incoming messages
    
    private _callback(callback: Function, msg: Msg) {
        try {
            callback(msg);
        } catch (e) {
            console.log("Exception in Comm callback", e, e.stack, msg);
        }
    }

    handleMsg(msg: Msg) {
        this._callback(this._msg_callback, msg);
    }

    handleClose(msg: Msg) {
        this._callback(this._close_callback, msg);
    }

    private _msg_callback: (msg: Msg) => void;
    private _close_callback: (msg: Msg) => void;

}
