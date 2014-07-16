var fs = require('fs');
var path = require('path');
var util = require('util')
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
var cachingEnabled = true;

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
    var pkgcache;
    var cache;
    var mtimes;
    var packages = {};
    var filesPackagePaths = {};
    var fileResolvedForBundle = function() {};
    var first = true;

    if (opts.cache) {
        cache = opts.cache;
        delete opts.cache;
        first = false;
    }
    
    if (opts.pkgcache) {
        pkgcache = opts.pkgcache;
        delete opts.pkgcache;
    }
    
    if (opts.mtimes) {
        mtimes = opts.mtimes;
        delete opts.mtimes;
    }

    if (cachingEnabled && cacheFile && !cache) {
      try {
        var incCache = JSON.parse(fs.readFileSync(cacheFile, {encoding: 'utf8'}));
        cache = incCache.cache || {};
        mtimes = incCache.mtimes || {};
        packages = incCache.packages || {};
        filesPackagePaths = incCache.filesPackagePaths || {};
        pkgcache = filesPackagePaths.reduce(function(pkgcache, file) {
          pkgcache[file] = packages[filesPackagePaths[file]];
          return pkgcache;
        }, {});

        first = false;
      } catch (err) {
        // no existing cache file
        b.emit('_cacheFileReadError', err);
      }
    }

    cache = cache || {};
    mtimes = mtimes || {};
    pkgcache = pkgcache || {};
    
    b.on('package', function (file, pkg) {
        var pkgpath = pkg.__dirname;
        // console.log('package', pkgpath, file)
        pkgcache[file] = pkg;
        packages[pkgpath] || (packages[pkgpath] = pkg);
        filesPackagePaths[file] || (filesPackagePaths[file] = pkgpath);
        if (pkgpath) packageResolvedForBundle(pkgpath);
        // else console.warn('package without path', file)
    });
    
    b.on('dep', function (dep) {
        // console.log('dep', dep.id)
        cache[dep.id] = dep;
        if (!mtimes[dep.id]) updateMtime(mtimes, dep.id);
    });
    
    b.on('file', function (file) {
        // console.log('file', file)
        fileResolvedForBundle(file);
    });

    b.on('bundle', function (bundle) {
        bundle.on('transform', function (tr, mfile) {
            tr.on('file', function (file) {
                // updateMtimeDep(mfile, file);
            });
        });
    });
    
    var bundle = b.bundle.bind(b);
    
    b.bundle = function (opts_, cb) {
        if (b._pending) return bundle(opts_, cb);
        
        if (typeof opts_ === 'function') {
            cb = opts_;
            opts_ = {};
        }
        if (!opts_) opts_ = {};
        if (!first) opts_.cache = cache;
        opts_.includePackage = true;
        opts_.packageCache = pkgcache;

        var packagesAssetsBuilding = {};
        var bundleComplete = false;
        var assetStream = through();
        b.emit('assetStream', assetStream);

        function checkCompleteAssetBundle() {
          if (bundleComplete && allPackagesAssetsComplete(packagesAssetsBuilding)) {
            assetStream.end();
          }
        }

        function assetComplete(err, pkgpath) {
          if (err) assetStream.emit('error', err, pkgpath);
          packagesAssetsBuilding[pkgpath] = COMPLETE;
          checkCompleteAssetBundle();
        }

        function buildAssetsForFile(file) {
          guard(file, 'file');
          var pkgpath = filesPackagePaths[file];
          if (pkgpath) buildAssetsForPackage(pkgpath);
          // else console.warn('waiting for',file)
        }
        function buildAssetsForPackage(pkgpath) {
          guard(pkgpath, 'pkgpath');
          var status = packagesAssetsBuilding[pkgpath];
          if (status && status !== PENDING) return;

          packagesAssetsBuilding[pkgpath] = STARTED;
          buildPackageAssetsToStream(packages[pkgpath], assetStream, function(err) {
            assetComplete(err, pkgpath);
          });
        }

        packageResolvedForBundle = function(pkgpath) {
          buildAssetsForPackage(pkgpath);
        }

        fileResolvedForBundle = function(file) {
          buildAssetsForFile(file);
        };

        opts_.deps = function(depsOpts) {
          var depsStream = through();
          invalidateCache(mtimes, cache, function(err, invalidated) {
            console.log('cachesize',Object.keys(cache).length)
            depsOpts.cache = cache;
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
            first = false;
            var bundleComplete = true;
            checkCompleteAssetBundle();
            
            var delta = ((Date.now() - start) / 1000).toFixed(2);
            b.emit('log', bytes + ' bytes written (' + delta + ' seconds)');
            b.emit('time', Date.now() - start);
            b.emit('bytes', bytes);
            if (cachingEnabled && cacheFile) {
              var updatedCache = {
                cache: cache,
                mtimes: mtimes,
                packages: packages,
                filesPackagePaths: filesPackagePaths,
              };
              b.emit('cache', updatedCache);
              fs.writeFile(cacheFile, JSON.stringify(updatedCache), {encoding: 'utf8'}, function(err) {
                if (err) b.emit('_cacheFileWriteError', err);
                else b.emit('_cacheFileWritten', cacheFile);
              });
            }
        }
        return outStream;
    };
    
    return b;
}

function values(obj) {
  return Object.keys(obj).map(function(key) { return obj[key]; });
}

function buildPackageAssetsToStream(pkg, assetStream, packageDone) {
  guard(pkg, 'pkg');
  guard(assetStream, 'assetStream');
  guard(packageDone, 'packageDone');
  if (!pkg.__dirname) packageDone();
  var patterns = [].concat(pkg.style || []);
  async.each(patterns, function(pattern, patternDone) {
    glob(path.join(pkg.__dirname, pattern), function(err, matches) {
      if (err) return patternDone(err);
      async.each((matches || []), function(assetFilePath, assetDone) {
        var readAssetStream = fs.createReadStream(assetFilePath, {encoding: 'utf8'});
        var transformAssetStream = applyTransforms(readAssetStream, assetFilePath, (pkg.transforms || []));
        transformAssetStream.on('error', assetDone);
        transformAssetStream.pipe(concatStream(function (builtAsset) {
          assetStream.write(builtAsset);
          assetDone();
        }));
      });
    });
  }, packageDone);
}

function applyTransforms(stream, file, transforms) {
  guard(file, 'file');
  guard(transforms, 'transforms');
  guard(stream, 'stream');
  return transforms.reduce(function(lastStream, transform) {
    return lastStream.pipe(require(transform)(file));
  }, stream);
}

function allPackagesAssetsComplete(packagesAssetsBuilding) {
  var numPending = values(packagesAssetsBuilding).filter(function(status) {
    return status === COMPLETE
  });
  return numPending === 0;
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

function guard(value, name) {
  if (!value) throw new Error('missing '+name);
}
