#!/usr/bin/env node

var browserifyAssets = require('../');
var through = require('through');
var fs = require('fs');
var path = require('path');
var fromArgs = require('browserify/bin/args');

var b, outfile, verbose, cachefile;

var b_ = fromArgs(process.argv.slice(2))
cachefile = b_.argv.cachefile || './browserify-cache.json'
outfile = b_.argv.o || b_.argv.outfile;
verbose = b_.argv.v || b_.argv.verbose;
b = browserifyAssets(b_, {cacheFile: cachefile});

if (!outfile) {
    console.error('You MUST specify an outfile with -o.');
    process.exit(1);
}

b.on('update', function(changes) { 
    if (verbose && changes.length) console.error('changed files:\n'+changes.join('\n'));
});
b.on('error', function (err) {
    console.error(err);
});
bundle();

function bundle () {
    var bb = b.bundle();
    var caught = false;
    bb.on('error', function (err) {
        console.error(err);
        caught = true;
    });
    bb.pipe(fs.createWriteStream(outfile));
    var bytes, time;
    b.on('bytes', function (b) { bytes = b });
    b.on('time', function (t) { time = t });
    
    bb.on('end', function () {
        if (caught) return;
        if (verbose) {
            console.error(bytes + ' bytes written to ' + outfile
                + ' (' + (time / 1000).toFixed(2) + ' seconds)'
            );
        }
    });
}