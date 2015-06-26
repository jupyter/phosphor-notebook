// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import utils = require('./utils');
import kernel = require('./kernel');

import IMsgData = kernel.IMsgData;
import IKernelMsg = kernel.IKernelMsg;

export 
class CommManager {

  //-----------------------------------------------------------------------
  // CommManager class
  //-----------------------------------------------------------------------
    
  constructor(kernel: kernel.Kernel) {
    this._comms = {};
    this._targets = {};
    if (kernel !== undefined) {
      this._kernel = kernel;
      kernel.registerIOPubHandler('comm_open',
        (msg: IKernelMsg) => this._commOpen(msg));
      kernel.registerIOPubHandler('comm_close',
        (msg: IKernelMsg) => this._commClose(msg));
      kernel.registerIOPubHandler('comm_msg',
        (msg: IKernelMsg) => this._commMsg(msg));
    }
  }

  /**
  * Create a new Comm, register it, and open its Kernel-side counterpart
  * Mimics the auto-registration in `Comm.__init__` in the Jupyter Comm
  */
  newComm(target_name: string, data: IMsgData, callbacks: kernel.IKernelCallbacks, metadata: kernel.IMsgMetadata): Comm {

    var comm = new Comm(target_name);
    this.registerComm(comm);
    comm.open(data, callbacks, metadata);
    return comm;
  }

  /**
   * Register a target function for a given target name
   */
  registerTarget(target_name: string, f: Function): void {
    this._targets[target_name] = f;
  }

  /**
   * Unregister a target function for a given target name
   */
  unregisterTarget(target_name: string, f: Function) {
    delete this._targets[target_name];
  }

  /**
    * Register a comm in the mapping
    */
  registerComm(comm: Comm) {
    this._comms[comm.comm_id] = (Promise.resolve(comm));
    comm.kernel = this._kernel;
    return comm.comm_id;
  }

  /**
   * Remove a comm from the mapping
   */
  unregisterComm(comm: Comm): void {

    delete this._comms[comm.comm_id];
  }
    
  // comm message handlers
    
  private _commOpen(msg: IKernelMsg): Promise<Comm> {
    var content = msg.content;
    var comm_id = content.comm_id;

    this._comms[comm_id] = utils.loadClass(content.target_name, content.target_module,
      this._targets).then(function(target: (a: any, b: any) => Promise<any>) {
        var comm = new Comm(content.target_name, comm_id);
        comm.kernel = this._kernel;
        try {
          var response = target(comm, msg);
        } catch (e) {
          comm.close();
          this.unregisterComm(comm);
          var wrapped_error = new utils.WrappedError("Exception opening new comm", e);
          console.error(wrapped_error);
          return Promise.reject(wrapped_error);
        }
        // Regardless of the target return value, we need to
        // then return the comm
        return Promise.resolve(response).then(function() { return comm; });
      }, utils.reject('Could not open comm', true));
    return this._comms[comm_id];
  }

  private _commClose(msg: IKernelMsg): Promise<void> {
    var content = msg.content;
    if (this._comms[content.comm_id] === undefined) {
      console.error('Comm promise not found for comm id ' + content.comm_id);
      return;
    }
    this._comms[content.comm_id].then((comm) => {
      this.unregisterComm(comm);
      try {
        comm.handleClose(msg);
      } catch (e) {
        console.log("Exception closing comm: ", e, e.stack, msg);
      }
      // don't return a comm, so that further .then() functions
      // get an undefined comm input
    });
    delete this._comms[content.comm_id];
    return Promise.resolve(undefined);
  }

  private _commMsg(msg: IKernelMsg) {
    var content = msg.content;
    if (this._comms[content.comm_id] === undefined) {
      console.error('Comm promise not found for comm id ' + content.comm_id);
      return;
    }

    this._comms[content.comm_id] = this._comms[content.comm_id].then(function(comm) {
      try {
        comm.handleMsg(msg);
      } catch (e) {
        console.log("Exception handling comm msg: ", e, e.stack, msg);
      }
      return comm;
    });
    return this._comms[content.comm_id];
  }
    
  private _kernel: kernel.Kernel;
  private _comms: { [id: string]: Promise<Comm> };
  private _targets: { [string: string]: Function; };
}


//-----------------------------------------------------------------------
// Comm base class
//-----------------------------------------------------------------------
export 
class Comm {

  constructor(target_name: string, comm_id?: string) {
    this._target_name = target_name;
    this._comm_id = comm_id || <string>utils.uuid();
    this._msg_callback = null;
    this._close_callback = null;
  }

  get comm_id(): string {
    return this._comm_id;
  }

  get target_name(): string {
    return this._target_name;
  }

  get kernel(): kernel.Kernel {
    return this._kernel;
  }

  set kernel(k: kernel.Kernel) {
    this._kernel = k;
  }
    
  // methods for sending messages
  open(data: IMsgData, callbacks: kernel.IKernelCallbacks, metadata: kernel.IMsgMetadata) {
    var content = {
      comm_id: this.comm_id,
      target_name: this.target_name,
      data: data || {},
    };
    return this.kernel.sendShellMessage("comm_open", content, callbacks, metadata);
  }

  send(data: IMsgData, callbacks: kernel.IKernelCallbacks, metadata: kernel.IMsgMetadata, buffers: string[] = []) {
    var content: kernel.IMsgContent = {
      comm_id: this.comm_id,
      data: data || {},
    };
    return this.kernel.sendShellMessage("comm_msg", content, callbacks, metadata, buffers);
  }

  close(data?: IMsgData, callbacks?: kernel.IKernelCallbacks, metadata?: kernel.IMsgMetadata) {
    var content: kernel.IMsgContent = {
      comm_id: this.comm_id,
      data: data || {},
    };
    return this.kernel.sendShellMessage("comm_close", content, callbacks, metadata);
  }

  onMsg(callback: (msg: IKernelMsg) => void) {
    this._msg_callback = callback;
  }

  onClose(callback: (msg: IKernelMsg) => void) {
    this._close_callback = callback;
  }
    
  // methods for handling incoming messages

  handleMsg(msg: IKernelMsg) {
    this._callback(this._msg_callback, msg);
  }

  handleClose(msg: IKernelMsg) {
    this._callback(this._close_callback, msg);
  }

  private _callback(callback: Function, msg: IKernelMsg) {
    try {
      callback(msg);
    } catch (e) {
      console.log("Exception in Comm callback", e, e.stack, msg);
    }
  }

  private _msg_callback: (msg: IKernelMsg) => void;
  private _close_callback: (msg: IKernelMsg) => void;
  private _kernel: kernel.Kernel;
  private _target_name: string;
  private _comm_id: string;
}
