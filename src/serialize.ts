// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.


"use strict";

import _ = require("underscore");


interface IKernelDataType extends String {
    buffers?: ArrayBuffer[];
}


function _deserialize_array_buffer(buf: ArrayBuffer): IKernelDataType {
    var data = new DataView(buf);
    // read the header: 1 + nbufs 32b integers
    var nbufs = data.getUint32(0);
    var offsets: number[] = [];
    var i: number;
    for (i = 1; i <= nbufs; i++) {
        offsets.push(data.getUint32(i * 4));
    }
    var json_bytes = new Uint8Array(buf.slice(offsets[0], offsets[1]));
    var msg = JSON.parse(
        (new TextDecoder('utf8')).decode(json_bytes)
    );
    // the remaining chunks are stored as DataViews in msg.buffers
    msg.buffers = [];
    var start: number, stop: number;
    for (i = 1; i < nbufs; i++) {
        start = offsets[i];
        stop = offsets[i+1] || buf.byteLength;
        msg.buffers.push(new DataView(buf.slice(start, stop)));
    }
    return msg;
};
    

function _deserialize_binary(data: Blob | ArrayBuffer): IKernelDataType | Promise<IKernelDataType> {
    /**
     * deserialize the binary message format
     * callback will be called with a message whose buffers attribute
     * will be an array of DataViews.
     */
    if (data instanceof Blob) {
        // data is Blob, have to deserialize from ArrayBuffer in reader callback
        var reader = new FileReader();
        var promise = new Promise(function(resolve, reject) {
            reader.onload = function () {
                var msg = _deserialize_array_buffer((<ArrayBuffer>this.result));
                resolve(msg);
            };
        });
        reader.readAsArrayBuffer(data);
        return promise;
    } else {
        // data is ArrayBuffer, can deserialize directly
        var msg = _deserialize_array_buffer((<ArrayBuffer>data));
        return msg;
    }
};


export
    function deserialize(data: Blob | ArrayBuffer | string): Promise<IKernelDataType> {
    /**
     * deserialize a message and return a promise for the unpacked message
     */
    if (typeof data === "string") {
        // text JSON message
        return Promise.resolve(JSON.parse(data));
    } else {
        // binary message
        return Promise.resolve(_deserialize_binary(data));
    }
};


function _serialize_binary(msg: IKernelDataType) : ArrayBuffer {
    /**
     * implement the binary serialization protocol
     * serializes JSON message to ArrayBuffer
     */
    msg = _.clone(msg);
    var offsets: number[] = [];
    var buffers: ArrayBuffer[] = [];
    var i: number;
    for (i = 0; i < msg.buffers.length; i++) {
        // msg.buffers elements could be either views or ArrayBuffers
        // buffers elements are ArrayBuffers
        var b: any = msg.buffers[i];
        buffers.push(b instanceof ArrayBuffer ? b : b.buffer);
    }
    delete msg.buffers;
    var json_utf8 = (new TextEncoder('utf8')).encode(JSON.stringify(msg));
    buffers.unshift(Array.prototype.slice.call(json_utf8));
    var nbufs = buffers.length;
    offsets.push(4 * (nbufs + 1));
    for (i = 0; i + 1 < buffers.length; i++) {
        offsets.push(offsets[offsets.length-1] + buffers[i].byteLength);
    }
    var msg_buf = new Uint8Array(
        offsets[offsets.length-1] + buffers[buffers.length-1].byteLength
    );
    // use DataView.setUint32 for network byte-order
    var view = new DataView(msg_buf.buffer);
    // write nbufs to first 4 bytes
    view.setUint32(0, nbufs);
    // write offsets to next 4 * nbufs bytes
    for (i = 0; i < offsets.length; i++) {
        view.setUint32(4 * (i+1), offsets[i]);
    }
    // write all the buffers at their respective offsets
    for (i = 0; i < buffers.length; i++) {
        msg_buf.set(new Uint8Array(buffers[i]), offsets[i]);
    }
    
    // return raw ArrayBuffer
    return msg_buf.buffer;
};


export
function serialize(msg: IKernelDataType): string | ArrayBuffer {
    if (msg.buffers && msg.buffers.length) {
        return _serialize_binary(msg);
    } else {
        return JSON.stringify(msg);
    }
};
