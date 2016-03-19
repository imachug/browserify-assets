var path = require('path')
var test = require('tap').test
var browserifyAssets = require('../')
var fs = require('fs')
var exec = require('child_process').exec;

var outputDir = path.resolve(__dirname,'../example/output')

test("it runs twice", function (t) {
  function build(done) {
    var opts = {cacheFile: path.join(outputDir, '/cache.json')}
    var b = browserifyAssets(opts)
    b.on('log', function(msg){ t.ok(msg, 'log') })
    b.on('update', function(updated) { t.ok(updated, 'update') })
    b.add(path.resolve(__dirname, '../example/test-module'))

    b.on('allBundlesComplete', done)

    b.on('assetStream', function(assetStream) {
      var cssFileStream = fs.createWriteStream(path.join(outputDir, '/bundle.css'))
      assetStream.pipe(cssFileStream)
    })

    var bundleStream = b.bundle()
    var jsFileStream = fs.createWriteStream(path.join(outputDir, '/bundle.js'))
    bundleStream.pipe(jsFileStream)
  }

  t.plan(3)

  exec('rm -rfv ' + outputDir, function() {
    exec('mkdir -p ' + outputDir, function(err) {
      t.notOk(err, 'dir created');

      build(function(){
        build(function(){
          t.end()
        })
      })
    });
  });
})