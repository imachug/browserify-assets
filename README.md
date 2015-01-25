# browserify-assets

finds and transforms the assets (currently just stylesheets) in your 
browserify-based app

### example
assuming you have a project consisiting of one or more commonjs modules (`app`) and you
want to build js and css bundles from those modules to serve up (`public/bundle.js`, 
`public/bundle.css`):
```
project/
├── app
│   ├── index.js
│   ├── package.json
│   └── style
│       └── test.less
└── public
```

app/package.json
```json
{
  "name": "app",
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

#### building via CLI
```bash
$ browserify-assets -v --bundlename ./public/bundle ./app
> finished writing public/bundle.css
> finished writing public/bundle.js
```

### CLI usage

```bash
browserify-assets --bundlename public/bundle ./app
# outputs public/bundle.js, public/bundle.css
# equivalent
browserify-assets --outfile public/bundle.js --cssfile public/bundle.css ./app
# or
browserify-assets --cssfile public/bundle.css ./app > public/bundle.js
```

#### supported opts
The following options are available in addition to the standard browserify opts:
- `-o` or `--outfile`: the filepath which js will be output to (otherwise js is 
  output to stdout)
- `--cssfile`: the filepath which css will be output to
- `--bundlename`: if you specify **bundlename** (instead of **outfile** and **cssfile**),
  then js will be output to `[bundlename].js` and css will be output to 
  `[bundlename].css`.
- `-v` or `--verbose`: log when finished writing each output file
- `--cachefile`: where the incremental build cache will be stored. Defaults to 
  `browserify-cache.json` in current working directory.

### API usage

```js
var b = browserifyAssets(opts);

// or, provide your own browserify instance
// note: you must include the args:
// { cache: {}, packageCache: {}, fullPaths: true }
// which can be copied from browserifyAssets.args
var b = browserify(xtend(browserifyAssets.args, {
  // your opts
}));
browserifyAssets(b);
```

#### supported opts
The following constructor opts are available in addition to the standard browserify opts:
- `cacheFile`: where the incremental build cache will be stored. If not specified,
  only in-memory caching will be used.

#### example

```js
var fs = require('fs');
var browserifyAssets = require('browserify-assets');

// specifying a cacheFile will allow for super fast rebuilds
// even from a cold start (eg. across multiple runs of the executable)
var opts = {cacheFile: __dirname+'/tmp/cache.json'};

var b = browserifyAssets(opts);

b.add(__dirname + '/app');

function build(done) {
  b.on('allBundlesComplete', done);
  b.on('assetStream', function(assetStream) {
    assetStream.on('error', done);
    // output css here
    assetStream.pipe(fs.createWriteStream(__dirname+'/public/bundle.css'));
  });
  var bundleStream = b.bundle();
  bundleStream.on('error', done);
  // output js here
  bundleStream.pipe(fs.createWriteStream(__dirname+'/public/bundle.js'));
}

build(function(err) {
  if (!err) {
    // you now have a js bundle and a css bundle
  } else {
    console.error(err);
  }
});
```

:warning: this module is pretty new, please [file an issue](https://github.com/jsdf/browserify-assets/issues)
if you encounter any problems
