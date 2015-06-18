Phosphor notebook
=================

Installation
------------

```bash
git clone https://github.com/jasongrout/phosphor-notebook.git
cd phosphor-notebook
npm install
bower install
tsd reinstall -so
gulp
```

Running
-------

Run a static webserver in the root directory of the repo and go to `http://localhost:8080`.

### Python

```bash
python -m SimpleHTTPServer 8080
```

### Node

Install http-server (`npm install -g http-server`), and then do

```bash
http-server
```
