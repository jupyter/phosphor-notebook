// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import utils = require('./utils')
import kernel = require('./kernel')

import Signal = phosphor.core.Signal;
import emit = phosphor.core.emit;
import IAjaxSuccess = utils.IAjaxSuccess;
import IAjaxError = utils.IAjaxError;


export
interface INotebookModel {
  path: string;
};


export
interface ISessionModel {
  id: string;
  notebook: INotebookModel;
  kernel: kernel.IKernelId;
};


export
interface ISessionOptions {
  notebookPath: string;
  kernelName: string;
  baseUrl: string;
  wsUrl: string;
  notebook: any;
};


/**
 * Session object for accessing the session REST api. The session
 * should be used to start kernels and then shut them down -- for
 * all other operations, the kernel object should be used.
 **/
export 
class Session {

  static statusChanged = new Signal<Session, string>();

  /**
   * GET /api/sessions
   *
   * Get a list of the current sessions.
   *
   */
  static list(sessionServiceUrl: string): Promise<ISessionModel[]> {
    return utils.ajaxRequest(sessionServiceUrl, {
      method: "GET",
      dataType: "json"
    }).then((success: IAjaxSuccess): ISessionModel[] => {
      if (success.xhr.status == 200) {
        if (!Array.isArray(success.data)) {
          throw Error('Invalid Session list');
        }
        for (var i = 0; i < success.data.length(); i++) {
          validateSessionModel(success.data[i]);
        }
        return success.data;
      }
      throw Error('Invalid Status: ' + success.xhr.status);
    });
  }

  constructor(options: ISessionOptions){
    this._notebookModel = {
      path: options.notebookPath
    };
    this._kernelModel = {
      id: null,
      name: options.kernelName
    };

    this._baseUrl = options.baseUrl;
    this._wsUrl = options.wsUrl;
    this._sessionServiceUrl = utils.urlJoinEncode(this._baseUrl, 'api/sessions');

    this._notebook = options.notebook;
  }

  /**
   * Get the session kernel object.
  */
  get kernel() : kernel.Kernel {
    return this._kernel;
  }

  /**
   * POST /api/sessions
   *
   * Start a new session. This function can only executed once.
   *
   */
  start(): Promise<void> {
    return utils.ajaxRequest(this._sessionServiceUrl, {
      method: "POST",
      dataType: "json",
      data: JSON.stringify(this._model),
      contentType: 'application/json'
    }).then((success: IAjaxSuccess) => {
      if (success.xhr.status !== 201) {
        throw Error('Invalid response');
      }
      validateSessionModel(success.data);
      this._updateModel(success.data);
      if (this._kernel) {
        this._kernel.name = this._kernelModel.name;
      } else {
        var kernelServiceUrl = utils.urlPathJoin(this._baseUrl, "api/kernels");
        this._kernel = new kernel.Kernel(kernelServiceUrl, this._wsUrl, this._kernelModel.name);
      }
      this._kernel.start(success.data.kernel);
      this._handleStatus('kernelCreated');
    }, (error: IAjaxError) => {
      this._handleStatus('kernelDead');
    });
  }

  /**
   * GET /api/sessions/[:session_id]
   *
   * Get information about a session.
   *
   */
  getInfo(): Promise<ISessionModel> {
    return utils.ajaxRequest(this._sessionUrl, {
      method: "GET",
      dataType: "json"
    }).then((success: IAjaxSuccess): ISessionModel => {
      if (success.xhr.status !== 200) {
        throw Error('Invalid response');
      }
      validateSessionModel(success.data);
      return success.data;
    });
  }

  /**
   * PATCH /api/sessions/[:session_id]
   *
   * Rename or move a notebook. If the given name or path are
   * undefined, then they will not be changed.
   *
   */
  renameNotebook(path: string): Promise<void> {
    if (path !== undefined) {
    this._notebookModel.path = path;
    }
    return utils.ajaxRequest(this._sessionUrl, {
      method: "PATCH",
      dataType: "json",
      contentType: 'application/json',
      data: JSON.stringify(this._model)
    }).then((success: IAjaxSuccess) => {
      if (success.xhr.status !== 200) {
        throw Error('Invalid response');
      }
      validateSessionModel(success.data);
    });
  }

  /**
   * DELETE /api/sessions/[:session_id]
   *
   * Kill the kernel and shutdown the session.
   *
   */
  delete(): Promise<void> {
    if (this._kernel) {
      this._handleStatus('kernelKilled');
      this._kernel.close();
    }
    return utils.ajaxRequest(this._sessionUrl, {
      method: "DELETE",
      dataType: "json"
    }).then((success: IAjaxSuccess) => {
      if (success.xhr.status !== 204) {
        throw Error('Invalid response');
      }
      validateSessionModel(success.data);
    });
  }

  /**
   * Restart the session by deleting it and the starting it
   * fresh. If options are given, they can include any of the
   * following:
   *
   * - notebook_path - the path to the notebook
   * - kernel_name - the name (type) of the kernel
   *
   * @function restart
   * @param {Object} [options] - options for the new kernel
   */
  restart(options: ISessionOptions): Promise<void> {
    return this.delete().then(this.start).catch(this.start).then(() => {
      if (options && options.notebookPath) {
        this._notebookModel.path = options.notebookPath;
      }
      if (options && options.kernelName) {
        this._kernelModel.name = options.kernelName;
      }
      this._kernelModel.id = null;
    })
  }

  /**
   * Get the data model for the session, which includes the notebook path
   * and kernel (name and id).
   *
   */
  private get _model(): ISessionModel {
    return {
      id: this._id,
      notebook: this._notebookModel,
      kernel: this._kernelModel
    };
  }

  /**
   * Update the data model from the given JSON object, which should
   * have attributes of `id`, `notebook`, and/or `kernel`. If
   * provided, the notebook data must include name and path, and the
   * kernel data must include name and id.
   *
   */
  private _updateModel(data: ISessionModel): void {
    if (data && data.id) {
      this._id = data.id;
      this._sessionUrl = utils.urlJoinEncode(this._sessionServiceUrl, this._id);
    }
    if (data && data.notebook) {
      this._notebookModel.path = data.notebook.path;
    }
    if (data && data.kernel) {
      this._kernelModel.name = data.kernel.name;
      this._kernelModel.id = data.kernel.id;
    }
  }

  /**
   * Handle a Session status change.
   */
  private _handleStatus(status: string) {
    emit(this, Session.statusChanged, status);
    console.log('Session: ' + status + ' (' + this._id + ')');
  }

  private _id = "unknown";
  private _notebookModel: INotebookModel = null;
  private _kernelModel: kernel.IKernelId = null;
  private _baseUrl = "unknown";
  private _wsUrl = "unknown";
  private _sessionServiceUrl = "unknown";
  private _sessionUrl = "unknown";
  private _notebook: any = null;
  private _kernel: kernel.Kernel = null;

}


/**
 * Validate an object as being of ISessionModel type.
 */
function validateSessionModel(info: ISessionModel): void {
  if (!info.hasOwnProperty('id') || !info.hasOwnProperty('notebook') ||
      !info.hasOwnProperty('kernel')) {
    throw Error('Invalid Session Model');
  }
  kernel.validateKernelId(info.kernel);
  if (typeof info.id !== 'string') {
    throw Error('Invalid Session Model');
  }
  validateNotebookModel(info.notebook);
}


/**
 * Validate an object as being of INotebookModel type
 */
function validateNotebookModel(model: INotebookModel): void {
   if ((!model.hasOwnProperty('path')) || (typeof model.path !== 'string')) {
     throw Error('Invalid Notebook Model');
   }
}
