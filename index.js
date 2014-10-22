var fs = require('fs');
var path = require('path');
var util = require('util');
var assert = require('assert');

var through = require('through2');
var async = require('async');
var browserify = require('browserify');
var concatStream = require('concat-stream');
var xtend = require('xtend');
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
    b = typeof opts.bundle === 'function' ? opts : browserify(xtend(browserifyCache.args, opts));
  } else {
    b = typeof files.bundle === 'function' ? files : browserify(files, xtend(browserifyCache.args, opts));
  }

  browserifyCache(b, opts);

  // override browserify bundle() method
  var bundle = b.bundle.bind(b);
  b.bundle = function (cb) {
    // more browserify plugin boilerplate
    if (b._pending) return bundle(cb);

    // asset build progress
    var packagesAssetsBuilds = {};
    var bundleComplete = false;

    // provide asset bundle stream to api consumers
    var assetStream = through();
    b.emit('assetStream', assetStream);
    
    b.on('cacheObjectsPackage', buildAssetsForPackage);
    b.on('file', buildAssetsForFile);

    var time = null;
    var bytes = 0;
    b.pipeline.get('record').on('end', function () {
      time = Date.now();
    });
    
    b.pipeline.get('wrap').push(through(write, end));
    function write (buf, enc, next) {
      bytes += buf.length;
      this.push(buf);
      next();
    }
    function end () {
      var delta = Date.now() - time;
      b.emit('time', delta);
      b.emit('bytes', bytes);
      b.emit('log', bytes + ' bytes written ('
          + (delta / 1000).toFixed(2) + ' seconds)'
      );

      // no more packages to be required
      bundleComplete = true;
      cleanupWhenAssetBundleComplete();

      this.push(null);
    }

    function cleanupWhenAssetBundleComplete() {
      if (bundleComplete && areAllPackagesAssetsComplete(packagesAssetsBuilds)) {
        assetStream.end();

        b.removeListener('cacheObjectsPackage', buildAssetsForPackage);
        b.removeListener('file', buildAssetsForFile);
        b.emit('allBundlesComplete')
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

    return bundle(cb);
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
