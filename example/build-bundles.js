if (process.argv[2] == 'reset') try { require('fs').unlinkSync(__dirname+'/output/cache.json') } catch (e) {console.error(e)}
console.time('total')
console.time('startup')
var browserifyAssets = require('../');
var fs = require('fs');

console.timeEnd('startup')
var counter = 10;
var testTimeout = 1000;
var cache = true;

console.time('cache fill')
if (cache) {
  var opts = {cacheFile: __dirname+'/output/cache.json'}
} else {
  var opts = {}
}
var b = browserifyAssets(opts)
console.timeEnd('cache fill')
b.on('log', function(msg){ console.log(msg) })
b.on('update', function(updated) { console.log('changed files:\n'+updated.join('\n')) })
b.add(__dirname + '/test-module')

process.on('exit', function () { console.timeEnd('total') })

run() // start test

function run() {
  b.on('assetStream', function(assetStream) {
    console.time('assets')
    var cssFileStream = fs.createWriteStream(__dirname+'/output/bundle.css')
    cssFileStream.on('finish', function(){ 
      console.timeEnd('assets') 
    })
    assetStream.pipe(cssFileStream)
  })

  var bundleStream = b.bundle()
    console.time('bundle')
    var jsFileStream = fs.createWriteStream(__dirname+'/output/bundle.js')
    jsFileStream.on('finish', function(){
      console.timeEnd('bundle')
    })
    bundleStream.pipe(jsFileStream)
}

