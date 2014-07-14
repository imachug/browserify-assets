var fs = require('fs');
var through = require('through');
var async = require('async');
var browserify = require('browserify');

var util = require('util')

module.exports = browserifyAssets;
browserifyAssets.browserify = browserify;

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
    var filesPackages = {};
    var packagesRequired = {};
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

    if (false && cacheFile && !cache) {
      try {
        var incCache = JSON.parse(fs.readFileSync(cacheFile, {encoding: 'utf8'}));
        cache = incCache.cache;
        mtimes = incCache.mtimes;
        packages = incCache.packages;
        filesPackages = incCache.filesPackages;
        pkgcache = {};

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
        console.log('package', pkgpath, file)
        pkgcache[file] = pkg;
        packages[pkgpath] || (packages[pkgpath] = pkg);
        filesPackages[pkgpath] || (filesPackages[pkgpath] = file);
    });
    
    b.on('dep', function (dep) {
        console.log('dep', dep.id)
        cache[dep.id] = dep;
        if (!mtimes[dep.id]) updateMtime(mtimes, dep.id);
    });
    
    b.on('file', function (file) {
        console.log('file', file)
        packagesRequired[]
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

        packagesRequired = {}; // reset

        opts_.deps = function(depsOpts) {
          var d = through();
          invalidateModifiedFiles(mtimes, cache, function(err, invalidated) {
            b.emit('update', invalidated);
            b.deps(depsOpts).pipe(d);
          });
          return d;
        }
        var outStream = bundle(opts_, cb);
        
        var start = Date.now();
        var bytes = 0;
        outStream.pipe(through(function (buf) { bytes += buf.length }));
        outStream.on('end', end);
        
        function end () {
            first = false;
            var updatedCache = {cache: cache, mtimes: mtimes};
            
            var delta = ((Date.now() - start) / 1000).toFixed(2);
            b.emit('log', bytes + ' bytes written (' + delta + ' seconds)');
            b.emit('time', Date.now() - start);
            b.emit('bytes', bytes);
            b.emit('cache', updatedCache);
            if (cacheFile) {
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

function updateMtime(mtimes, file) {
  fs.stat(file, function (err, stat) {
    if (!err) mtimes[file] = stat.mtime.getTime();
  });
}

function invalidateModifiedFiles(mtimes, cache, done) {
  async.reduce(Object.keys(cache), [], function(invalidated, file, fileDone) {
    fs.stat(file, function (err, stat) {
      if (err) {
        // console.error(err.message || err);
        return fileDone();
      }
      var mtimeNew = stat.mtime.getTime();
      if(!(mtimes[file] && mtimeNew && mtimeNew <= mtimes[file])) {
        // console.warn('invalidating', cache[file].name || file)
        invalidated.push(file);
        delete cache[file];
      }
      mtimes[file] = mtimeNew;
      fileDone(null, invalidated);
    });
  }, function(err, invalidated) {
    done(null, invalidated)
  });
}

function invalidateModifiedPackages(mtimes, pkgcache, done) {

}