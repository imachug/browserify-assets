var fs = require('fs');
var path = require('path');
var util = require('util');
var assert = require('assert');

var through = require('through2');
var async = require('async');
var concatStream = require('concat-stream');
var xtend = require('xtend');
var glob = require('glob');
var combineStreams = require('stream-combiner');
var browserifyCache = require('browserify-cache-api');
var mothership = require('mothership');

module.exports = browserifyAssets;

function browserifyAssets(files, opts) {
  // browserify plugin boilerplate
  // normalises variable arguments
  var b;
  if (!opts) {
    opts = files || {};
    files = undefined;
    b = typeof opts.bundle === 'function' ? opts : require('browserify')(xtend(browserifyCache.args, opts));
  } else {
    b = typeof files.bundle === 'function' ? files : require('browserify')(files, xtend(browserifyCache.args, opts));
  }

  browserifyCache(b, opts);

  // override browserify bundle() method
  var bundle = b.bundle.bind(b);
  b.bundle = function (cb) {
    // more browserify plugin boilerplate
    if (b._pending) return bundle(cb);

    // asset build progress
    var packagesBuildingAssets = {};
    var filesDiscoveringPackages = {};
    var bundleComplete = false;

    // provide asset bundle stream to api consumers
    var assetStream = through();
    b.emit('assetStream', assetStream, 'style');

    // init metrics
    var time = null;
    var bytes = 0;
    b.pipeline.get('record').on('end', function () {
      time = Date.now();
    });
    
    // intercept deps in pipeline and add to asset build
    b.pipeline.get('deps').push(through.obj(function(dep, enc, next) {
      var filepath = dep && dep.file || dep.id;
      if (filepath != null) {
        buildAssetsForFile(filepath)
        b.emit('depFile', filepath)
      }
      this.push(dep);
      next();
    }, function() {
      this.push(null);
    }));
    
    // produce metrics events
    b.pipeline.get('wrap').push(through(function(buf, enc, next) {
      bytes += buf.length;
      this.push(buf);
      next();
    }, function() {
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
    }));

    function cleanupWhenAssetBundleComplete() {
      if (
        bundleComplete
        && allItemsComplete(filesDiscoveringPackages)
        && allItemsComplete(packagesBuildingAssets)
      ) {
        assetStream.end();

        b.emit('allBundlesComplete')
      }
    }

    function assetComplete(err, pkgdir) {
      if (err) assetStream.emit('error', err, pkgdir);
      packagesBuildingAssets[pkgdir] = 'COMPLETE';

      cleanupWhenAssetBundleComplete();
    }

    function buildAssetsForFile(file) {
      assertExists(file, 'file');
      // var cache = browserifyCache.getCacheObjects(b);
      // var pkgdir = cache.filesPackagePaths[file];
      // if (pkgdir) {
      //   buildAssetsForPackage(pkgdir);
      // } else {
        filesDiscoveringPackages[file] = 'STARTED';
        mothership(file, function(pkg) { return true }, function (err, res) {
          if (err) return b.emit('error', err);
          filesDiscoveringPackages[file] = 'COMPLETE';
          // // update filesPackagePaths with new data
          // var cache = browserifyCache.getCacheObjects(b);
          var pkgdir = path.dirname(res.path);
          // cache.filesPackagePaths[file] = pkgdir;
          buildAssetsForPackage(pkgdir, res.pack);
        });
      // }
      // else console.warn('waiting for',file)
    }

    function buildAssetsForPackage(pkgdir, pkgLoaded) {
      assertExists(pkgdir, 'pkgdir');
      if (pkgdir.indexOf('package.json') > -1) throw new Error(pkgdir)
      // var cache = browserifyCache.getCacheObjects(b);
      var status = packagesBuildingAssets[pkgdir];
      if (status && status == 'STARTED') return;
      if (status && status == 'COMPLETE') return cleanupWhenAssetBundleComplete();

      packagesBuildingAssets[pkgdir] = 'STARTED';

      // var pkg = pkgLoaded || cache.packages[pkgdir] || require(path.join(pkgdir, 'package.json'));
      var pkg = pkgLoaded || require(path.join(pkgdir, 'package.json'));
      assertExists(pkg, 'pkg');
      pkg.__dirname = pkg.__dirname || pkgdir;
      // // update packages cache with new data if available
      // cache.packages[pkgdir] = pkg;

      buildPackageAssetsAndWriteToStream(b, pkg, assetStream, function(err) {
        assetComplete(err, pkgdir);
      });
    }

    return bundle(cb);
  };

  return b;
}

// asset building

function buildPackageAssetsAndWriteToStream(b, pkg, assetStream, packageDone) {
  assertExists(pkg, 'pkg'), assertExists(assetStream, 'assetStream'), assertExists(packageDone, 'packageDone');

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
        b.emit('assetFile', assetFilePath)

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
    outputStream.write(accumulated+'\n');
    done();
  });
}

function streamFactoryForPackage(pkg) {
  assertExists(pkg, 'pkg');
  var transforms = (pkg.transforms || []).map(function(tr) {
    return findTransform(tr, pkg);
  });

  return function(file) {
    assertExists(file, 'file');
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

function allItemsComplete(itemStatuses) {
  var numPending = values(itemStatuses).filter(function(status) {
    return status !== 'COMPLETE'
  }).length;
  return numPending === 0;
}

// util

function values(obj) {
  return Object.keys(obj).map(function(key) { return obj[key]; });
}

function assertExists(value, name) {
  assert(value, 'missing '+name);
}

function isLocalPath(filepath) {
  var charAt0 = filepath.charAt(0)
  return charAt0 === '.' || charAt0 === '/'
}
