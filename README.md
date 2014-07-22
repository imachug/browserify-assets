# browserify-assets

finds and transforms the assets (stylesheets) in your browserify-based app

![under construction](http://www.oocities.org/graphickid/3d-workl.gif)

### example

```
example/
├── build.js
└── test-module
    ├── index.js
    ├── package.json
    └── style
        └── test.less
```

##### `test-module/package.json`
```json
{
  "name": "test-module",
  "version": "0.0.1",
  "main": "index.js",
  "style" : "style/*.less",
  "transforms" : ["less-css-stream"],
  "dependencies": {
    "less-css-stream": "^0.1.2"
  }
}
```
For each package, specify a `"style"` property with a glob path to find stylesheets.

Specify a `"transforms"` property with an array of transforms to be
applied to assets (eg. to compile [less](http://lesscss.org) to css). Transforms
can be [parcelify transforms](https://www.npmjs.org/browse/keyword/parcelify)
or any function having the same signature a browserify transform. Writing your
own transforms is easy, see the [relevant browserify handbook section](https://github.com/substack/browserify-handbook#writing-your-own)
 for more information.

##### `build.js`
```js
var fs = require('fs');
var browserifyAssets = require('browserify-assets');

// specifying a cacheFile will allow for super fast rebuilds
// even from a cold start (eg. across multiple runs of the executable)
var opts = {cacheFile: __dirname+'/output/cache.json'};

var b = browserifyAssets(opts);
b.on('log', function(msg){ console.log(msg) });
b.on('update', function(updated) { console.log('changed files:\n'+updated.join('\n')) });
b.add(__dirname + '/test-module');

function build() {
  b.on('assetStream', function(assetStream) {
    // output css here
    assetStream.pipe(fs.createWriteStream(__dirname+'/output/bundle.css'));
  });
  // output js here
  b.bundle().pipe(fs.createWriteStream(__dirname+'/output/bundle.js'));
}


build(); // you now have a js bundle and a css bundle

build(); // the second time it's super fast

```
:warning: this module is pretty new, please [file an issue](https://github.com/jsdf/browserify-assets/issues)
if you encounter any problems
