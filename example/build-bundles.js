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
  console.time('bundle')
  b.on('assetStream', function(assetStream) {
    console.time('assetStream')
    assetStream.pipe(fs.createWriteStream(__dirname+'/output/bundle.css'))
    assetStream.on('end', function(){ 
      console.timeEnd('assetStream') 
    })
  })
  b.bundle()
    .on('end', function(){ console.timeEnd('bundle') })
    .pipe(fs.createWriteStream(__dirname+'/output/bundle.js'))
}
