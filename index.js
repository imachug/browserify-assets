var fs = require('fs');
var path = require('path');
var util = require('util');
var assert = require('assert');

var through = require('through');
var async = require('async');
var browserify = require('browserify');
var concatStream = require('concat-stream');
var glob = require('glob');
var combineStreams = require('stream-combiner');
var browserifyCache = require('browserify-cache-api');

module.exports = browserifyAssets;
browserifyAssets.browserify = browserify;

var PENDING = 'PENDING';
var STARTED = 'STARTED';
var COMPLETE = 'COMPLETE';

function browserifyAssets(files, opts) {
  // browserify plugin boilerplate
  // normalises variable arguments
  var b;
  if (!opts) {
    opts = files || {};
    files = undefined;
    b = typeof opts.bundle === 'function' ? opts : browserify(opts);
  } else {
    b = typeof files.bundle === 'function' ? files : browserify(files, opts);
  }

  browserifyCache(b, opts);

  // override the .bundle() method
  var bundle = b.bundle.bind(b);
  b.bundle = function (opts_, cb) {
    // more browserify plugin boilerplate
    if (b._pending) return bundle(opts_, cb);

    if (typeof opts_ === 'function') {
      cb = opts_;
      opts_ = {};
    }
    if (!opts_) opts_ = {};

    var packagesAssetsBuilds = {};
    var bundleComplete = false;

    var assetStream = through();

    b.emit('assetStream', assetStream);

    function cleanupWhenAssetBundleComplete() {
      if (bundleComplete && areAllPackagesAssetsComplete(packagesAssetsBuilds)) {
        assetStream.end();

        b.removeListener('cacheObjectsPackage', buildAssetsForPackage);
        b.removeListener('file', buildAssetsForFile);
      }
    }

    function assetComplete(err, pkgpath) {
      if (err) assetStream.emit('error', err, pkgpath);
      packagesAssetsBuilds[pkgpath] = COMPLETE;

      cleanupWhenAssetBundleComplete();
    }

    function buildAssetsForFile(file) {
      guard(file, 'file');
      var co = browserifyCache.getCacheObjects(b);
      var pkgpath = co.filesPackagePaths[file];
      if (pkgpath) buildAssetsForPackage(pkgpath);
      // else console.warn('waiting for',file)
    }

    function buildAssetsForPackage(pkgpath) {
      guard(pkgpath, 'pkgpath');
      var co = browserifyCache.getCacheObjects(b);
      var status = packagesAssetsBuilds[pkgpath];
      if (status && status !== PENDING) return;

      packagesAssetsBuilds[pkgpath] = STARTED;

      buildPackageAssetsAndWriteToStream(co.packages[pkgpath], assetStream, function(err) {
        assetComplete(err, pkgpath);
      });
    }

    b.on('cacheObjectsPackage', buildAssetsForPackage);
    b.on('file', buildAssetsForFile);

    var outStream = bundle(opts_, cb);

    var start = Date.now();
    var bytes = 0;
    outStream.pipe(through(function (buf) { bytes += buf.length }));
    outStream.on('end', end);

    function end () {
      // no more packages to be required
      bundleComplete = true;
      cleanupWhenAssetBundleComplete();

      var delta = ((Date.now() - start) / 1000).toFixed(2);
      b.emit('log', bytes + ' bytes written (' + delta + ' seconds)');
      b.emit('time', Date.now() - start);
      b.emit('bytes', bytes);

    }
    return outStream;
  };

  return b;
}

// asset building

function buildPackageAssetsAndWriteToStream(pkg, assetStream, packageDone) {
  guard(pkg, 'pkg'), guard(assetStream, 'assetStream'), guard(packageDone, 'packageDone');

  if (!pkg.__dirname) return packageDone();

  try {
    var transformStreamForFile = streamFactoryForPackage(pkg);
  } catch (err) {
    return packageDone(err);
  }

  var assetGlobs = [].concat(pkg.style || []);
  async.each(assetGlobs, function(assetGlob, assetGlobDone) {
    glob(path.join(pkg.__dirname, assetGlob), function(err, assetFilePaths) {
      if (err) return assetGlobDone(err);

      async.each((assetFilePaths || []), function(assetFilePath, assetDone) {
        fs.createReadStream(assetFilePath, {encoding: 'utf8'})
          .on('error', assetDone)
          .pipe(transformStreamForFile(assetFilePath))
          .on('error', assetDone)
          .pipe(streamAccumlator(assetStream, assetDone));
      }, assetGlobDone);
    });
  }, packageDone);
}

function streamAccumlator(outputStream, done) {
  return concatStream(function (accumulated) {
    outputStream.write(accumulated);
    done();
  });
}

function streamFactoryForPackage(pkg) {
  guard(pkg, 'pkg');
  var transforms = (pkg.transforms || []).map(function(tr){
    return findTransform(tr, pkg);
  });

  return function(file) {
    guard(file, 'file');
    return combineStreams(transforms.map(function(transform) {
      return transform(file)
    }));
  };
}

function findTransform(transform, pkg) {
  if (typeof transform === 'function') return transform;

  try {
    return require(transform)
  } catch (err) {
    try {
      var rebasedPath
      if (isLocalPath(transform)) rebasedPath = path.resolve(pkg.__dirname, transform)
      else rebasedPath = path.join(pkg.__dirname, 'node_modules', transform)
      return require(rebasedPath)
    } catch (err) {
      throw new Error("couldn't resolve transform "+transform+" while processing package "+pkg.__dirname)
    }
  }
}

function areAllPackagesAssetsComplete(packagesAssetsBuilds) {
  var numPending = values(packagesAssetsBuilds).filter(function(status) {
    return status !== COMPLETE
  }).length;
  return numPending === 0;
}

// util

function values(obj) {
  return Object.keys(obj).map(function(key) { return obj[key]; });
}

function guard(value, name) {
  assert(value, 'missing '+name);
}

function isLocalPath(filepath) {
  var charAt0 = filepath.charAt(0)
  return charAt0 === '.' || charAt0 === '/'
}
