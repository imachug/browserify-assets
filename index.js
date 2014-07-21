var fs = require('fs');
var path = require('path');
var util = require('util');
var assert = require('assert');
var through = require('through');
var async = require('async');
var browserify = require('browserify');
var concatStream = require('concat-stream');
var glob = require('glob');

module.exports = browserifyAssets;
browserifyAssets.browserify = browserify;

var PENDING = 'PENDING';
var STARTED = 'STARTED';
var COMPLETE = 'COMPLETE';

function browserifyAssets(files, opts) {
    var b;
    if (!opts) {
      opts = files || {};
      files = undefined;
      b = typeof opts.bundle === 'function' ? opts : browserify(opts);
    } else {
      b = typeof files.bundle === 'function' ? files : browserify(files, opts);
    }
    var cacheFile = opts.cacheFile || opts.cachefile;

    loadCacheObjects(b, cacheFile);
    attachCacheObjectHandlers(b);
    
    var bundle = b.bundle.bind(b);
    
    b.bundle = function (opts_, cb) {
      if (b._pending) return bundle(opts_, cb);
      
      if (typeof opts_ === 'function') {
        cb = opts_;
        opts_ = {};
      }
      if (!opts_) opts_ = {};

      var co = getCacheObjects(b);

      var packagesAssetsBuilds = {};
      var bundleComplete = false;

      opts_.cache = getModuleCache(b);
      opts_.packageCache = getPackageCache(b);
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
        var co = getCacheObjects(b);
        var pkgpath = co.filesPackagePaths[file];
        if (pkgpath) buildAssetsForPackage(pkgpath);
        // else console.warn('waiting for',file)
      }

      function buildAssetsForPackage(pkgpath) {
        guard(pkgpath, 'pkgpath');
        var co = getCacheObjects(b);
        var status = packagesAssetsBuilds[pkgpath];
        if (status && status !== PENDING) return;

        packagesAssetsBuilds[pkgpath] = STARTED;

        buildPackageAssetsAndWriteToStream(co.packages[pkgpath], assetStream, function(err) {
          assetComplete(err, pkgpath);
        });
      }

      b.on('cacheObjectsPackage', buildAssetsForPackage);
      b.on('file', buildAssetsForFile);

      opts_.deps = function(depsOpts) {
        var co = getCacheObjects(b);
        var modules = co.modules;
        var mtimes = co.mtimes;
        var depsStream = through();
        invalidateCache(mtimes, modules, function(err, invalidated) {
          // console.log('cachesize', Object.keys(cache).length)
          depsOpts.cache = modules;
          b.emit('update', invalidated);
          b.deps(depsOpts).pipe(depsStream);
        });
        return depsStream;
      }
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

        storeCacheObjects(b, cacheFile);
      }
      return outStream;
    };
    
    return b;
}

// asset building

function buildPackageAssetsAndWriteToStream(pkg, assetStream, packageDone) {
  guard(pkg, 'pkg'), guard(assetStream, 'assetStream'), guard(packageDone, 'packageDone');
  
  if (!pkg.__dirname) packageDone();
  
  var transformStreamForFile = streamFactoryForTransforms(pkg.transforms || [])

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

function streamFactoryForTransforms(transforms) {
  guard(transforms, 'transforms');
  return function(file) {
    guard(file, 'file');
    var inputStream = through();
    return transforms.reduce(function(lastStream, transform) {
      return lastStream.pipe(require(transform)(file));
    }, inputStream);
  };
}

function areAllPackagesAssetsComplete(packagesAssetsBuilds) {
  var numPending = values(packagesAssetsBuilds).filter(function(status) {
    return status !== COMPLETE
  }).length;
  return numPending === 0;
}

// caching

function getCacheObjects(b) {
  guard(b, 'browserify instance');
  return b.incCacheObjects;
}

function setCacheObjects(b, cacheObjects) {
  guard(b, 'browserify instance'), guard(cacheObjects, 'cacheObjects');
  b.incCacheObjects = cacheObjects;
}

function getModuleCache(b) {
  guard(b, 'browserify instance');
  var co = getCacheObjects(b);
  if (!Object.keys(co.modules).length) {
    return co.modules;
  }
}

function getPackageCache(b) {
  guard(b, 'browserify instance');
  var co = getCacheObjects(b);
  // rebuild packageCache from packages
  return Object.keys(co.filesPackagePaths).reduce(function(packageCache, file) {
    packageCache[file] = co.packages[co.filesPackagePaths[file]];
    return packageCache;
  }, {});
}

function attachCacheObjectHandlers(b) {
  guard(b, 'browserify instance');
  b.on('dep', function (dep) {
    var co = getCacheObjects(b);
    co.modules[dep.id] = dep;
    if (!co.mtimes[dep.id]) updateMtime(co.mtimes, dep.id);
  });

  b.on('package', function (file, pkg) {
    var co = getCacheObjects(b);

    var pkgpath = pkg.__dirname;
    // console.log('package', pkgpath, file);

    if (pkgpath) {
      co.packages[pkgpath] || (co.packages[pkgpath] = pkg);
      co.filesPackagePaths[file] || (co.filesPackagePaths[file] = pkgpath);
      b.emit('cacheObjectsPackage', pkgpath, pkg)
    }
  });
}

function storeCacheObjects(b, cacheFile) {
  guard(b, 'browserify instance');
  if (cacheFile) {
    var co = getCacheObjects(b);
    fs.writeFile(cacheFile, JSON.stringify(co), {encoding: 'utf8'}, function(err) {
      if (err) b.emit('_cacheFileWriteError', err);
      else b.emit('_cacheFileWritten', cacheFile);
    });
  }
}

function loadCacheObjects(b, cacheFile) {
  guard(b, 'browserify instance');
  var co;  
  if (cacheFile && !getCacheObjects(b)) {
    try {
      co = JSON.parse(fs.readFileSync(cacheFile, {encoding: 'utf8'}));
    } catch (err) {
      // no existing cache file
      b.emit('_cacheFileReadError', err);
    }
  }
  co = co || {};
  co.modules = co.modules || {};
  co.packages = co.packages || {};
  co.mtimes = co.mtimes || {};
  co.filesPackagePaths = co.filesPackagePaths || {};
  setCacheObjects(b, co);
}

function updateMtime(mtimes, file) {
  fs.stat(file, function (err, stat) {
    if (!err) mtimes[file] = stat.mtime.getTime();
  });
}

function invalidateCache(mtimes, cache, done) {
  invalidateModifiedFiles(mtimes, Object.keys(cache), function(file) {
    delete cache[file];
  }, done)
}

function invalidateModifiedFiles(mtimes, files, invalidate, done) {
  async.reduce(files, [], function(invalidated, file, fileDone) {
    fs.stat(file, function (err, stat) {
      if (err) return fileDone();
      var mtimeNew = stat.mtime.getTime();
      if(!(mtimes[file] && mtimeNew && mtimeNew <= mtimes[file])) {
        invalidate(file);
        invalidated.push(file);
      }
      mtimes[file] = mtimeNew;
      fileDone(null, invalidated);
    });
  }, function(err, invalidated) {
    done(null, invalidated);
  });
}

// util

function values(obj) {
  return Object.keys(obj).map(function(key) { return obj[key]; });
}

function guard(value, name) {
  assert(value, 'missing '+name);
}
