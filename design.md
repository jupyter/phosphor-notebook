Design notes
============

Here are some ideas for a design that emphasize:

* State consolidated into one place.  This makes it easier in the future to move some of the state logic to the server side to support collaborative editing.  It also makes the application much easier to reason about.
* Separation of the execution from the document.  We want to make it easy to reuse the js code for kernels without having a notebook object, and vice versa.


Parts of the application
------------------------

### Session
Responsible for complete notebook/kernel state

* Starts and stops a kernel, keeps a handle to the kernel
* Creates a notebook state object, keeps a handle to it
* Executes a cell by pulling the code from the notebook state, sending a message using the kernel, and registering a callback to be used to interpret the reply messages as changes to the notebook state


### Notebook State
Responsible for the persistent notebook state

* Keeps track of the notebook state (cell contents, cursor position, etc.)
* Can serialize/unserialize the notebook state
* (in future) can sync notebook state to support collaboration
* triggers re-render when state changes (e.g., an output cell changes)

Perhaps the notebook also keeps the ephemeral state (like cursor position, widget model state, etc.).  Or perhaps there should be some way for other components to register ephemeral state, so a separate (swappable) widget manager manages the widget model state.


### Kernel
Manages interaction with a live kernel
* Maintains the websocket connection to a kernel on the server
* Sends messages, and calls related callbacks when messages are received
* (maybe in future) provides a promise interface for single send/reply message pairs (you send a message, and the promise resolves with the reply.


### Widgets
A comm_open message goes to the comm manager, which opens a comm and passes it to the widget manager.

A view is encoded as a displaydata message, referencing a model state.  If it has a UUID reference, there will be constant churn (which is bad), but maybe there is a way to have the view associated with a model without constant churn.


### DisplayData
Rendering components can register handlers for mimebundles.  Widgets would register a view renderer, for example.


Actions
-------
### Executing a cell

1. the key handler is pressed, or the button is pressed
2. somehow the message gets sent to the session object
3. the session object retrieves the code from the notebook state (must make sure at least that cell is updated to the most recent version of the text) and sends it in an execute_request message using the kernel.  The session registers callbacks with the kernel for the messages associated with the execute request.
4. Either the session or the notebook state object interpret the messages into the notebook format, modifying the notebook
5. As the notebook is changed, it triggers re-renders

