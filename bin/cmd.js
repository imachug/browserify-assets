#!/usr/bin/env node

var browserifyAssets = require('../');
var fs = require('fs');
var path = require('path');
var fromArgs = require('browserify/bin/args');
var xtend = require('xtend');

var b_ = fromArgs(process.argv.slice(2), browserifyAssets.args);
var cachefile = b_.argv.cachefile || './browserify-cache.json';
var bundlename = b_.argv.bundlename;
var outfile = b_.argv.o || b_.argv.outfile || bundlename ? bundlename+'.js' : undefined;
var cssfile = b_.argv.cssfile || bundlename ? bundlename+'.css' : undefined;
var verbose = (b_.argv.v || b_.argv.verbose) && outfile;
var b = browserifyAssets(b_, {cacheFile: cachefile});

b.on('assetStream', function(assetStream) {
  if (cssfile) {
    var cssWriteStream = fs.createWriteStream(cssfile);
    pipeToOutputStream(assetStream, cssWriteStream, cssfile);
  }
});

var jsWriteStream = outfile ? fs.createWriteStream(outfile) : process.stdout;
pipeToOutputStream(b.bundle(), jsWriteStream, outfile);

function pipeToOutputStream(readStream, writeStream, filename) {
  var caught = false;
  readStream.on('error', function (err) {
    console.error('error while writing '+ (filename || 'to stdout')+'\n'+err.toString());
    caught = true;
  });
  writeStream.on('finish', function () {
    if (caught) return;
    if (verbose && filename) {
      console.error('finished writing '+ filename);
    }
  });
  readStream.pipe(writeStream);
}
