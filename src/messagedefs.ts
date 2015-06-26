// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.


export
    interface IMsgPayload {
    source: string;
};


export
    interface IMsgPayloadCallbacks {
    [s: string]: (payload: IMsgPayload, msg: IKernelMsg) => IKernelCallbacks;
};


export
    interface IMsgContent {
    payload?: IMsgPayload[];
    execution_state?: string;
    comm_id?: string;
    target_name?: string;
    target_module?: string;
    value?: any;
    allow_stdin?: boolean;
};


export
    interface IMsgMetadata { };


export
    interface IKernelInput { };


interface IKernelInfo {
    kernel: { id: string };
};


export
    interface IMsgData {
    id: string;
    name: string;
};


export
    interface IMsgHeader {
    username?: string;
    version?: string;
    data?: string;
    session?: string;
    msg_id?: string;
    msg_type?: string;
};


export
    interface IMsgParentHeader {
    msg_id?: string;
    version?: string;
    session?: string;
    msg_type?: string;
};


export
    interface IKernelMsg {
    metadata?: IMsgMetadata;
    content: IMsgContent;
    msg_id?: string;
    parent_header: IMsgParentHeader;
    header: IMsgHeader;
    msg_type?: string;
    channel?: string;
    buffers?: string[]| ArrayBuffer[];
};


export
    interface IMsgSuccess {
    data: IMsgData;
    status: string;
    xhr: XMLHttpRequest;
};


export
    interface IKernelShellCallbacks {
    reply?: Function;
    payload?: any;
};


export
    interface IKernelIOPubCallbacks {
    output?: Function;
    clear_output?: Function;
};


export
    interface IKernelCallbacks {
    // @param callbacks.shell.payload.[payload_name] {function}
    shell?: IKernelShellCallbacks;
    iopub?: IKernelIOPubCallbacks;
    input?: Function;
};


export
    interface IKernelOptions {
    silent?: boolean;
    user_expressions?: any;
    allow_stdin?: boolean;
};


export
    interface IKernelEvent extends Event {
    wasClean?: boolean;
    data?: string | ArrayBuffer | Blob;
};
