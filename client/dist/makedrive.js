!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.MakeDrive=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
function parse(url) { return new global.URL(url); }
function format(urlObj) { return urlObj.href; }

module.exports = {
  parse: parse,
  format: format
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],2:[function(require,module,exports){
(function (global){
/**
 * In node.js we want to use the ws module for WebSocket. In the
 * browser we can just use the native WebSocket. Here we adapt
 * the browser's WebSocket interface to more closely match ws
 * so that we can use either.
 *
 * This module gets used by browserify, see package.json
 */

if (!global.WebSocket) return;

global.WebSocket.prototype.on = global.WebSocket.prototype.on || function(event, listener) {
  this.addEventListener(event, listener);
};

global.WebSocket.prototype.removeListener = global.WebSocket.prototype.removeListener || function(event, listener) {
  this.removeEventListener(event, listener);
};

global.WebSocket.prototype.once = global.WebSocket.prototype.once || function(event, listener) {
  var ws = this;
  this.addEventListener(event, function onEvent() {
    ws.removeEventListener(event, onEvent);
    listener.apply(null, arguments);
  });
};

module.exports = global.WebSocket;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],3:[function(require,module,exports){
(function (global){
/**
 * MakeDrive is a single/shared Filer filesystem instance with
 * manual- and auto-sync'ing features. A client first gets the
 * filesystem instance like so:
 *
 * var fs = MakeDrive.fs();
 *
 * Multiple calls to MakeDrive.fs() will return the same instance.
 *
 * A number of configuration options can be passed to the fs() function.
 * These include:
 *
 * - manual=true - by default the filesystem syncs automatically in
 * the background. This disables it.
 *
 * - memory=<Boolean> - by default we use a persistent store (indexeddb
 * or websql). Using memory=true overrides and uses a temporary ram disk.
 *
 * - provider=<Object> - a Filer data provider to use instead of the
 * default provider normally used. The provider given should already
 * be instantiated (i.e., don't pass a constructor function).
 *
 * - forceCreate=<Boolean> - by default we return the same fs instance with
 * every call to MakeDrive.fs(). In some cases it is necessary to have
 * multiple instances.  Using forceCreate=true does this.
 *
 * - interval=<Number> - by default, the filesystem syncs every 15 seconds if
 * auto syncing is turned on otherwise the interval between syncs can be
 * specified in ms.
 *
 * Various bits of Filer are available on MakeDrive, including:
 *
 * - MakeDrive.Buffer
 * - MakeDrive.Path
 * - MakeDrive.Errors
 *
 * The filesystem instance returned by MakeDrive.fs() also includes
 * a new property `sync`.  The fs.sync property is an EventEmitter
 * which emits the following events:
 *
 * - 'error': an error occured while connecting/syncing. The error
 * object is passed as the first arg to the event.
 *
 * - 'connected': a connection was established with the sync server. This
 * does not indicate that a sync has begun (use the 'syncing' event instead).
 *
 * - 'disconnected': the connection to the sync server was lost, either
 * due to the client or server.
 *
 * - 'syncing': a sync with the server has begun. A subsequent 'completed'
 * or 'error' event should follow at some point, indicating whether
 * or not the sync was successful.
 *
 * - 'idle': a sync was requested but no sync was performed. This usually
 * is triggered when no changes were made to the filesystem and hence, no
 * changes were needed to be synced to the server.
 *
 * - 'completed': a file/directory/symlink has been synced successfully.
 *
 * - 'synced': MakeDrive has been synced and all paths are up-to-date with
 * the server.
 *
 *
 * The `sync` property also exposes a number of methods, including:
 *
 * - connect(url, [token]): try to connect to the specified sync server URL.
 * An 'error' or 'connected' event will follow, depending on success. If the
 * token parameter is provided, that authentication token will be used. Otherwise
 * the client will try to obtain one from the server's /api/sync route. This
 * requires the user to be authenticated previously with Webmaker.
 *
 * - disconnect(): disconnect from the sync server.
 *
 * - request(): request a sync with the server.
 * Such requests may or may not be processed right away.
 *
 *
 * Finally, the `sync` propery also exposes a `state`, which is the
 * current sync state and can be one of:
 *
 * sync.SYNC_DISCONNECTED = "SYNC DISCONNECTED" (also the initial state)
 * sync.SYNC_CONNECTING = "SYNC CONNECTING"
 * sync.SYNC_CONNECTED = "SYNC CONNECTED"
 * sync.SYNC_SYNCING = "SYNC SYNCING"
 */

var SyncManager = require('./sync-manager.js');
var SyncFileSystem = require('./sync-filesystem.js');
var Filer = require('../../lib/filer.js');
var EventEmitter = require('events').EventEmitter;
var log = require('./logger.js');

var MakeDrive = {};

// Expose the logging api, so users can set log level
MakeDrive.log = log;

// Expose bits of Filer that clients will need on MakeDrive
MakeDrive.Buffer = Filer.Buffer;
MakeDrive.Path = Filer.Path;
MakeDrive.Errors = Filer.Errors;

module.exports = MakeDrive;

function createFS(options) {
  options.manual = options.manual === true;
  options.memory = options.memory === true;
  options.autoReconnect = options.autoReconnect !== false;

  // Use a supplied provider, in-memory RAM disk, or Fallback provider (default).
  if(options.memory) {
    log.debug('Using Filer Memory provider for fs');
    options.provider = new Filer.FileSystem.providers.Memory('makedrive');
  }
  if(!options.provider) {
    log.debug('Using Fallback provider for fs');
    options.provider = new Filer.FileSystem.providers.Fallback('makedrive');
  } else {
    log.debug('Using user-provided provider for fs', options.provider);
  }

  // Our fs instance is a modified Filer fs, with extra sync awareness
  // for conflict mediation, etc.  We keep an internal reference to the
  // raw Filer fs, and use the SyncFileSystem instance externally.
  var _fs = new Filer.FileSystem(options, function(err) {
    // FS creation errors will be logged for now for debugging purposes
    if(err) {
      log.error('Filesystem initialization error', err);
    }
  });
  var fs = new SyncFileSystem(_fs);
  var sync = fs.sync = new EventEmitter();
  var manager;
  Object.defineProperty(sync, 'downstreamQueue', {
    get: function() { return manager && manager.downstreams; }
  });

  // Auto-sync handles
  var autoSync;

  // State of the sync connection
  sync.SYNC_DISCONNECTED = "SYNC DISCONNECTED";
  sync.SYNC_CONNECTING = "SYNC CONNECTING";
  sync.SYNC_CONNECTED = "SYNC CONNECTED";
  sync.SYNC_SYNCING = "SYNC SYNCING";

  // Intitially we are not connected
  sync.state = sync.SYNC_DISCONNECTED;

  // Optionally warn when closing the window if still syncing
  function windowCloseHandler(event) {
    if(!options.windowCloseWarning) {
      return;
    }

    if(sync.state !== sync.SYNC_SYNCING) {
      return;
    }

    var confirmationMessage = "Sync currently underway, are you sure you want to close?";
    (event || global.event).returnValue = confirmationMessage;

    return confirmationMessage;
  }

  function cleanupManager() {
    if(!manager) {
      return;
    }
    log.debug('Closing manager');
    manager.close();
    manager = null;
  }

  // Turn on auto-syncing if its not already on
  sync.auto = function(interval) {
    var syncInterval = interval|0 > 0 ? interval|0 : 15 * 1000;
    log.debug('Starting automatic syncing mode every ' + syncInterval + 'ms');

    if(autoSync) {
      clearInterval(autoSync);
    }

    autoSync = setInterval(sync.request, syncInterval);
  };

  // Turn off auto-syncing and turn on manual syncing
  sync.manual = function() {
    log.debug('Starting manual syncing mode');
    if(autoSync) {
      clearInterval(autoSync);
      autoSync = null;
    }
  };

  // The sync was stopped mid-way through.
  sync.onInterrupted = function(path) {
    sync.emit('error', new Error('Sync interrupted for path ' + path));
    log.warn('Sync interrupted by server for ' + path);
  };

  sync.onError = function(err) {
    sync.emit('error', err);
    log.error('Sync error', err);
  };

  sync.onIdle = function(reason) {
    sync.emit('idle', reason);
    log.info('No sync took place: ' + reason);
  };

  sync.onDisconnected = function() {
    // Remove listeners so we don't leak instance variables
    if("onbeforeunload" in global) {
      log.debug('Removing window.beforeunload handler');
      global.removeEventListener('beforeunload', windowCloseHandler);
    }
    if("onunload" in global){
      log.debug('Removing window.unload handler');
      global.removeEventListener('unload', cleanupManager);
    }

    sync.state = sync.SYNC_DISCONNECTED;
    sync.emit('disconnected');
    log.info('Disconnected from MakeDrive server');
  };

  // Request that a sync begin.
  // sync.request does not take any parameters
  // as the path to sync is determined internally
  sync.request = function() {
    if(sync.state === sync.SYNC_CONNECTING || sync.state === sync.SYNC_DISCONNECTED) {
      sync.emit('error', new Error('MakeDrive error: MakeDrive cannot sync as it is either disconnected or trying to connect'));
      log.warn('Tried to sync in invalid state: ' + sync.state);
      return;
    }

    log.info('Requesting sync');
    manager.syncUpstream();
  };

  // Try to connect to the server.
  sync.connect = function(url, token) {
    // Bail if we're already connected
    if(sync.state !== sync.SYNC_DISCONNECTED) {
      log.warn('Tried to connect, but already connected');
      return;
    }

    // Also bail if we already have a SyncManager
    if(manager) {
      return;
    }

    // Upgrade connection state to `connecting`
    log.info('Connecting to MakeDrive server');
    sync.state = sync.SYNC_CONNECTING;

    function connect(token) {
      // Try to connect to provided server URL. Use the raw Filer fs
      // instance for all rsync operations on the filesystem, so that we
      // can untangle changes done by user vs. sync code.
      manager = new SyncManager(sync, fs, _fs);

      manager.init(url, token, options, function(err) {
        if(err) {
          log.error('Error connecting to ' + url, err);
          sync.onError(err);
          return;
        }
        // If we're in manual mode, bail before starting auto-sync
        if(options.manual) {
          sync.manual();
        } else {
          sync.auto(options.interval);
        }

        // In a browser, try to clean-up after ourselves when window goes away
        if("onbeforeunload" in global) {
          global.addEventListener('beforeunload', windowCloseHandler);
        }
        if("onunload" in global){
          global.addEventListener('unload', cleanupManager);
        }

        // Deals with race conditions if a sync was
        // started immediately after connecting before
        // this callback could be triggered
        if(sync.state !== sync.SYNC_SYNCING) {
          sync.state = sync.SYNC_CONNECTED;
          sync.emit('connected', url);
          log.info('MakeDrive connected to server at ' + url);
        }

        sync.onSyncing = function(path) {
          // A downstream sync might have just started,
          // update the queue
          sync.state = sync.SYNC_SYNCING;
          sync.emit('syncing', 'Sync started for ' + path);
          log.info('Sync started for ' + path);
        };

        // A sync (either upstream or downstream) has completed for a single
        // file/directory/symlink. The paths left to sync upstream needs to be
        // updated and an event should be emitted.
        sync.onCompleted = function(path, needsUpstream) {
          var downstreamQueue = manager.downstreams;
          needsUpstream = needsUpstream || [];

          // If during a downstream sync was performed and it was found that
          // the path is more up-to-date on the client and hence needs to be
          // upstreamed to the server, add it to the upstream queue.
          fs.appendPathsToSync(needsUpstream, function(err) {
            if(err) {
              sync.emit('error', err);
              log.error('Error appending paths to upstream after sync completed for ' + path + ' with error', err);
              return;
            }

            fs.getPathsToSync(function(err, pathsToSync) {
              var syncsLeft;

              if(err) {
                sync.emit('error', err);
                log.error('Error retrieving paths to sync after sync completed for ' + path + ' with error', err);
                return;
              }

              // Determine if there are any more syncs remaining (both upstream and downstream)
              syncsLeft = pathsToSync ? pathsToSync.concat(downstreamQueue) : downstreamQueue;

              if(path) {
                sync.emit('completed', path);
                log.info('Sync completed for ' + path);
              }

              if(!syncsLeft.length) {
                sync.allCompleted();
              }
            });
          });
        };

        // This is called when all nodes have been synced
        // upstream and all downstream syncs have completed
        sync.allCompleted = function() {
          if(sync.state !== sync.SYNC_DISCONNECTED) {
            // Reset the state
            sync.state = sync.SYNC_CONNECTED;
          }

          sync.emit('synced', 'MakeDrive has been synced');
          log.info('All syncs completed');
        };
      });
    }
    connect(token);
  };

  // Disconnect from the server
  sync.disconnect = function() {
    // Bail if we're not already connected
    if(sync.state === sync.SYNC_DISCONNECTED) {
      log.warn('Tried to disconnect while not connected');
      return;
    }

    // Stop auto-syncing
    if(autoSync) {
      clearInterval(autoSync);
      autoSync = null;
    }

    // Do a proper network shutdown
    cleanupManager();

    sync.onDisconnected();
  };

  return fs;
}

// Manage single instance of a Filer filesystem with auto-sync'ing
var sharedFS;

MakeDrive.fs = function(options) {
  options = options || {};

  // We usually only want to hand out a single, shared instance
  // for every call, but sometimes you need multiple (e.g., tests)
  if(options.forceCreate) {
    return createFS(options);
  }

  if(!sharedFS) {
    sharedFS = createFS(options);
  }
  return sharedFS;
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../../lib/filer.js":13,"./logger.js":4,"./sync-filesystem.js":6,"./sync-manager.js":7,"events":27}],4:[function(require,module,exports){
/**
 * Simplified Bunyan-like logger for browser.
 * https://github.com/trentm/node-bunyan
 *
 * Set the level with logger.level(...). By default
 * no logging is done. Call logger level methods to
 * potentially log, depending on current log level.
 */

// Log Levels
var TRACE = 10;
var DEBUG = 20;
var INFO = 30;
var WARN = 40;
var ERROR = 50;
var FATAL = 60;
var DISABLED = 100;

var levelFromName = {
  'trace': TRACE,
  'debug': DEBUG,
  'info': INFO,
  'warn': WARN,
  'error': ERROR,
  'fatal': FATAL,
  'disabled': DISABLED
};

var levelFromNumber = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
  DISABLED: 'disabled'
};

// By default, we won't log anything
var currentLogLevel = DISABLED;

function log(level, args) {
  if(currentLogLevel > level) {
    return;
  }

  args = Array.prototype.slice.call(args);
  args.unshift('[MakeDrive]', (levelFromNumber[level] || '').toUpperCase() + ':');

  console[level >= ERROR ? 'error' : 'log'].apply(console, args);
}

module.exports = {
  trace: function() {
    log(TRACE, arguments);
  },

  debug: function() {
    log(DEBUG, arguments);
  },

  info: function() {
    log(INFO, arguments);
  },

  warn: function() {
    log(WARN, arguments);
  },

  error: function() {
    log(ERROR, arguments);
  },

  fatal: function() {
    log(FATAL, arguments);
  },

  TRACE: TRACE,
  DEBUG: DEBUG,
  INFO: INFO,
  WARN: WARN,
  ERROR: ERROR,
  FATAL: FATAL,
  DISABLED: DISABLED,

  // Get or Set the current log level. To disable use DISABLED (default).
  level: function(nameOrNum) {
    if(nameOrNum === undefined) {
      return currentLogLevel;
    }

    if(typeof(nameOrNum) === 'string') {
      nameOrNum = levelFromName[nameOrNum.toLowerCase()];
    }

    if(nameOrNum === undefined ||
       !(TRACE <= nameOrNum && nameOrNum <= DISABLED)) {
      throw new Error('invalid log level: ' + nameOrNum);
    }

    currentLogLevel = nameOrNum;
  }
};

},{}],5:[function(require,module,exports){
var SyncMessage = require('../../lib/syncmessage');
var rsync = require('../../lib/rsync');
var rsyncUtils = rsync.utils;
var rsyncOptions = require('../../lib/constants').rsyncDefaults;
var syncTypes = require('../../lib/constants').syncTypes;
var serializeDiff = require('../../lib/diff').serialize;
var deserializeDiff = require('../../lib/diff').deserialize;
var fsUtils = require('../../lib/fs-utils');
var log = require('./logger.js');
var findPathIndexInArray = require('../../lib/util.js').findPathIndexInArray;

function onError(syncManager, err) {
  syncManager.sync.onError(err);
}

function sendChecksums(syncManager, path, type, sourceList) {
  var fs = syncManager.fs;
  var rawFs = syncManager.rawFs;
  var sync = syncManager.sync;
  var message;

  // If the server requests to downstream a path that is not in the
  // root, ignore the downstream.
  if(path.indexOf(fs.root) !== 0) {
    message = SyncMessage.response.root;
    message.content = {path: path, type: type};
    log.info('Ignoring ' + type + ' downstream sync for ' + path);
    return syncManager.send(message.stringify());
  }

  syncManager.downstreams.push(path);
  sync.onSyncing(path);

  rsync.checksums(rawFs, path, sourceList, rsyncOptions, function(err, checksums) {
    if(err) {
      log.error('Failed to generate checksums for ' + path + ' during downstream sync', err);
      message = SyncMessage.request.delay;
      message.content = {path: path, type: type};
      syncManager.send(message.stringify());
      return onError(syncManager, err);
    }

    fs.trackChanges(path, sourceList);
    message = SyncMessage.request.diffs;
    message.content = {path: path, type: type, checksums: checksums};
    syncManager.send(message.stringify());
  });
}

function handleRequest(syncManager, data) {
  var fs = syncManager.fs;
  var rawFs = syncManager.rawFs;
  var sync = syncManager.sync;

  function handleChecksumRequest() {
    if(data.invalidContent(['type', 'sourceList'])) {
      log.error('Path, type or source list not sent by server in handleChecksumRequest.', data);
      return onError(syncManager, new Error('Server sent insufficient content'));
    }

    sendChecksums(syncManager, data.content.path, data.content.type, data.content.sourceList);
  }

  function handleDiffRequest() {
    if(data.invalidContent(['type', 'checksums'])) {
      log.warn(data, 'Upstream sync message received from the server without sufficient information in handleDiffRequest');
      fs.delaySync(function(err, path) {
        if(err) {
          log.error(err, 'An error occured while updating paths to sync in handleDiffRequest');
          return onError(syncManager, err);
        }

        log.info('Sync delayed for ' + path + ' in handleDiffRequest');
        syncManager.currentSync = false;
        syncManager.syncUpstream();
      });
      return;
    }

    var path = data.content.path;
    var type = data.content.type;
    var checksums = data.content.checksums;
    var message;

    rsync.diff(rawFs, path, checksums, rsyncOptions, function(err, diffs) {
      if(err){
        log.error(err, 'Error generating diffs in handleDiffRequest for ' + path);

        fs.delaySync(function(delayErr, delayedPath) {
          if(delayErr) {
            log.error(err, 'Error updating paths to sync in handleDiffRequest after failing to generate diffs for ' + path);
            return onError(syncManager, delayErr);
          }

          log.info('Sync delayed for ' + delayedPath + ' in handleDiffRequest');
          syncManager.currentSync = false;
          syncManager.syncUpstream();
        });
      } else {
        message = SyncMessage.response.diffs;
        message.content = {path: path, type: type, diffs: serializeDiff(diffs)};
        syncManager.send(message.stringify());
      }
    });
  }

  function handleRenameRequest() {
    if(data.invalidContent(['type', 'oldPath'])) {
      log.error('Path, type or old path not sent by server in handleRenameRequest.', data);
      return onError(syncManager, new Error('Server sent insufficient content'));
    }

    var path = data.content.path;
    var oldPath = data.content.oldPath;
    var type = data.content.type;
    var message;

    // If the server requests to downstream a path that is not in the
    // root, ignore the downstream.
    if(path.indexOf(fs.root) !== 0) {
      message = SyncMessage.response.root;
      message.content = {path: path};
      log.info('Ignoring downstream sync for ' + path);
      return syncManager.send(message.stringify());
    }

    syncManager.downstreams.push(path);
    sync.onSyncing(oldPath);

    rsyncUtils.rename(rawFs, oldPath, path, function(err) {
      if(err) {
        log.error('Failed to rename ' + oldPath + ' to ' + path + ' during downstream sync', err);
        message = SyncMessage.request.delay;
        message.content = {path: path, type: type};
        syncManager.send(message.stringify());
        return onError(syncManager, err);
      }

      rsyncUtils.generateChecksums(rawFs, [path], true, function(err, checksum) {
        if(err) {
          log.error('Failed to generate checksums for ' + path + ' during downstream rename', err);
          message = SyncMessage.request.delay;
          message.content = {path: path, type: type};
          syncManager.send(message.stringify());
          return onError(syncManager, err);
        }

        message = SyncMessage.response.patch;
        message.content = {path: path, type: type, checksum: checksum};
        syncManager.send(message.stringify());
      });
    });
  }

  function handleDeleteRequest() {
    if(data.invalidContent(['type'])) {
      log.error('Path or type not sent by server in handleRenameRequest.', data);
      return onError(syncManager, new Error('Server sent insufficient content'));
    }

    var path = data.content.path;
    var type = data.content.type;
    var message;

    // If the server requests to downstream a path that is not in the
    // root, ignore the downstream.
    if(path.indexOf(fs.root) !== 0) {
      message = SyncMessage.response.root;
      message.content = {path: path, type: type};
      log.info('Ignoring downstream sync for ' + path);
      return syncManager.send(message.stringify());
    }

    syncManager.downstreams.push(path);
    sync.onSyncing(path);

    rsyncUtils.del(rawFs, path, function(err) {
      if(err) {
        log.error('Failed to delete ' + path + ' during downstream sync', err);
        message = SyncMessage.request.delay;
        message.content = {path: path, type: type};
        syncManager.send(message.stringify());
        return onError(syncManager, err);
      }

      rsyncUtils.generateChecksums(rawFs, [path], false, function(err, checksum) {
        if(err) {
          log.error('Failed to generate checksums for ' + path + ' during downstream delete', err);
          message = SyncMessage.request.delay;
          message.content = {path: path, type: type};
          syncManager.send(message.stringify());
          return onError(syncManager, err);
        }

        message = SyncMessage.response.patch;
        message.content = {path: path, type: type, checksum: checksum};
        syncManager.send(message.stringify());
      });
    });
  }

  if(data.is.checksums) {
    // DOWNSTREAM - CHKSUM
    handleChecksumRequest();
  } else if(data.is.diffs) {
    // UPSTREAM - DIFFS
    handleDiffRequest();
  } else if(data.is.rename) {
    // DOWNSTREAM - RENAME
    handleRenameRequest();
  } else if(data.is.del) {
    // DOWNSTREAM - DELETE
    handleDeleteRequest();
  } else {
    onError(syncManager, new Error('Failed to sync with the server.'));
  }
}

function handleResponse(syncManager, data) {
  var fs = syncManager.fs;
  var rawFs = syncManager.rawFs;
  var sync = syncManager.sync;

  function handleSourceListResponse() {
    if(data.invalidContent(['type'])) {
      log.warn(data, 'Upstream sync message received from the server without sufficient information in handleSourceListResponse');
      return fs.delaySync(function(err, path) {
        if(err) {
          log.error(err, 'An error occured while updating paths to sync in handleSourceListResponse');
          return onError(syncManager, err);
        }

        log.info('Sync delayed for ' + path + ' in handleSourceListResponse');
        syncManager.currentSync = false;
        syncManager.syncUpstream();
      });
    }

    var message;
    var path = data.content.path;
    var type = data.content.type;

    sync.onSyncing(path);

    if(type === syncTypes.RENAME) {
      message = SyncMessage.request.rename;
      message.content = {path: path, oldPath: data.content.oldPath, type: type};
      return syncManager.send(message.stringify());
    }

    if(type === syncTypes.DELETE) {
      message = SyncMessage.request.del;
      message.content = {path: path, type: type};
      return syncManager.send(message.stringify());
    }

    rsync.sourceList(rawFs, path, rsyncOptions, function(err, sourceList) {
      if(err){
        log.error(err, 'Error generating source list in handleSourceListResponse for ' + path);
        return fs.delaySync(function(delayErr, delayedPath) {
          if(delayErr) {
            log.error(err, 'Error updating paths to sync in handleSourceListResponse after failing to generate source list for ' + path);
            return onError(syncManager, delayErr);
          }

          log.info('Sync delayed for ' + delayedPath + ' in handleSourceListResponse');
          syncManager.currentSync = false;
          syncManager.syncUpstream();
        });
      }

      message = SyncMessage.request.checksums;
      message.content = {path: path, type: type, sourceList: sourceList};
      syncManager.send(message.stringify());
    });
  }

  // As soon as an upstream sync happens, the file synced
  // becomes the last synced version and must be stamped
  // with its checksum to version it and the unsynced attribute
  // must be removed
  function handlePatchAckResponse() {
    var syncedPath = data.content.path;

    function complete() {
      fsUtils.removeUnsynced(fs, syncedPath, function(err) {
        if(err && err.code !== 'ENOENT') {
          log.error('Failed to remove unsynced attribute for ' + syncedPath + ' in handlePatchAckResponse, complete()');
        }

        syncManager.syncNext(syncedPath);
      });
    }

    fs.lstat(syncedPath, function(err, stats) {
      if(err) {
        if(err.code !== 'ENOENT') {
          log.error('Failed to access ' + syncedPath + ' in handlePatchAckResponse');
          return fs.delaySync(function(delayErr, delayedPath) {
            if(delayErr) {
              log.error('Failed to delay upstream sync for ' + delayedPath + ' in handlePatchAckResponse');
            }
            onError(syncManager, err);
          });
        }

        // Non-existent paths usually due to renames or
        // deletes cannot be stamped with a checksum
        return complete();
      }

      if(!stats.isFile()) {
        return complete();
      }

      rsyncUtils.getChecksum(rawFs, syncedPath, function(err, checksum) {
        if(err) {
          log.error('Failed to get the checksum for ' + syncedPath + ' in handlePatchAckResponse');
          return fs.delaySync(function(delayErr, delayedPath) {
            if(delayErr) {
              log.error('Failed to delay upstream sync for ' + delayedPath + ' in handlePatchAckResponse while getting checksum');
            }
            onError(syncManager, err);
          });
        }

        fsUtils.setChecksum(rawFs, syncedPath, checksum, function(err) {
          if(err) {
            log.error('Failed to stamp the checksum for ' + syncedPath + ' in handlePatchAckResponse');
            return fs.delaySync(function(delayErr, delayedPath) {
              if(delayErr) {
                log.error('Failed to delay upstream sync for ' + delayedPath + ' in handlePatchAckResponse while setting checksum');
              }
              onError(syncManager, err);
            });
          }

          complete();
        });
      });
    });
  }

  function handleDiffResponse() {
    var message;

    if(data.invalidContent(['type', 'diffs'])) {
      log.error('Path, type or diffs not sent by server in handleDiffResponse.', data);
      return onError(syncManager, new Error('Server sent insufficient content'));
    }

    var path = data.content.path;
    var type = data.content.type;
    var diffs = deserializeDiff(data.content.diffs);
    var changedDuringDownstream = fs.changesDuringDownstream.indexOf(path);
    var cachedSourceList = fs.untrackChanges(path);

    if(changedDuringDownstream !== -1) {
      // Resend the checksums for that path
      return sendChecksums(syncManager, path, type, cachedSourceList);
    }

    rsync.patch(rawFs, path, diffs, rsyncOptions, function(err, paths) {
      if(err) {
        log.error('Failed to patch ' + path + ' during downstream sync', err);
        message = SyncMessage.request.delay;
        message.content = {path: path, type: type};
        syncManager.send(message.stringify());
        return onError(syncManager, err);
      }

      var needsUpstream = paths.needsUpstream;
      syncManager.needsUpstream = syncManager.needsUpstream || [];
      syncManager.needsUpstream.forEach(function(upstreamPath) {
        if(needsUpstream.indexOf(upstreamPath) === -1) {
          syncManager.needsUpstream.push(upstreamPath);
        }
      });

      fsUtils.getPathsToSync(rawFs, fs.root, function(err, pathsToSync) {
        if(err) {
          log.error('Failed to update paths to sync during downstream sync', err);
          message = SyncMessage.request.delay;
          message.content = {path: path, type: type};
          syncManager.send(message.stringify());
          return onError(syncManager, err);
        }

        var indexInPathsToSync;

        if(pathsToSync && pathsToSync.toSync && needsUpstream.indexOf(path) === -1) {
          indexInPathsToSync = findPathIndexInArray(pathsToSync.toSync, path);
          if(indexInPathsToSync !== -1) {
            pathsToSync.toSync.splice(indexInPathsToSync, 1);
          }
        }

        fsUtils.setPathsToSync(rawFs, fs.root, pathsToSync, function(err) {
          if(err) {
            log.error('Failed to update paths to sync during downstream sync', err);
            message = SyncMessage.request.delay;
            message.content = {path: path, type: type};
            syncManager.send(message.stringify());
            return onError(syncManager, err);
          }

          rsyncUtils.generateChecksums(rawFs, paths.synced, true, function(err, checksum) {
            if(err) {
              log.error('Failed to generate checksums for ' + paths.synced + ' during downstream patch', err);
              message = SyncMessage.request.delay;
              message.content = {path: path, type: type};
              syncManager.send(message.stringify());
              return onError(syncManager, err);
            }

            message = SyncMessage.response.patch;
            message.content = {path: path, type: type, checksum: checksum};
            syncManager.send(message.stringify());
          });
        });
      });
    });
  }

  function handleVerificationResponse() {
    var path = data.content && data.content.path;
    syncManager.downstreams.splice(syncManager.downstreams.indexOf(path), 1);
    sync.onCompleted(path, syncManager.needsUpstream);
  }

  if(data.is.sync) {
    // UPSTREAM - INIT
    handleSourceListResponse();
  } else if(data.is.patch) {
    // UPSTREAM - PATCH
    handlePatchAckResponse();
  } else if(data.is.diffs) {
    // DOWNSTREAM - PATCH
    handleDiffResponse();
  } else if(data.is.verification) {
    // DOWNSTREAM - PATCH VERIFICATION
    handleVerificationResponse();
  }  else {
    onError(syncManager, new Error('Failed to sync with the server.'));
  }
}

function handleError(syncManager, data) {
  var sync = syncManager.sync;
  var fs = syncManager.fs;
  var path = data.content && data.content.path;

  function handleForcedDownstream() {
    fs.dequeueSync(function(err, syncsLeft, removedPath) {
      if(err) {
        log.fatal('Fatal error trying to dequeue sync in handleForcedDownstream');
        return;
      }

      syncManager.currentSync = false;
      sync.onInterrupted(removedPath);
    });
  }

  function handleUpstreamError() {
    fs.delaySync(function(err, delayedPath) {
      if(err) {
        log.fatal('Fatal error trying to delay sync in handleUpstreamError');
        return;
      }

      syncManager.currentSync = false;
      sync.onInterrupted(delayedPath);
    });
  }

  function handleDownstreamError() {
    if(syncManager.downstreams && syncManager.downstreams.length) {
      syncManager.downstreams.splice(syncManager.downstreams.indexOf(path), 1);
    }

    fs.untrackChanges(path);
    sync.onInterrupted(path);
  }

  if(data.is.content) {
    log.error('Invalid content was sent to the server');
  } else if(data.is.needsDownstream) {
    log.warn('Cancelling upstream for ' + path + ', downstreaming instead');
    handleForcedDownstream();
  } else if(data.is.impl) {
    log.error('Server could not initialize upstream sync for ' + path);
    handleUpstreamError();
  } else if(data.is.interrupted) {
    log.error('Server interrupted upstream sync due to incoming downstream for ' + path);
    handleUpstreamError();
  } else if(data.is.locked) {
    log.error('Server cannot process upstream request due to ' + path + ' being locked');
    handleUpstreamError();
  } else if(data.is.fileSizeError) {
    log.error('Maximum file size for upstream syncs exceeded for ' + path);
    handleUpstreamError();
  } else if(data.is.checksums) {
    log.error('Error generating checksums on the server for ' + path);
    handleUpstreamError();
  } else if(data.is.patch) {
    log.error('Error patching ' + path + ' on the server');
    handleUpstreamError();
  } else if(data.is.sourceList) {
    log.fatal('Fatal error, server could not generate source list');
  } else if(data.is.diffs) {
    log.error('Error generating diffs on the server for ' + path);
    handleDownstreamError();
  } else if(data.is.downstreamLocked) {
    log.error('Cannot downstream due to lock on ' + path + ' on the server');
    handleDownstreamError();
  } else if(data.is.verification) {
    log.fatal('Patch could not be verified due to incorrect patching on downstreaming ' + path + '. Possible file corruption.');
    handleDownstreamError();
  } else {
    log.fatal(data, 'Unknown error sent by the server');
  }
}

function handleMessage(syncManager, data) {
  try {
    data = JSON.parse(data);
    data = SyncMessage.parse(data);
  } catch(e) {
    return onError(syncManager, e);
  }

  if (data.is.request) {
    handleRequest(syncManager, data);
  } else if(data.is.response){
    handleResponse(syncManager, data);
  } else if(data.is.error){
    handleError(syncManager, data);
  } else {
    onError(syncManager, new Error('Cannot handle message'));
  }
}

module.exports = handleMessage;

},{"../../lib/constants":10,"../../lib/diff":11,"../../lib/fs-utils":14,"../../lib/rsync":17,"../../lib/syncmessage":21,"../../lib/util.js":22,"./logger.js":4}],6:[function(require,module,exports){
/**
 * An extended Filer FileSystem with wrapped methods
 * for writing that manage file metadata (xattribs)
 * reflecting sync state.
 */

var Filer = require('../../lib/filer.js');
var Shell = require('../../lib/filer-shell.js');
var fsUtils = require('../../lib/fs-utils.js');
var conflict = require('../../lib/conflict.js');
var syncTypes = require('../../lib/constants.js').syncTypes;
var findPathIndexInArray = require('../../lib/util.js').findPathIndexInArray;
var log = require('./logger.js');

function SyncFileSystem(fs) {
  var self = this;
  var root = '/';
  // Record changes during a downstream sync
  // Is a parallel array with sourceListCache
  var trackedPaths = [];
  var sourceListCache = [];
  var changesDuringDownstream = [];

  // Expose the root used to sync for the filesystem
  // Defaults to '/'
  Object.defineProperties(self, {
    'root': {
      get: function() { return root; }
    },
    'changesDuringDownstream': {
      get: function() { return changesDuringDownstream; }
    }
  });

  // Watch the given path for any changes made to it and cache
  // the source list for that path
  self.trackChanges = function(path, sourceList) {
    trackedPaths.push(path);
    sourceListCache.push(sourceList);
  };

  // Stop watching the given paths for changes and return the
  // cached source list
  self.untrackChanges = function(path) {
    var indexInTrackedPaths = trackedPaths.indexOf(path);
    var indexInChangesDuringDownstream = changesDuringDownstream.indexOf(path);

    if(indexInTrackedPaths === -1) {
      log.error('Path ' + path + ' not found in tracked paths list');
      return null;
    }

    trackedPaths.splice(indexInTrackedPaths, 1);

    if(indexInChangesDuringDownstream !== -1) {
      changesDuringDownstream.splice(changesDuringDownstream.indexOf(path), 1);
    }

    return sourceListCache.splice(indexInTrackedPaths, 1)[0];
  };

  // Get the paths queued up to sync
  self.getPathsToSync = function(callback) {
    fsUtils.getPathsToSync(fs, root, function(err, pathsToSync) {
      if(err) {
        return callback(err);
      }

      callback(null, pathsToSync && pathsToSync.toSync);
    });
  };

  // Add paths to the sync queue where paths is an array
  self.appendPathsToSync = function(paths, callback) {
    if(!paths || !paths.length) {
      return callback();
    }

    var syncPaths = [];

    paths.forEach(function(pathObj) {
      var syncObj = pathObj.path ? pathObj : {path: pathObj, type: syncTypes.CREATE};
      if(syncObj.path.indexOf(root) === 0) {
        syncPaths.push(syncObj);
      }
    });

    fsUtils.getPathsToSync(fs, root, function(err, pathsToSync) {
      if(err) {
        return callback(err);
      }

      pathsToSync = pathsToSync || {};
      pathsToSync.toSync = pathsToSync.toSync || [];
      var toSync = pathsToSync.toSync;

      syncPaths.forEach(function(syncObj) {
        // Ignore redundancies
        var exists = !(toSync.every(function(objToSync) {
          return objToSync.path !== syncObj.path;
        }));

        if(!exists) {
          pathsToSync.toSync.push(syncObj);
        }
      });

      fsUtils.setPathsToSync(fs, root, pathsToSync, callback);
    });
  };

  // Get the path that was modified during a sync
  self.getModifiedPath = function(callback) {
    fsUtils.getPathsToSync(fs, root, function(err, pathsToSync) {
      if(err) {
        return callback(err);
      }

      callback(null, pathsToSync && pathsToSync.modified);
    });
  };

  // Indicate that the path at the front of the queue has
  // begun syncing
  self.setSyncing = function(callback) {
    fsUtils.getPathsToSync(fs, root, function(err, pathsToSync) {
      if(err) {
        return callback(err);
      }

      if(!pathsToSync || !pathsToSync.toSync || !pathsToSync.toSync[0]) {
        log.warn('setSyncing() called when no paths to sync present');
        return callback();
      }

      pathsToSync.toSync[0].syncing = true;

      callback();
    });
  };

  // Delay the sync of the currently syncing path
  // by moving it to the end of the sync queue
  self.delaySync = function(callback) {
    fsUtils.getPathsToSync(fs, root, function(err, pathsToSync) {
      if(err) {
        return callback(err);
      }

      if(!pathsToSync || !pathsToSync.toSync || !pathsToSync.toSync[0]) {
        log.warn('delaySync() called when no paths to sync present');
        return callback();
      }

      var delayedSync = pathsToSync.toSync.shift();
      pathsToSync.toSync.push(delayedSync);
      delete pathsToSync.modified;

      fsUtils.setPathsToSync(fs, root, pathsToSync, function(err) {
        if(err) {
          return callback(err);
        }

        callback(null, delayedSync.path);
      });
    });
  };

  // Remove the path that was just synced
  self.dequeueSync = function(callback) {
    fsUtils.getPathsToSync(fs, root, function(err, pathsToSync) {
      if(err) {
        return callback(err);
      }

      if(!pathsToSync || !pathsToSync.toSync || !pathsToSync.toSync[0]) {
        log.warn('dequeueSync() called when no paths to sync present');
        return callback();
      }

      var removedSync = pathsToSync.toSync.shift();
      if(!pathsToSync.toSync.length) {
        delete pathsToSync.toSync;
      }
      delete pathsToSync.modified;

      fsUtils.setPathsToSync(fs, root, pathsToSync, function(err) {
        if(err) {
          return callback(err);
        }

        callback(null, pathsToSync.toSync, removedSync.path);
      });
    });
  };

  // Set the sync root for the filesystem.
  // The path provided must name an existing directory
  // or the setter will fail.
  // Once the new root is set, the paths remaining to
  // sync and the path that was modified during a sync
  // are filtered out if they are not under the new root.
  self.setRoot = function(newRoot, callback) {
    function containsRoot(pathOrObj) {
      if(typeof pathOrObj === 'object') {
        pathOrObj = pathOrObj.path || '';
      }

      return pathOrObj.indexOf(newRoot) === 0;
    }

    fs.lstat(newRoot, function(err, stats) {
      if(err) {
        return callback(err);
      }

      if(!stats.isDirectory()) {
        return callback(new Filer.Errors.ENOTDIR('the given root is not a directory', newRoot));
      }

      fsUtils.getPathsToSync(fs, root, function(err, pathsToSync) {
        if(err) {
          return callback(err);
        }

        root = newRoot;

        if(!pathsToSync) {
          return callback();
        }

        if(pathsToSync.toSync) {
          pathsToSync.toSync = pathsToSync.toSync.filter(containsRoot);

          if(!pathsToSync.toSync.length) {
            delete pathsToSync.toSync;
          }
        }

        if(pathsToSync.modified && !containsRoot(pathsToSync.modified)) {
          delete pathsToSync.modified;
        }

        callback();
      });
    });
  };

  // The following non-modifying fs operations can be run as normal,
  // and are simply forwarded to the fs instance. NOTE: we have
  // included setting xattributes since we don't sync these to the server (yet).
  ['stat', 'fstat', 'lstat', 'exists', 'readlink', 'realpath',
   'readdir', 'open', 'close', 'fsync', 'read', 'readFile',
   'setxattr', 'fsetxattr', 'getxattr', 'fgetxattr', 'removexattr',
   'fremovexattr', 'watch'].forEach(function(method) {
     self[method] = function() {
       fs[method].apply(fs, arguments);
     };
  });

  function fsetUnsynced(fd, callback) {
    fsUtils.fsetUnsynced(fs, fd, callback);
  }

  function setUnsynced(path, callback) {
    fsUtils.setUnsynced(fs, path, callback);
  }

  // We wrap all fs methods that modify the filesystem in some way that matters
  // for syncing (i.e., changes we need to sync back to the server), such that we
  // can track things. Different fs methods need to do this in slighly different ways,
  // but the overall logic is the same.  The wrapMethod() fn defines this logic.
  function wrapMethod(method, pathArgPos, setUnsyncedFn, type) {
    return function() {
      var args = Array.prototype.slice.call(arguments, 0);
      var lastIdx = args.length - 1;
      var callback = args[lastIdx];

      // Grab the path or fd so we can use it to set the xattribute.
      // Most methods take `path` or `fd` as the first arg, but it's
      // second for some.
      var pathOrFD = args[pathArgPos];

      function wrappedCallback() {
        var args = Array.prototype.slice.call(arguments, 0);
        if(args[0] || type === syncTypes.DELETE) {
          return callback.apply(null, args);
        }

        setUnsyncedFn(pathOrFD, function(err) {
          if(err) {
            return callback(err);
          }
          callback.apply(null, args);
        });
      }

      args[lastIdx] = wrappedCallback;

      if(type === syncTypes.DELETE && pathOrFD === root) {
        // Deal with deletion of the sync root
        // https://github.com/mozilla/makedrive/issues/465
        log.warn('Tried to delete the sync root ' + root);
      }

      // Don't record extra sync-level details about modifications to an
      // existing conflicted copy, since we don't sync them.
      conflict.isConflictedCopy(fs, pathOrFD, function(err, conflicted) {
        // Deal with errors other than the path not existing (this fs
        // call might be creating it, in which case it's also not conflicted).
        if(err && err.code !== 'ENOENT') {
          return callback.apply(null, [err]);
        }

        conflicted = !!conflicted;

        // Check to see if it is a path or an open file descriptor
        // and do not record the path if it is not contained
        // in the specified syncing root of the filesystem, or if it is conflicted.
        // TODO: Deal with a case of fs.open for a path with a write flag
        // https://github.com/mozilla/makedrive/issues/210.
        if(fs.openFiles[pathOrFD] || pathOrFD.indexOf(root) !== 0 || conflicted) {
          fs[method].apply(fs, args);
          return;
        }

        if(trackedPaths.indexOf(pathOrFD) !== -1 && self.changesDuringDownstream.indexOf(pathOrFD) === -1) {
          self.changesDuringDownstream.push(pathOrFD);
        }

        // Queue the path for syncing in the pathsToSync
        // xattr on the sync root
        fsUtils.getPathsToSync(fs, root, function(err, pathsToSync) {
          if(err) {
            return callback(err);
          }

          var syncPath = {
            path: pathOrFD,
            type: type
          };
          if(type === syncTypes.RENAME) {
            syncPath.oldPath = args[pathArgPos - 1];
          }
          var indexInPathsToSync;


          pathsToSync = pathsToSync || {};
          pathsToSync.toSync = pathsToSync.toSync || [];
          indexInPathsToSync = findPathIndexInArray(pathsToSync.toSync, pathOrFD);

          if(indexInPathsToSync === 0 && pathsToSync.toSync[0].syncing) {
            // If at the top of pathsToSync, the path is
            // currently syncing so change the modified path
            pathsToSync.modified = pathOrFD;
          } else if(indexInPathsToSync === -1) {
            pathsToSync.toSync.push(syncPath);
          }

          fsUtils.setPathsToSync(fs, root, pathsToSync, function(err) {
            if(err) {
              return callback(err);
            }

            fs[method].apply(fs, args);
          });
        });
      });
    };
  }

  // Wrapped fs methods that have path at first arg position and use paths
  ['truncate', 'mknod', 'mkdir', 'utimes', 'writeFile',
   'appendFile'].forEach(function(method) {
     self[method] = wrapMethod(method, 0, setUnsynced, syncTypes.CREATE);
  });

  // Wrapped fs methods that have path at second arg position
  ['link', 'symlink'].forEach(function(method) {
    self[method] = wrapMethod(method, 1, setUnsynced, syncTypes.CREATE);
  });

  // Wrapped fs methods that have path at second arg position
  ['rename'].forEach(function(method) {
    self[method] = wrapMethod(method, 1, setUnsynced, syncTypes.RENAME);
  });

  // Wrapped fs methods that use file descriptors
  ['ftruncate', 'futimes', 'write'].forEach(function(method) {
    self[method] = wrapMethod(method, 0, fsetUnsynced, syncTypes.CREATE);
  });

  // Wrapped fs methods that have path at first arg position
  ['rmdir', 'unlink'].forEach(function(method) {
    self[method] = wrapMethod(method, 0, setUnsynced, syncTypes.DELETE);
  });

  // We also want to do extra work in the case of a rename.
  // If a file is a conflicted copy, and a rename is done,
  // remove the conflict.
  var rename = self.rename;
  self.rename = function(oldPath, newPath, callback) {
    rename(oldPath, newPath, function(err) {
      if(err) {
        return callback(err);
      }

      conflict.isConflictedCopy(fs, newPath, function(err, conflicted) {
        if(err) {
          return callback(err);
        }

        if(!conflicted) {
          return callback();
        }

        conflict.removeFileConflict(fs, newPath, function(err) {
          if(err) {
            return callback(err);
          }

          fsUtils.getPathsToSync(fs, root, function(err, pathsToSync) {
            var indexInPathsToSync;
            var syncInfo;

            if(err) {
              return callback(err);
            }

            indexInPathsToSync = findPathIndexInArray(pathsToSync.toSync, newPath);

            if(indexInPathsToSync === -1) {
              return;
            }

            syncInfo = pathsToSync.toSync[indexInPathsToSync];
            syncInfo.type = syncTypes.CREATE;
            delete syncInfo.oldPath;
            pathsToSync.toSync[indexInPathsToSync] = syncInfo;

            fsUtils.setPathsToSync(fs, root, pathsToSync, callback);
          });
        });
      });
    });
  };

  // Expose fs.Shell() but use wrapped sync filesystem instance vs fs.
  // This is a bit brittle, but since Filer doesn't expose the Shell()
  // directly, we deal with it by doing a deep require into Filer's code
  // ourselves. The other down side of this is that we're now including
  // the Shell code twice (once in filer.js, once here). We need to
  // optimize this when we look at making MakeDrive smaller.
  self.Shell = Shell.bind(undefined, self);

  // Expose extra operations for checking whether path/fd is unsynced
  self.getUnsynced = function(path, callback) {
    fsUtils.getUnsynced(fs, path, callback);
  };
  self.fgetUnsynced = function(fd, callback) {
    fsUtils.fgetUnsynced(fs, fd, callback);
  };
}

module.exports = SyncFileSystem;

},{"../../lib/conflict.js":9,"../../lib/constants.js":10,"../../lib/filer-shell.js":12,"../../lib/filer.js":13,"../../lib/fs-utils.js":14,"../../lib/util.js":22,"./logger.js":4}],7:[function(require,module,exports){
var SyncMessage = require( '../../lib/syncmessage' ),
    messageHandler = require('./message-handler'),
    WS = require('ws'),
    request = require('request'),
    url = require('url'),
    log = require('./logger.js');

function SyncManager(sync, fs, _fs) {
  var manager = this;

  manager.sync = sync;
  manager.fs = fs;
  manager.rawFs = _fs;
  manager.downstreams = [];
  manager.needsUpstream = [];
}

SyncManager.prototype.init = function(wsUrl, token, options, callback) {
  var manager = this;
  var sync = manager.sync;
  var reconnectCounter = 0;
  var socket;
  var timeout;

  function handleAuth(event) {
    var data = event.data || event;
    try {
      data = JSON.parse(data);
      data = SyncMessage.parse(data);
    } catch(e) {
      return callback(e);
    }

    if(data.is.response && data.is.authz) {
      socket.onmessage = function(event) {
        var data = event.data || event;
        messageHandler(manager, data);
      };
      manager.send(SyncMessage.response.authz.stringify());

      callback();
    } else {
      callback(new Error('Cannot handle message'));
    }
  }

  function handleClose(info) {
    var reason = info.reason || 'WebSocket closed unexpectedly';
    var error = new Error(info.code + ': ' + reason);

    manager.close();
    manager.socket = null;

    sync.onError(error);
    sync.onDisconnected();
  }

  // Reconnecting WebSocket options
  var reconnectAttempts;
  var reconnectionDelay;
  var reconnectionDelayMax;

  if(options.autoReconnect) {
    reconnectAttempts = options.reconnectAttempts ? options.reconnectAttempts : Math.Infinity;
    reconnectionDelay = options.reconnectionDelay ? options.reconnectionDelay : 1000;
    reconnectionDelayMax = options.reconnectionDelayMax ? options.reconnectionDelayMax : 5000;
  }

  function getToken(callback) {
    var apiSyncURL;
    try {
      apiSyncURL = url.parse(wsUrl);
    } catch(err) {
      sync.onError(err);
    }
    apiSyncURL.protocol = apiSyncURL.protocol === 'wss:' ? 'https:' : 'http:';
    apiSyncURL.pathname = "api/sync";
    apiSyncURL = url.format(apiSyncURL);

    request({
      url: apiSyncURL,
      method: 'GET',
      json: true,
      withCredentials: true
    }, function(err, msg, body) {
      var statusCode;
      var error;

      statusCode = msg && msg.statusCode;
      error = statusCode !== 200 ?
        { message: err || 'Unable to get token', code: statusCode } : null;

      if(error) {
        sync.onError(error);
      } else{
        callback(body);
      }
    });
  }

  function connect(reconnecting) {
    clearTimeout(timeout);
    socket = new WS(wsUrl);
    socket.onmessage = handleAuth;
    socket.onopen = function() {
      manager.socket = socket;
      reconnectCounter = 0;
      // We checking for `reconnecting` to see if this is their first time connecting to
      // WebSocket and have provided us with a valid token. Otherwise this is a reconnecting
      // to WebSocket and we will retrieve a new valid token.
      if(!reconnecting && token) {
        manager.send(JSON.stringify({token: token}));
      } else {
        getToken(function(token) {
          manager.send(JSON.stringify({token: token}));
        });
      }
    };
    if(options.autoReconnect) {
      socket.onclose = function() {
        // Clean up after WebSocket closed.
        socket.onclose = function(){};
        socket.close();
        socket = null;
        manager.socket = null;

        // We only want to emit an error once.
        if(reconnectCounter === 0) {
          var error = new Error('WebSocket closed unexpectedly');
          sync.onError(error);
          sync.onDisconnected();
        }

        if(reconnectAttempts < reconnectCounter) {
          sync.emit('reconnect_failed');
        } else {
          var delay = reconnectCounter * reconnectionDelay;
          delay = Math.min(delay, reconnectionDelayMax);
          timeout = setTimeout(function () {
            reconnectCounter++;
            sync.emit('reconnecting');
            connect(true);
          }, delay);
        }
      };
    } else {
      socket.onclose = handleClose;
    }
  }
  connect();
};

SyncManager.prototype.syncUpstream = function() {
  var manager = this;
  var fs = manager.fs;
  var sync = manager.sync;
  var syncRequest;
  var syncInfo;

  if(!manager.socket) {
    throw new Error('sync called before init');
  }

  if(manager.currentSync) {
    sync.onError(new Error('Sync currently underway'));
    return;
  }

  fs.getPathsToSync(function(err, pathsToSync) {
    if(err) {
      sync.onError(err);
      return;
    }

    if(!pathsToSync || !pathsToSync.length) {
      log.warn('Nothing to sync');
      sync.onIdle('No changes made to the filesystem');
      return;
    }

    syncInfo = pathsToSync[0];

    fs.setSyncing(function(err) {
      if(err) {
        sync.onError(err);
        return;
      }

      manager.currentSync = syncInfo;
      syncRequest = SyncMessage.request.sync;
      syncRequest.content = {path: syncInfo.path, type: syncInfo.type};
      if(syncInfo.oldPath) {
        syncRequest.content.oldPath = syncInfo.oldPath;
      }
      manager.send(syncRequest.stringify());
    });
  });
};

SyncManager.prototype.syncNext = function(syncedPath) {
  var manager = this;
  var fs = manager.fs;
  var sync = manager.sync;

  fs.dequeueSync(function(err, syncsLeft, dequeuedSync) {
    if(err) {
      log.error('Failed to dequeue sync for ' + syncedPath + ' in SyncManager.syncNext()');
    }

    sync.onCompleted(dequeuedSync || syncedPath);
    manager.currentSync = false;
    manager.syncUpstream();
  });
};

SyncManager.prototype.close = function() {
  var manager = this;
  var socket = manager.socket;

  if(socket) {
    socket.onmessage = function(){};
    socket.onopen = function(){};

    if(socket.readyState === 1) {
      socket.onclose = function(){
        manager.socket = null;
      };
      socket.close();
    } else {
      manager.socket = null;
    }
  }
};

SyncManager.prototype.send = function(syncMessage) {
  var manager = this;
  var sync = manager.sync;
  var ws = manager.socket;

  if(!ws || ws.readyState !== ws.OPEN) {
    sync.onError(new Error('Socket state invalid for sending'));
  }

  try {
    ws.send(syncMessage);
  } catch(err) {
    // This will also emit an error.
    ws.close();
  }
};

module.exports = SyncManager;

},{"../../lib/syncmessage":21,"./logger.js":4,"./message-handler":5,"request":26,"url":1,"ws":2}],8:[function(require,module,exports){
// We're sharing Filer's same stripped-down version of async, in order to save space.
module.exports = require('../node_modules/filer/lib/async.js');

},{"../node_modules/filer/lib/async.js":28}],9:[function(require,module,exports){
/**
 * Utility functions for working with Conflicted Files.
 */
var Filer = require('./filer.js');
var Path = Filer.Path;
var constants = require('./constants.js');
var fsUtils = require('./fs-utils.js');

// Turn "/index.html" into "/index.html (Conflicted Copy 2014-07-23 12:00:00).html"
function generateConflictedPath(fs, path, callback) {
  var dirname = Path.dirname(path);
  var basename = Path.basename(path);
  var extname = Path.extname(path);

  var now = new Date();
  var dateStamp = now.getFullYear() + '-' +
        now.getMonth() + '-' +
        now.getDay() + ' ' +
        now.getHours() + ':' +
        now.getMinutes() + ':' +
        now.getSeconds();
  var conflictedCopy = ' (Conflicted Copy ' + dateStamp + ')';
  var conflictedPath = Path.join(dirname, basename + conflictedCopy + extname);

  // Copy the file using the conflicted filename. If there is
  // already a conflicted file, replace it with this one.
  fsUtils.forceCopy(fs, path, conflictedPath, function(err) {
    if(err) {
      return callback(err);
    }

    // Send the new path back on the callback
    callback(null, conflictedPath);
  });
}

function filenameContainsConflicted(path) {
  // Look for path to be a conflicted copy, e.g.,
  // /dir/index (Conflicted Copy 2014-07-23 12:00:00).html
  return /\(Conflicted Copy \d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{1,2}:\d{1,2}\)/.test(path);
}

// Is this a file descriptor (number)?
// Based on https://github.com/jquery/jquery/blob/c869a1ef8a031342e817a2c063179a787ff57239/src/core.js#L214
function isFD(obj) {
  return (obj - parseFloat(obj) + 1) >= 0;
}

function isConflictedCopy(fs, pathOrFD, callback) {
  // Figure out how to read the xattrib, via fd or path
  var method;
  if(isFD(pathOrFD)) {
    method = 'fgetxattr';
  } else {
    method = 'getxattr';
  }

  fs[method](pathOrFD, constants.attributes.conflict, function(err, value) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, !!value);
  });
}

function makeConflictedCopy(fs, path, callback) {
  fs.lstat(path, function(err, stats) {
    if(err) {
      return callback(err);
    }

    // If this is a dir, err now
    if(stats.isDirectory()) {
      return callback(new Filer.Errors.EISDIR('conflict not permitted on directory'));
    }

    // Otherwise, copy to a conflicted filename, and mark as makedrive-conflict
    generateConflictedPath(fs, path, function(err, conflictedPath) {
      if(err) {
        return callback(err);
      }
      fs.setxattr(conflictedPath, constants.attributes.conflict, true, function(err) {
        if(err) {
          return callback(err);
        }

        callback(null, conflictedPath);
      });
    });
  });
}

function removeFileConflict(fs, path, callback) {
  fs.removexattr(path, constants.attributes.conflict, function(err) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback();
  });
}

module.exports = {
  filenameContainsConflicted: filenameContainsConflicted,
  isConflictedCopy: isConflictedCopy,
  makeConflictedCopy: makeConflictedCopy,
  removeFileConflict: removeFileConflict
};

},{"./constants.js":10,"./filer.js":13,"./fs-utils.js":14}],10:[function(require,module,exports){
module.exports = {
  rsyncDefaults: {
    size: 5,
    time: true,
    recursive: false,
    superficial: true
  },

  attributes: {
    unsynced: 'makedrive-unsynced',
    conflict: 'makedrive-conflict',
    checksum: 'makedrive-checksum',
    partial:  'makedrive-partial',
    pathsToSync: 'makedrive-pathsToSync'
  },

  // Sync Type constants
  syncTypes: {
    CREATE: 'create',
    RENAME: 'rename',
    DELETE: 'delete'
  },

  server: {
    syncChannel: 'makedrive-sync',
    lockRequestChannel: 'makedrive-lock-request',
    lockResponseChannel: 'makedrive-lock-response',
    states: {
      CREATED: 'CREATED',
      CLOSED: 'CLOSED',
      CLOSING: 'CLOSING',
      CONNECTING: 'CONNECTING',
      LISTENING: 'LISTENING',
      INIT: 'INIT',
      OUT_OF_DATE: 'OUT_OF_DATE',
      SYNCING: 'SYNCING',
      CHKSUM: 'CHKSUM',
      PATCH: 'PATCH',
      ERROR: 'ERROR'
    }
  }
};

},{}],11:[function(require,module,exports){
/**
 * Functions to process lists of Node Diff objects (i.e.,
 * diffs of files, folders). A Node Diff object takes the
 * following form:
 *
 * // Node Diff for a file
 * {
 *   modified: 1404926919696,
 *   path: 'index.html',
 *   diffs: [
 *     {
 *       length: 56,
 *       index: 17,
 *       data: Buffer([...])
 *     },
 *     ...
 *   ]
 * }
 */

 var Buffer = require('./filer.js').Buffer;

function processNodeDiff(nodeDiff, processDataFn) {
  // Check if this is a directory or file, process, and return
  if(nodeDiff.diffs) {
    nodeDiff.diffs = nodeDiff.diffs.map(function(diff) {
      diff.data = processDataFn(diff.data);
      return diff;
    });
  }

  return nodeDiff;
}

function bufferToJSON(data) {
  if(!Buffer.isBuffer(data)) {
    return data;
  }
  var json = data.toJSON();
  // Note: when we're in node.js, json will be the raw array.
  // In browserify it will be {type:'Buffer', data:[...]}
  return json.data || json;
}

function jsonToBuffer(data) {
  return new Buffer(data);
}

function processFn(nodeDiffs, processDataFn) {
  if(!nodeDiffs.length) {
    return nodeDiffs;
  }
  return nodeDiffs.map(function(nodeDiff){
    return processNodeDiff(nodeDiff, processDataFn);
  });
}

module.exports.serialize = function(nodeDiffs) {
  return processFn(nodeDiffs, bufferToJSON);
};

module.exports.deserialize = function(nodeDiffs) {
  return processFn(nodeDiffs, jsonToBuffer);
};

},{"./filer.js":13}],12:[function(require,module,exports){
// Filer doesn't expose the Shell() ctor directly, so provide a shortcut.
// See client/src/sync-filesystem.js
module.exports = require('../node_modules/filer/src/shell/shell.js');

},{"../node_modules/filer/src/shell/shell.js":54}],13:[function(require,module,exports){
module.exports = require('filer');

},{"filer":44}],14:[function(require,module,exports){
/**
 * Extra common fs operations we do throughout MakeDrive.
 */
var constants = require('./constants.js');

// See if a given path a) exists, and whether it is marked with an xattr.
function hasAttr(fs, path, attr, callback) {
  fs.getxattr(path, attr, function(err, attrVal) {
    // File doesn't exist locally at all
    if(err && err.code === 'ENOENT') {
      return callback(null, false);
    }

    // Deal with unexpected error
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, !!attrVal);
  });
}

// Remove the metadata from a path or file descriptor
function removeAttr(fs, pathOrFd, attr, isFd, callback) {
  var removeFn = 'fremovexattr';

  if(isFd !== true) {
    callback = isFd;
    removeFn = 'removexattr';
  }

  fs[removeFn](pathOrFd, attr, function(err) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback();
  });
}

// Get the metadata for a path or file descriptor
function getAttr(fs, pathOrFd, attr, isFd, callback) {
  var getFn = 'fgetxattr';

  if(isFd !== true) {
    callback = isFd;
    getFn = 'getxattr';
  }

  fs[getFn](pathOrFd, attr, function(err, value) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, value);
  });
}

// copy oldPath to newPath, deleting newPath if it exists
function forceCopy(fs, oldPath, newPath, callback) {
  fs.unlink(newPath, function(err) {
    if(err && err.code !== 'ENOENT') {
      return callback(err);
    }

    fs.readFile(oldPath, function(err, buf) {
      if(err) {
        return callback(err);
      }

      fs.writeFile(newPath, buf, callback);
    });
  });
}

// See if a given path a) exists, and whether it is marked unsynced.
function isPathUnsynced(fs, path, callback) {
  hasAttr(fs, path, constants.attributes.unsynced, callback);
}

// Remove the unsynced metadata from a path
function removeUnsynced(fs, path, callback) {
  removeAttr(fs, path, constants.attributes.unsynced, callback);
}
function fremoveUnsynced(fs, fd, callback) {
  removeAttr(fs, fd, constants.attributes.unsynced, true, callback);
}

// Set the unsynced metadata for a path
function setUnsynced(fs, path, callback) {
  fs.setxattr(path, constants.attributes.unsynced, Date.now(), callback);
}
function fsetUnsynced(fs, fd, callback) {
  fs.fsetxattr(fd, constants.attributes.unsynced, Date.now(), callback);
}

// Get the unsynced metadata for a path
function getUnsynced(fs, path, callback) {
  getAttr(fs, path, constants.attributes.unsynced, callback);
}
function fgetUnsynced(fs, fd, callback) {
  getAttr(fs, fd, constants.attributes.unsynced, true, callback);
}

// Remove the Checksum metadata from a path
function removeChecksum(fs, path, callback) {
  removeAttr(fs, path, constants.attributes.checksum, callback);
}
function fremoveChecksum(fs, fd, callback) {
  removeAttr(fs, fd, constants.attributes.checksum, true, callback);
}

// Set the Checksum metadata for a path
function setChecksum(fs, path, checksum, callback) {
  fs.setxattr(path, constants.attributes.checksum, checksum, callback);
}
function fsetChecksum(fs, fd, checksum, callback) {
  fs.fsetxattr(fd, constants.attributes.checksum, checksum, callback);
}

// Get the Checksum metadata for a path
function getChecksum(fs, path, callback) {
  getAttr(fs, path, constants.attributes.checksum, callback);
}
function fgetChecksum(fs, fd, callback) {
  getAttr(fs, fd, constants.attributes.checksum, true, callback);
}

// See if a given path a) exists, and whether it is marked partial.
function isPathPartial(fs, path, callback) {
  hasAttr(fs, path, constants.attributes.partial, callback);
}

// Remove the partial metadata from a path
function removePartial(fs, path, callback) {
  removeAttr(fs, path, constants.attributes.partial, callback);
}
function fremovePartial(fs, fd, callback) {
  removeAttr(fs, fd, constants.attributes.partial, true, callback);
}

// Set the partial metadata for a path
function setPartial(fs, path, nodeCount, callback) {
  fs.setxattr(path, constants.attributes.partial, nodeCount, callback);
}
function fsetPartial(fs, fd, nodeCount, callback) {
  fs.fsetxattr(fd, constants.attributes.partial, nodeCount, callback);
}

// Get the partial metadata for a path
function getPartial(fs, path, callback) {
  getAttr(fs, path, constants.attributes.partial, callback);
}
function fgetPartial(fs, fd, callback) {
  getAttr(fs, fd, constants.attributes.partial, true, callback);
}

// Set the pathsToSync metadata for a path
function setPathsToSync(fs, path, pathsToSync, callback) {
  fs.setxattr(path, constants.attributes.pathsToSync, pathsToSync, callback);
}
function fsetPathsToSync(fs, fd, pathsToSync, callback) {
  fs.fsetxattr(fd, constants.attributes.pathsToSync, pathsToSync, callback);
}

// Get the pathsToSync metadata for a path
function getPathsToSync(fs, path, callback) {
  getAttr(fs, path, constants.attributes.pathsToSync, callback);
}
function fgetPathsToSync(fs, fd, callback) {
  getAttr(fs, fd, constants.attributes.pathsToSync, true, callback);
}

module.exports = {
  forceCopy: forceCopy,

  // Unsynced attr utils
  isPathUnsynced: isPathUnsynced,
  removeUnsynced: removeUnsynced,
  fremoveUnsynced: fremoveUnsynced,
  setUnsynced: setUnsynced,
  fsetUnsynced: fsetUnsynced,
  getUnsynced: getUnsynced,
  fgetUnsynced: fgetUnsynced,

  // Checksum attr utils
  removeChecksum: removeChecksum,
  fremoveChecksum: fremoveChecksum,
  setChecksum: setChecksum,
  fsetChecksum: fsetChecksum,
  getChecksum: getChecksum,
  fgetChecksum: fgetChecksum,

  // Partial attr utils
  isPathPartial: isPathPartial,
  removePartial: removePartial,
  fremovePartial: fremovePartial,
  setPartial: setPartial,
  fsetPartial: fsetPartial,
  getPartial: getPartial,
  fgetPartial: fgetPartial,

  // Paths to sync utils
  setPathsToSync: setPathsToSync,
  fsetPathsToSync: fsetPathsToSync,
  getPathsToSync: getPathsToSync,
  fgetPathsToSync: fgetPathsToSync
};

},{"./constants.js":10}],15:[function(require,module,exports){
var rsyncUtils = require('./rsync-utils');
var async = require('../async-lite');

// Generate checksums for every source node in a given destination path
module.exports = function checksums(fs, path, srcList, options, callback) {
  callback = rsyncUtils.findCallback(callback, options);

  var paramError = rsyncUtils.validateParams(fs, path);
  if(paramError) {
    return callback(paramError);
  }

  options = rsyncUtils.configureOptions(options);

  var checksumList = [];

  function ChecksumNode(path, type) {
    this.path = path;
    this.type = type;
  }

  function checksumsForFile(checksumNode, sourceNode, callback) {

    function generateChecksumsForFile() {
      rsyncUtils.blockChecksums(fs, sourceNode.path, options.size, function(err, checksums) {
        if(err) {
          return callback(err);
        }

        checksumNode.checksums = checksums;
        checksumNode.modified = sourceNode.modified;
        checksumList.push(checksumNode);
        
        callback();
      });
    }

    // Checksums are always calculated even for identical files
    // if and only if checksums are turned on and rsync is not
    // implemented recursively
    if(options.checksum && !options.recursive) {
      return generateChecksumsForFile();
    }

    // Skip identical files if checksums are turned off or
    // if rsync is performed recursively
    fs.stat(sourceNode.path, function(err, stat) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      // Add the 'identical' flag if the modified time and size
      // of the existing file match
      if(stat && stat.mtime === sourceNode.modified && stat.size === sourceNode.size) {
        checksumNode.checksums = [];
        checksumNode.modified = sourceNode.modified;
        checksumNode.identical = true;
        checksumList.push(checksumNode);
        
        return callback();
      }

      generateChecksumsForFile();
    });
  }

  function checksumsForLink(checksumNode, sourceNode, callback) {

    function generateChecksumsForLink() {
      fs.readlink(sourceNode.path, function(err, linkContents) {
        if(err) {
          return callback(err);
        }

        rsyncUtils.blockChecksums(fs, linkContents, options.size, function(err, checksums) {
          if(err) {
            return callback(err);
          }

          checksumNode.checksums = checksums;
          checksumList.push(checksumNode);
          
          callback();
        });
      });
    }

    // Checksums are always calculated even for identical links
    // if and only if checksums are turned on and rsync is not
    // implemented recursively
    if(options.checksum && !options.recursive) {
      checksumList.push(checksumNode);
      
      return callback();
    }

    // Skip identical links if checksums are turned off or
    // if rsync is performed recursively
    fs.stat(sourceNode.path, function(err, stat) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      // Add `identical` if the modified time and size of the existing file match
      if(stat && stat.mtime === sourceNode.modified && stat.size === sourceNode.size) {
        checksumNode.identical = true;
        checksumList.push(checksumNode);
        
        return callback();
      } 

      // Link does not exist i.e. no checksums
      if(err && err.code === 'ENOENT') {
        checksumList.push(checksumNode);
        
        return callback();
      }

      // Link exists and is not identical to the source link
      generateChecksumsForLink();
    });
  }

  function checksumsForDir(checksumNode, callback) {
    checksumNode.checksums = [];
    checksumList.push(checksumNode);

    callback();
  }

  function getChecksumsForSourceNode(sourceNode, callback) {
    var sourceNodeType = sourceNode.type;
    var checksumNode = new ChecksumNode(sourceNode.path, sourceNodeType);

    // Directory
    if(sourceNodeType === 'DIRECTORY') {
      return checksumsForDir(checksumNode, callback);
    }

    // Link
    if(sourceNodeType === 'SYMLINK' && options.links){
      checksumNode.link = true;
      
      return checksumsForLink(checksumNode, sourceNode, callback);
    }

    // File or Links treated as files
    checksumsForFile(checksumNode, sourceNode, callback);
  }

  async.eachSeries(srcList, getChecksumsForSourceNode, function(err) {
    if(err) {
      callback(err);
    } else {
      callback(null, checksumList);
    }
  });
};

},{"../async-lite":8,"./rsync-utils":19}],16:[function(require,module,exports){
var Errors = require('../filer').Errors;
var rsyncUtils = require('./rsync-utils');
var async = require('../async-lite');

// Generate diffs from the source based on destination checksums
module.exports = function diff(fs, path, checksumList, options, callback) {
  callback = rsyncUtils.findCallback(callback, options);

  var paramError = rsyncUtils.validateParams(fs, path);
  if(paramError) {
    return callback(paramError);
  }

  options = rsyncUtils.configureOptions(options);

  if(options.checksum && !checksumList) {
    return callback(new Errors.EINVAL('Checksums must be provided'));
  }

  var diffList = [];

  function DiffNode(path, type, modifiedTime) {
    this.path = path;
    this.type = type;
    this.modified = modifiedTime;
  }

  // Compute the checksum for the file/link and
  // append it to the diffNode.
  function appendChecksum(diffNode, diffPath, callback) {
    rsyncUtils.getChecksum(fs, diffPath, function(err, checksum) {
      if(err) {
        return callback(err);
      }

      diffNode.checksum = checksum;
      diffList.push(diffNode);

      callback(null, diffList);
    });
  }

  function diffsForLink(checksumNode, callback) {
    var checksumNodePath = checksumNode.path;
    var diffNode = new DiffNode(checksumNodePath, checksumNode.type, checksumNode.modified);

    fs.readlink(checksumNodePath, function(err, linkContents) {
      if(err) {
        return callback(err);
      }

      diffNode.link = linkContents;

      // If links are enabled, contents of the node pointed
      // to by the link are ignored
      if(options.links) {
        diffList.push(diffNode);

        return callback(null, diffList);
      }

      // If links are disabled, diffs are generated for
      // the node pointed to by the link
      fs.readFile(linkContents, function(err, data) {
        if(err) {
          return callback(err);
        }

        diffNode.diffs = rsyncUtils.rollData(data, checksumNode.checksums, options.size);

        // If versions are enabled, add the checksum
        // field to the diffNode for version comparison
        if(options.versions) {
          return appendChecksum(diffNode, linkContents, callback);
        }

        diffList.push(diffNode);

        callback(null, diffList);
      });
    });
  }

  function diffsForFile(checksumNode, callback) {
    var checksumNodePath = checksumNode.path;
    var diffNode = new DiffNode(checksumNodePath, checksumNode.type, checksumNode.modified);

    // Identical files have empty diffs
    if(checksumNode.identical) {
      diffNode.diffs = [];
      diffList.push(diffNode);

      return callback(null, diffList);
    }

    fs.readFile(checksumNodePath, function(err, data) {
      if (err) {
        return callback(err);
      }

      diffNode.diffs = rsyncUtils.rollData(data, checksumNode.checksums, options.size);

      // If versions are enabled, add the checksum
      // field to the diffNode for version comparison
      if(options.versions) {
        return appendChecksum(diffNode, checksumNodePath, callback);
      }
      diffList.push(diffNode);

      callback(null, diffList);
    });
  }

  function diffsForDir() {

    function processDirContents(checksumNode, callback) {
      var checksumNodePath = checksumNode.path;
      var diffNode = new DiffNode(checksumNodePath, checksumNode.type);

      // Directory
      if(checksumNode.type === 'DIRECTORY') {
        diffNode.diffs = [];

        if(options.recursive) {
          diffList.push(diffNode);
          return callback();
        }

        // If syncing is not done recursively, determine
        // the number of nodes in the directory to indicate
        // that that many nodes still need to be synced
        return fs.readdir(checksumNodePath, function(err, entries) {
          if(err) {
            return callback(err);
          }

          diffNode.nodeList = entries || [];
          diffList.push(diffNode);

          return callback();
        });
      }

      // Link
      if (checksumNode.link) {
        return diffsForLink(checksumNode, callback);
      }

      // File
      diffsForFile(checksumNode, callback);
    }

    async.eachSeries(checksumList, processDirContents, function(err) {
      if(err) {
        return callback(err);
      }

      callback(null, diffList);
    });
  }

  // If there are no checksums to calculate diffs for, bail
  if(!checksumList.length) {
    return callback(null, diffList);
  }

  fs.lstat(path, function(err, stat) {
    if(err) {
      return callback(err);
    }

    // Directory
    if(stat.isDirectory()) {
      return diffsForDir();
    }

    // If the path was a file, clearly there was only one checksum
    // entry i.e. the length of checksumList will be 1 which will
    // be stored in checksumList[0]
    var checksumNode = checksumList[0];

    // File
    if(stat.isFile() || !options.links) {
      return diffsForFile(checksumNode, callback);
    }

    // Link
    diffsForLink(checksumNode, callback);
  });
};

},{"../async-lite":8,"../filer":13,"./rsync-utils":19}],17:[function(require,module,exports){
/* index.js
 * Implement rsync to sync between two Filer filesystems
 * Portions used from Node.js Anchor module
 * Copyright(c) 2011 Mihai Tomescu <matomesc@gmail.com>
 * Copyright(c) 2011 Tolga Tezel <tolgatezel11@gmail.com>
 * MIT Licensed
 * https://github.com/ttezel/anchor
*/

module.exports = {
  sourceList: require('./source-list'),
  checksums: require('./checksums'),
  diff: require('./diff'),
  patch: require('./patch'),
  utils: require('./rsync-utils')
};

},{"./checksums":15,"./diff":16,"./patch":18,"./rsync-utils":19,"./source-list":20}],18:[function(require,module,exports){
var fsUtils = require('../fs-utils');
var Filer = require('../filer');
var Buffer = Filer.Buffer;
var Path = Filer.Path;
var async = require('../async-lite');
var conflict = require('../conflict');
var rsyncUtils = require('./rsync-utils');

function extractPathsFromDiffs(diffs) {
  function getPath(diff) {
    return diff.path;
  }

  return diffs.map(getPath);
}

// This function has been taken from lodash
// Licensed under the MIT license
// https://github.com/lodash/lodash
function difference(arr, farr) {
  return arr.filter(function(v) {
    return farr.indexOf(v) === -1;
  });
}

// Patch the destination filesystem by applying diffs
module.exports = function patch(fs, path, diffList, options, callback) {
  callback = rsyncUtils.findCallback(callback, options);

  var paths = {
    synced: [],
    failed: [],
    needsUpstream: [],
    partial: []
  };
  var pathsToSync = extractPathsFromDiffs(diffList);

  var paramError = rsyncUtils.validateParams(fs, path);
  if(paramError) {
    return callback(paramError);
  }

  options = rsyncUtils.configureOptions(options);

  function handleError(err, callback) {
    // Determine the node paths for those that were not synced
    // by getting the difference between the paths that needed to
    // be synced and the paths that were synced
    var failedPaths = difference(pathsToSync, paths.synced);
    paths.failed = paths.failed.concat(failedPaths);

    callback(err, paths);
  }

  // Remove the nodes in the patched directory that are no longer
  // present in the source. The only exception to this is any file
  // locally that hasn't been synced to the server yet (i.e.,
  // we don't want to delete things in a downstream sync because they
  // don't exist upstream yet, since an upstream sync will add them).
  function removeDeletedNodes(path, callback) {

    function maybeUnlink(pathToDelete, stats, callback) {
      if(pathsToSync.indexOf(pathToDelete) !== -1) {
        return callback();
      }

      // Make sure this file isn't unsynced before deleting
      fsUtils.isPathUnsynced(fs, pathToDelete, function(err, unsynced) {
        if(err) {
          return handleError(err, callback);
        }

        if(unsynced) {
          // Don't delete
          return callback();
        }

        // Make sure this file isn't conflicted before deleting.
        // Conflicted copies will not be touched by rsync
        conflict.isConflictedCopy(fs, pathToDelete, function(err, conflicted) {
          if(err) {
            return handleError(err, callback);
          }

          if(conflicted) {
            // Don't delete
            return callback();
          }

          paths.synced.push(pathToDelete);

          if(stats.isDirectory()) {
            fs.rmdir(pathToDelete, callback);
          } else {
            fs.unlink(pathToDelete, callback);
          }
        });
      });
    }

    function processRemoval(subPath, callback) {
      var nodePath = Path.join(path, subPath);

      fs.lstat(nodePath, function(err, stats) {
        if(err) {
          return handleError(err, callback);
        }

        if(!stats.isDirectory()) {
          return maybeUnlink(nodePath, stats, callback);
        }

        removeDeletedNodes(nodePath, callback);
      });
    }

    function removeDeletedNodesInDir(dirContents, stats) {
      async.eachSeries(dirContents, processRemoval, function(err) {
        if(err) {
          return handleError(err, callback);
        }

        maybeUnlink(path, stats, function(err) {
          if(err) {
            return handleError(err, callback);
          }

          callback(null, paths);
        });
      });
    }

    fs.lstat(path, function(err, stats) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      // Bail if the path is a file/link or
      // the path does not exist, i.e. nothing was patched
      if((err && err.code === 'ENOENT') || !stats.isDirectory()) {
        return callback(null, paths);
      }

      fs.readdir(path, function(err, dirContents) {
        if(err) {
          return handleError(err, callback);
        }

        removeDeletedNodesInDir(dirContents, stats);
      });
    });
  }

  function updatePartialListInParent(nodePath, parent, callback) {
    // Now that the node has been synced,
    // update the parent directory's list of nodes
    // that still need to be synced
    fsUtils.getPartial(fs, parent, function(err, nodeList) {
      if(err) {
        return callback(err);
      }

      if(!nodeList) {
        return callback(null, paths);
      }

      nodeList.splice(nodeList.indexOf(nodePath), 1);

      // No more nodes left to be synced in the parent
      // remove the partial attribute
      if(!nodeList.length) {
        return fsUtils.removePartial(fs, parent, function(err) {
          if(err) {
            return callback(err);
          }

          callback(null, paths);
        });
      }

      // Update the parent's partial attribute with the remaining
      // nodes that need to be synced
      fsUtils.setPartial(fs, parent, nodeList, function(err) {
        if(err) {
          return callback(err);
        }

        callback(null, paths);
      });
    });
  }

  function maybeGenerateConflicted(nodePath, callback) {
    // If the file has not been synced upstream
    // and needs to be patched, create a conflicted copy
    fsUtils.isPathUnsynced(fs, nodePath, function(err, unsynced) {
      if(err) {
        return handleError(err, callback);
      }

      // Generate a conflicted copy only for an unsynced file
      if(!unsynced) {
        return callback();
      }

      conflict.makeConflictedCopy(fs, nodePath, function(err) {
        if(err) {
          return handleError(err, callback);
        }

        // Because we'll overwrite the file with upstream changes,
        // remove the unsynced attribute (local changes are in
        // the conflicted copy now).
        fsUtils.removeUnsynced(fs, nodePath, function(err) {
          if(err) {
            return handleError(err, callback);
          }

          callback();
        });
      });
    });
  }

  function patchFile(diffNode, callback) {
    var diffLength = diffNode.diffs ? diffNode.diffs.length : 0;
    var filePath = diffNode.path;

    // Compare the version of the file when it was last
    // synced with the version of the diffNode by comparing
    // checksums and modified times.
    // If they match, the file is not patched and needs to
    // be upstreamed
    function compareVersions(data) {
      fs.lstat(filePath, function(err, stats) {
        if(err) {
          return handleError(err, callback);
        }

        // If the file was modified before the
        // diffNode's modified time, the file is outdated
        // and needs to be patched
        if(stats.mtime <= diffNode.modified) {
          return applyPatch(getPatchedData(data));
        }

        fsUtils.getChecksum(fs, filePath, function(err, checksum) {
          if(err) {
            return handleError(err, callback);
          }

          // If the last synced checksum matches the
          // diffNode's checksum, ignore the patch
          // because it is a newer version than whats on
          // the server
          if(checksum === diffNode.checksum) {
            paths.needsUpstream.push(filePath);
            return updatePartialListInParent(filePath, Path.dirname(filePath), callback);
          }

          applyPatch(getPatchedData(data));
        });
      });
    }

    function updateModifiedTime() {
      fs.utimes(filePath, diffNode.modified, diffNode.modified, function(err) {
        if(err) {
          return handleError(err, callback);
        }

        paths.synced.push(filePath);
        updatePartialListInParent(filePath, Path.dirname(filePath), callback);
      });
    }

    function applyPatch(data) {
      // Before we alter the local file, make sure we don't
      // need a conflicted copy before proceeding.
      maybeGenerateConflicted(filePath, function(err) {
        if(err) {
          return handleError(err, callback);
        }

        fs.writeFile(filePath, data, function(err) {
          if(err) {
            return handleError(err, callback);
          }

          if(options.time) {
            return updateModifiedTime();
          }

          paths.synced.push(filePath);
          updatePartialListInParent(filePath, Path.dirname(filePath), callback);
        });
      });
    }

    function getPatchedData(rawData) {
      var blocks = [];
      var block, blockData;

      function getRawFileBlock(offsetIndex) {
        var start = offsetIndex * options.size;
        var end = start + options.size;
        end = end > rawData.length ? rawData.length : end;

        return rawData.slice(start, end);
      }

      // Loop through the diffs and construct a buffer representing
      // the file using a block of data from either the original
      // file itself or from the diff depending on which position
      // the diff needs to be inserted at
      for(var i = 0; i < diffLength; i++) {
        block = diffNode.diffs[i];
        blockData = block.data || getRawFileBlock(block.index);

        blocks.push(blockData);

        if(block.data && block.index) {
          blocks.push(getRawFileBlock(block.index));
        }
      }

      return Buffer.concat(blocks);
    }

    // Nothing to patch
    if(!diffLength) {
      paths.synced.push(filePath);
      return callback(null, paths);
    }

    fs.readFile(filePath, function(err, data) {
      if(err) {
        if(err.code !== 'ENOENT') {
          return handleError(err, callback);
        }

        // Patch a non-existent file i.e. create it
        return applyPatch(getPatchedData(new Buffer(0)));
      }

      // If version comparing is not enabled, apply
      // the patch directly
      if(!options.versions) {
        return applyPatch(getPatchedData(data));
      }

      // Check the last synced checksum with
      // the given checksum and don't patch if they
      // match
      compareVersions(data);
    });
  }

  function patchLink(diffNode, callback) {
    var linkPath = diffNode.path;

    // Patch the symbolic link as a file
    if(!options.links) {
      return patchFile(diffNode, callback);
    }

    fs.symlink(diffNode.link, linkPath, function(err){
      if(err) {
        return handleError(err, callback);
      }

      paths.synced.push(linkPath);

      updatePartialListInParent(linkPath, Path.dirname(linkPath), callback);
    });
  }

  function patchDir(diffNode, callback) {
    var dirPath = diffNode.path;

    fs.mkdir(dirPath, function(err) {
      if(err) {
        if(err.code !== 'EEXIST') {
          return handleError(err, callback);
        }

        paths.synced.push(dirPath);
        return callback(null, paths);
      }

      // Syncing is recursive so directory contents will
      // be subsequently synced and thus the directory is
      // not partial
      if(options.recursive) {
        paths.synced.push(dirPath);
        return callback(null, paths);
      }

      // Newly created directory will be marked as
      // partial to indicate that its contents still
      // need to be synced
      fsUtils.setPartial(fs, dirPath, diffNode.nodeList, function(err) {
        if(err) {
          return handleError(err, callback);
        }

        paths.synced.push(dirPath);
        paths.partial.push(dirPath);

        updatePartialListInParent(dirPath, Path.dirname(dirPath), callback);
      });
    });
  }

  function patchNode(diffNode, callback) {
    // Directory
    if(diffNode.type === 'DIRECTORY') {
      return patchDir(diffNode, callback);
    }

    // Symbolic link
    if(diffNode.type === 'SYMLINK') {
      return patchLink(diffNode, callback);
    }

    // File
    patchFile(diffNode, callback);
  }

  function applyDiffs(diffNode, callback) {
    createParentDirectories(diffNode.path, function(err) {
      if(err) {
        return callback(err);
      }

      patchNode(diffNode, callback);
    });
  }

  function processDiffList() {
    async.eachSeries(diffList, applyDiffs, function(err) {
      if(err) {
        return handleError(err, callback);
      }

      fsUtils.getPartial(fs, path, function(err, nodeList) {
        if(err) {
          return callback(err);
        }

        if(!nodeList || nodeList.length !== 0) {
          if(options.superficial) {
            return callback(null, paths);
          }

          return removeDeletedNodes(path, callback);
        }

        // Now that the immediate nodes in the directory
        // have been created or the directory has no nodes
        // in it, remove the partial attr if it exists
        fsUtils.removePartial(fs, path, function(err) {
          if(err) {
            return handleError(err, callback);
          }

          // Remove the directory entry whose contents have just
          // been synced, from the partial array
          paths.partial.splice(paths.partial.indexOf(path), 1);

          if(options.superficial) {
            callback(null, paths);
          } else {
            removeDeletedNodes(path, callback);
          }
        });
      });
    });
  }

  // Create any parent directories that do not exist
  function createParentDirectories(path, callback) {
    (new fs.Shell()).mkdirp(Path.dirname(path), function(err) {
      if(err && err.code !== 'EEXIST') {
        return callback(err);
      }

      callback();
    });
  }

  if(diffList && diffList.length) {
    return processDiffList();
  }

  createParentDirectories(path, function(err) {
    if(err && err !== 'EEXIST') {
      return callback(err, paths);
    }

    removeDeletedNodes(path, callback);
  });
};

},{"../async-lite":8,"../conflict":9,"../filer":13,"../fs-utils":14,"./rsync-utils":19}],19:[function(require,module,exports){
/*
 * Rsync utilities that include hashing
 * algorithms necessary for rsync and
 * checksum comparison algorithms to check
 * the equivalency of two file systems
 * as well as general validation functions
 *
 * Portions used from Node.js Anchor module
 * Copyright(c) 2011 Mihai Tomescu <matomesc@gmail.com>
 * Copyright(c) 2011 Tolga Tezel <tolgatezel11@gmail.com>
 * MIT Licensed
 * https://github.com/ttezel/anchor
*/

var MD5 = require('MD5');
var Filer = require('filer');
var Errors = Filer.Errors;
var Path = Filer.Path;
var async = require('../async-lite');
var fsUtils = require('../fs-utils');

// Rsync Options that can be passed are:
// size       -   the size of each chunk of data in bytes that should be checksumed
// checksum   -   true: always calculate checksums [default]
//                false: ignore checksums for identical files
// recursive  -   true: sync each contained node in the path provided
//                false: only sync the node for the path provided [default]
// time       -   true: sync modified times of source/destination files
//                false: do not change modified times of destination files [default]
// links      -   true: sync symbolic links as links in destination
//                false: sync symbolic links as the files they link to in destination [default]
// versions   -   true: do not sync a node if the last synced version matches the version it needs to be synced to [default]
//                false: sync nodes irrespective of the last synced version
// superficial-   true: if a directory path is provided, only sync the directory and not it's contents
//                false: if a directory path is provided, sync it's contents [default]
function configureOptions(options) {
  if(!options || typeof options === 'function') {
    options = {};
  }

  options.size = options.size || 512;
  options.checksum = options.checksum !== false;
  options.recursive = options.recursive || false;
  options.time = options.time || false;
  options.links = options.links || false;
  options.versions = options.versions !== false;
  options.superficial = options.superficial || false;

  return options;
}

// Set the callback in case options are not provided
function findCallback(callback, options) {
  if(!callback && typeof options === 'function') {
    callback = options;
  }

  return callback;
}

// Validate the parameters sent to each rsync method
function validateParams(fs, param2) {
  var err;

  if(!fs) {
    err = new Errors.EINVAL('No filesystem provided');
  } else if(!param2) {
    err = new Errors.EINVAL('Second argument must be specified');
  }

  return err;
}

// MD5 hashing for RSync
function md5sum(data) {
  return MD5(data).toString();
}

// Weak32 hashing for RSync based on Mark Adler's 32bit checksum algorithm
function calcWeak32(data, prev, start, end) {
  var a = 0;
  var b = 0;
  var M = 1 << 16;
  var N = 65521;

  if (!prev) {
    var len = (start >= 0 && end >= 0) ? (end - start + 1) : data.length;
    var datai;
    for (var i = 0; i < len; i++) {
      datai = data[i];
      a += datai;
      b += ((len - i) * datai);
    }

    a %= N;
    b %= N;
  } else {
    var k = start;
    var l = end - 1;
    var prev_k = k - 1;
    var prev_l = l - 1;
    var prev_first = data[prev_k];
    var curr_last = data[l];

    a = (prev.a - prev_first + curr_last) % N;
    b = (prev.b - (prev_l - prev_k + 1) * prev_first + a) % N;
  }
  return { a: a, b: b, sum: a + b * M };
}

// Weak16 hashing for RSync
function calcWeak16(data) {
  return 0xffff & (data >> 16 ^ data * 1009);
}

// RSync algorithm to create a hashtable from checksums
function createHashtable(checksums) {
  var hashtable = {};
  var len = checksums.length;
  var checksum;
  var weak16;

  for (var i = 0; i < len; i++) {
    checksum = checksums[i];
    weak16 = calcWeak16(checksum.weak);
    if (hashtable[weak16]) {
      hashtable[weak16].push(checksum);
    } else {
      hashtable[weak16] = [checksum];
    }
  }
  return hashtable;
}

// RSync algorithm to perform data rolling
function roll(data, checksums, blockSize) {
  var results = [];
  var hashtable = createHashtable(checksums);
  var length = data.length;
  var start = 0;
  var end = blockSize > length ? length : blockSize;
  // Updated when a block matches
  var lastMatchedEnd = 0;
  // This gets updated every iteration with the previous weak 32bit hash
  var prevRollingWeak = null;
  var weak;
  var weak16;
  var match;
  var d;
  var len;
  var mightMatch;
  var chunk;
  var strong;
  var hashtable_weak16;
  var hashtable_weak16i;

  for (; end <= length; start++, end++) {
    weak = calcWeak32(data, prevRollingWeak, start, end);
    weak16 = calcWeak16(weak.sum);
    match = false;
    d = null;
    prevRollingWeak = weak;
    hashtable_weak16 = hashtable[weak16];

    if (hashtable_weak16) {
      len = hashtable_weak16.length;
      for (var i = 0; i < len; i++) {
        hashtable_weak16i = hashtable_weak16[i];
        if (hashtable_weak16i.weak === weak.sum) {
          mightMatch = hashtable_weak16i;
          chunk = data.slice(start, end);
          strong = md5sum(chunk);

          if (mightMatch.strong === strong) {
            match = mightMatch;
            break;
          }
        }
      }
    }
    if (match) {
      if(start < lastMatchedEnd) {
        d = data.slice(lastMatchedEnd - 1, end);
        results.push({
          data: d,
          index: match.index
        });
      } else if (start - lastMatchedEnd > 0) {
        d = data.slice(lastMatchedEnd, start);
        results.push({
          data: d,
          index: match.index
        });
      } else {
        results.push({
          index: match.index
        });
      }
      lastMatchedEnd = end;
    } else if (end === length) {
      // No match and last block
      d = data.slice(lastMatchedEnd);
      results.push({
        data: d
      });
    }
  }
  return results;
}

// Rsync function to calculate checksums for
// a file by dividing it into blocks of data
// whose size is passed in and checksuming each
// block of data
function blockChecksums(fs, path, size, callback) {
  var cache = {};

  fs.readFile(path, function (err, data) {
    if (!err) {
      // cache file
      cache[path] = data;
    } else if (err && err.code === 'ENOENT') {
      cache[path] = [];
    } else {
      return callback(err);
    }

    var length = cache[path].length;
    var incr = size;
    var start = 0;
    var end = incr > length ? length : incr;
    var blockIndex = 0;
    var result = [];
    var chunk;
    var weak;
    var strong;

    while (start < length) {
      chunk  = cache[path].slice(start, end);
      weak   = calcWeak32(chunk).sum;
      strong = md5sum(chunk);

      result.push({
        index: blockIndex,
        weak: weak,
        strong: strong
      });
      // update slice indices
      start += incr;
      end = (end + incr) > length ? length : end + incr;
      // update block index
      blockIndex++;
    }

    callback(null, result);
  });
}

// Generate the MD5 hash for the data of a file
// in its entirety
function getChecksum(fs, path, callback) {
  fs.readFile(path, function(err, data) {
    if(!err) {
      callback(null, md5sum(data));
    } else if(err.code === 'ENOENT') {
      // File does not exist so the checksum is an empty string
      callback(null, "");
    } else {
      callback(err);
    }
  });
}

// Generate checksums for an array of paths to be used for comparison
// It also takes an optional parameter called stampNode, a boolean which
// indicates whether the checksum should be stamped as an xattr on the node.
function generateChecksums(fs, paths, stampNode, callback) {
  // Maybe stampNode was not passed in
  if(typeof callback !== 'function') {
    callback = findCallback(callback, stampNode);
    stampNode = false;
  }

  var paramError = validateParams(fs, paths);
  if(paramError) {
    return callback(paramError);
  }

  var checksumList = [];

  function ChecksumNode(path, type, checksum) {
    this.path = path;
    this.type = type;
    this.checksum = checksum;
  }

  function addChecksumNode(path, nodeType, checksum, callback) {
    var checksumNode;

    // If no checksum was passed in
    if(typeof checksum === 'function') {
      callback = checksum;
      checksumNode = new ChecksumNode(path, nodeType);
    } else {
      checksumNode = new ChecksumNode(path, nodeType, checksum);
    }

    checksumList.push(checksumNode);
    callback();
  }

  // Only calculate the checksums for synced paths
  function maybeAddChecksumNode(path, nodeType, callback) {
    fsUtils.isPathUnsynced(fs, path, function(err, unsynced) {
      if(err) {
        return callback(err);
      }

      if(unsynced) {
        return callback();
      }

      getChecksum(fs, path, function(err, checksum) {
        if(err) {
          return callback(err);
        }
        // If we shouldn't add the checksum stamp or
        // the node does not exist (cannot add a stamp)
        // immediately add the checksum
        if(!stampNode || checksum === "") {
          return addChecksumNode(path, nodeType, checksum, callback);
        }

        // Stamp the node with the checksum
        fsUtils.setChecksum(fs, path, checksum, function(err) {
          if(err) {
            return callback(err);
          }

          addChecksumNode(path, nodeType, checksum, callback);
        });
      });
    });
  }

  function calcChecksum(path, callback) {
    fs.lstat(path, function(err, stat) {
      var nodeType = stat && stat.type;

      if(err) {
        if(err.code !== 'ENOENT') {
          return callback(err);
        }

        // Checksums for non-existent files
        maybeAddChecksumNode(path, nodeType, callback);
      } else if(stat.isDirectory()) {
        // Directory checksums are not calculated i.e. are undefined
        addChecksumNode(path, nodeType, callback);
      } else {
        // Checksums for synced files/links
        maybeAddChecksumNode(path, nodeType, callback);
      }
    });
  }

  async.eachSeries(paths, calcChecksum, function(err) {
    if(err) {
      return callback(err);
    }

    callback(null, checksumList);
  });
}

// Compare two file systems. This is done by comparing the
// checksums for a collection of paths in one file system
// against the checksums for the same those paths in
// another file system
function compareContents(fs, checksumList, callback) {
  var ECHKSUM = "Checksums do not match";

  var paramError = validateParams(fs, checksumList);
  if(paramError) {
    return callback(paramError);
  }

  function compare(checksumNode, callback) {
    var path = checksumNode.path;

    fs.lstat(path, function(err, stat) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      // If the types of the nodes on each fs do not match
      // i.e. /a is a file on fs1 and /a is a directory on fs2
      if(!err && checksumNode.type !== stat.type) {
        return callback(ECHKSUM);
      }

      // If the node type is a directory, checksum should not exist
      if(!err && stat.isDirectory()) {
        if(!checksumNode.checksum) {
          return callback();
        }

        callback(ECHKSUM);
      }

      // Checksum comparison for a non-existent path or file/link
      getChecksum(fs, path, function(err, checksum) {
        if(err) {
          return callback(err);
        }

        if(checksum !== checksumNode.checksum) {
          return callback(ECHKSUM);
        }

        callback();
      });
    });
  }

  async.eachSeries(checksumList, compare, function(err) {
    if(err && err !== ECHKSUM) {
      return callback(err);
    }

    callback(null, err !== ECHKSUM);
  });
}

function del(fs, path, callback) {
  var paramError = validateParams(fs, path);
  if(paramError) {
    return callback(paramError);
  }

  fs.lstat(path, function(err, stats) {
    if(err) {
      return callback(err);
    }

    if(stats.isDirectory()) {
      fs.rmdir(path, callback);
    } else {
      fs.unlink(path, callback);
    }
  });
}

function rename(fs, oldPath, newPath, callback) {
  var paramError = validateParams(fs, oldPath) && (newPath ? null : new Errors.EINVAL('New name not specified'));
  if(paramError) {
    return callback(paramError);
  }

  if(Path.dirname(oldPath) !== Path.dirname(newPath)) {
    return callback(new Errors.EINVAL('New path name does not have the same parent as the old path'));
  }

  fs.rename(oldPath, newPath, callback);
}

module.exports = {
  blockChecksums: blockChecksums,
  getChecksum: getChecksum,
  rollData: roll,
  generateChecksums: generateChecksums,
  compareContents: compareContents,
  configureOptions: configureOptions,
  findCallback: findCallback,
  validateParams: validateParams,
  del: del,
  rename: rename
};

},{"../async-lite":8,"../fs-utils":14,"MD5":23,"filer":44}],20:[function(require,module,exports){
var Path = require('../filer').Path;
var async = require('../async-lite');
var conflict = require('../conflict');
var rsyncUtils = require('./rsync-utils');

// Generate the list of paths at the source file system
module.exports = function sourceList(fs, path, options, callback) {
  callback = rsyncUtils.findCallback(callback, options);

  var paramError = rsyncUtils.validateParams(fs, path);
  if(paramError) {
    return callback(paramError);
  }

  options = rsyncUtils.configureOptions(options);

  var sources = [];

  function SourceNode(path, stats) {
    this.path = path;
    this.modified = stats.mtime;
    this.size = stats.size;
    this.type = stats.type;
  }

  // Make sure this isn't a conflicted copy before adding
  // (we don't send these to the server in a sync)
  function addNonConflicted(sourceNode, callback) {
    conflict.isConflictedCopy(fs, sourceNode.path, function(err, conflicted) {
      if(err) {
        return callback(err);
      }

      if(!conflicted) {
        sources.push(sourceNode);
      }

      callback(null, sources);
    });
  }

  function getSrcListForDir(stats) {
    if(options.superficial) {
      sources.push(new SourceNode(path, stats));
      return callback(null, sources);
    }

    fs.readdir(path, function(err, entries) {
      if(err) {
        return callback(err);
      }

      function processDirContents(contentPath, callback) {
        var sourceNodePath = Path.join(path, contentPath);

        fs.lstat(sourceNodePath, function(err, stats) {
          if(err) {
            return callback(err);
          }

          var sourceNode = new SourceNode(sourceNodePath, stats);

          // File or Link or Non-recursive directory
          if(!options.recursive || !stats.isDirectory()) {
            return addNonConflicted(sourceNode, callback);
          }

          // Directory recursively
          sourceList(fs, sourceNodePath, options, function(err, items) {
            if(err) {
              return callback(err);
            }

            sources = sources.concat(items);

            callback();
          });
        });
      }

      // Add the directory to the sources
      sources.push(new SourceNode(path, stats));

      async.eachSeries(entries, processDirContents, function(err) {
        if(err) {
          return callback(err);
        }

        callback(null, sources);
      });
    });
  }

  function getSrcListForFileOrLink(stats) {
    var sourceNode = new SourceNode(path, stats);
    addNonConflicted(sourceNode, callback);
  }

  function getSrcListForPath(path) {
    fs.lstat(path, function(err, stats) {
      if(err) {
        return callback(err);
      }

      // File or Link
      if(!stats.isDirectory()) {
        return getSrcListForFileOrLink(stats);
      }

      // Directory
      getSrcListForDir(stats);
    });
  }

  getSrcListForPath(path);
};

},{"../async-lite":8,"../conflict":9,"../filer":13,"./rsync-utils":19}],21:[function(require,module,exports){
// Constructor
function SyncMessage(type, name, content) {
  if(!SyncMessage.isValidType(type)) {
    throw "Invalid type";
  }
  if(!SyncMessage.isValidName(name)) {
    throw "Invalid name";
  }

  this.type = type;
  this.name = name;
  this.content = content || null;

  // Sugar for testing instance data
  var that = this;
  this.is = {
    // Types
    get request() {
      return that.type === SyncMessage.REQUEST;
    },
    get response() {
      return that.type === SyncMessage.RESPONSE;
    },
    get error() {
      return that.type === SyncMessage.ERROR;
    },

    // Names
    get sourceList() {
      return that.name === SyncMessage.SOURCELIST;
    },
    get sync() {
      return that.name === SyncMessage.SYNC;
    },
    get checksums() {
      return that.name === SyncMessage.CHECKSUMS;
    },
    get diffs() {
      return that.name === SyncMessage.DIFFS;
    },
    get patch() {
      return that.name === SyncMessage.PATCH;
    },
    get verification() {
      return that.name === SyncMessage.VERIFICATION;
    },
    get reset() {
      return that.name === SyncMessage.RESET;
    },
    get locked() {
      return that.name === SyncMessage.LOCKED;
    },
    get authz() {
      return that.name === SyncMessage.AUTHZ;
    },
    get impl() {
      return that.name === SyncMessage.IMPL;
    },
    get content() {
      return that.name === SyncMessage.INCONT;
    },
    get serverReset() {
      return that.name === SyncMessage.SERVER_RESET;
    },
    get downstreamLocked() {
      return that.name === SyncMessage.DOWNSTREAM_LOCKED;
    },
    get fileSizeError() {
      return that.type === SyncMessage.ERROR && that.name === SyncMessage.MAXSIZE;
    },
    get root() {
      return that.name === SyncMessage.ROOT;
    },
    get needsDownstream() {
      return that.type === SyncMessage.ERROR && that.name === SyncMessage.NEEDS_DOWNSTREAM;
    },
    get interrupted() {
      return that.name === SyncMessage.INTERRUPTED;
    },
    get delay() {
      return that.type === SyncMessage.REQUEST && that.name === SyncMessage.DELAY;
    },
    get rename() {
      return that.name === SyncMessage.RENAME;
    },
    get del() {
      return that.name === SyncMessage.DEL;
    }
  };
}

SyncMessage.isValidName = function(name) {
  return name === SyncMessage.SOURCELIST           ||
         name === SyncMessage.CHECKSUMS            ||
         name === SyncMessage.DIFFS                ||
         name === SyncMessage.LOCKED               ||
         name === SyncMessage.PATCH                ||
         name === SyncMessage.VERIFICATION         ||
         name === SyncMessage.SYNC                 ||
         name === SyncMessage.RESET                ||
         name === SyncMessage.AUTHZ                ||
         name === SyncMessage.IMPL                 ||
         name === SyncMessage.INFRMT               ||
         name === SyncMessage.INCONT               ||
         name === SyncMessage.SERVER_RESET         ||
         name === SyncMessage.DOWNSTREAM_LOCKED    ||
         name === SyncMessage.MAXSIZE              ||
         name === SyncMessage.ROOT                 ||
         name === SyncMessage.NEEDS_DOWNSTREAM     ||
         name === SyncMessage.INTERRUPTED          ||
         name === SyncMessage.DELAY                ||
         name === SyncMessage.RENAME               ||
         name === SyncMessage.DEL;
};

SyncMessage.isValidType = function(type) {
  return type === SyncMessage.REQUEST  ||
         type === SyncMessage.RESPONSE ||
         type === SyncMessage.ERROR;
};

SyncMessage.prototype.stringify = function() {
  return JSON.stringify({
    type: this.type,
    name: this.name,
    content: this.content
  });
};

// Try to parse data back into a SyncMessage object. If the
// data is invalid, return a format error message instead.
SyncMessage.parse = function(data) {
  if(!data                               ||
     !SyncMessage.isValidType(data.type) ||
     !SyncMessage.isValidName(data.name)) {
    return SyncMessage.error.format;
  }

  return new SyncMessage(data.type, data.name, data.content);
};

// SyncMessage Type constants
SyncMessage.REQUEST = "REQUEST";
SyncMessage.RESPONSE = "RESPONSE";
SyncMessage.ERROR = "ERROR";

// SyncMessage Name constants
SyncMessage.SOURCELIST = "SOURCELIST";
SyncMessage.SYNC = "SYNC";
SyncMessage.CHECKSUMS = "CHECKSUMS";
SyncMessage.DIFFS = "DIFFS";
SyncMessage.PATCH = "PATCH";
SyncMessage.VERIFICATION = "VERIFICATION";
SyncMessage.RESET = "RESET";
SyncMessage.LOCKED = "LOCKED";
SyncMessage.AUTHZ = "AUTHORIZED";
SyncMessage.IMPL = "IMPLEMENTATION";
SyncMessage.SERVER_RESET = "SERVER_RESET";
SyncMessage.DOWNSTREAM_LOCKED = "DOWNSTREAM_LOCKED";
SyncMessage.MAXSIZE = "MAXSIZE";
SyncMessage.INTERRUPTED = "INTERRUPTED";
SyncMessage.ROOT = "ROOT";
SyncMessage.NEEDS_DOWNSTREAM = "NEEDS DOWNSTREAM";
SyncMessage.DELAY = "DELAY DOWNSTREAM";
SyncMessage.RENAME = "RENAME";
SyncMessage.DEL = "DELETE";

// SyncMessage Error constants
SyncMessage.INFRMT = "INVALID FORMAT";
SyncMessage.INCONT = "INVALID CONTENT";

// Sugar for getting message instances
SyncMessage.request = {
  get diffs() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.DIFFS);
  },
  get checksums() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.CHECKSUMS);
  },
  get sync() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.SYNC);
  },
  get reset() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.RESET);
  },
  get delay() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.DELAY);
  },
  get rename() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.RENAME);
  },
  get del() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.DEL);
  }
};
SyncMessage.response = {
  get diffs() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.DIFFS);
  },
  get patch() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.PATCH);
  },
  get verification() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.VERIFICATION);
  },
  get authz() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.AUTHZ);
  },
  get sync() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.SYNC);
  },
  get reset() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.RESET);
  },
  get root() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ROOT);
  }
};
SyncMessage.error = {
  get sourceList() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.SOURCELIST);
  },
  get diffs() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.DIFFS);
  },
  get locked() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.LOCKED);
  },
  get checksums() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.CHECKSUMS);
  },
  get patch() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.PATCH);
  },
  get impl() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.IMPL);
  },
  get serverReset() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.SERVER_RESET);
  },
  get downstreamLocked() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.DOWNSTREAM_LOCKED, 'Downstream syncs are locked!');
  },
  get maxsizeExceeded() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.MAXSIZE, 'Maximum file size exceeded');
  },
  get verification() {
    return new SyncMessage(SyncMessage.ERROR,
                           SyncMessage.VERIFICATION,
                           'Patch could not be verified');
  },
  get format() {
    return new SyncMessage(SyncMessage.ERROR,
                           SyncMessage.INFRMT,
                           'Message must be formatted as a sync message');
  },
  get content() {
    return new SyncMessage(SyncMessage.ERROR,
                           SyncMessage.INCONT,
                           'Invalid content provided');
  },
  get interrupted() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.INTERRUPTED);
  },
  get needsDownstream() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.NEEDS_DOWNSTREAM);
  },
  get rename() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.RENAME);
  },
  get del() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.DEL);
  }
};

SyncMessage.prototype.invalidContent = function(keys) {
  var content = this.content;
  keys = keys || [];

  if(!content || !content.path) {
    return true;
  }

  for(var i = 0; i < keys.length; i++) {
    if(!content[keys[i]]) return true;
  }

  return false;
};

module.exports = SyncMessage;

},{}],22:[function(require,module,exports){
// General utility methods

function findPathIndexInArray(array, path) {
  for(var i = 0; i < array.length; i++) {
    if(array[i].path === path) {
      return i;
    }
  }

  return -1;
}

module.exports = {
    findPathIndexInArray: findPathIndexInArray
};

},{}],23:[function(require,module,exports){
(function (Buffer){
(function(){
  var crypt = require('crypt'),
      utf8 = require('charenc').utf8,
      bin = require('charenc').bin,

  // The core
  md5 = function (message, options) {
    // Convert to byte array
    if (message.constructor == String)
      if (options && options.encoding === 'binary')
        message = bin.stringToBytes(message);
      else
        message = utf8.stringToBytes(message);
    else if (typeof Buffer != 'undefined' &&
        typeof Buffer.isBuffer == 'function' && Buffer.isBuffer(message))
      message = Array.prototype.slice.call(message, 0);
    else if (!Array.isArray(message))
      message = message.toString();
    // else, assume byte array already

    var m = crypt.bytesToWords(message),
        l = message.length * 8,
        a =  1732584193,
        b = -271733879,
        c = -1732584194,
        d =  271733878;

    // Swap endian
    for (var i = 0; i < m.length; i++) {
      m[i] = ((m[i] <<  8) | (m[i] >>> 24)) & 0x00FF00FF |
             ((m[i] << 24) | (m[i] >>>  8)) & 0xFF00FF00;
    }

    // Padding
    m[l >>> 5] |= 0x80 << (l % 32);
    m[(((l + 64) >>> 9) << 4) + 14] = l;

    // Method shortcuts
    var FF = md5._ff,
        GG = md5._gg,
        HH = md5._hh,
        II = md5._ii;

    for (var i = 0; i < m.length; i += 16) {

      var aa = a,
          bb = b,
          cc = c,
          dd = d;

      a = FF(a, b, c, d, m[i+ 0],  7, -680876936);
      d = FF(d, a, b, c, m[i+ 1], 12, -389564586);
      c = FF(c, d, a, b, m[i+ 2], 17,  606105819);
      b = FF(b, c, d, a, m[i+ 3], 22, -1044525330);
      a = FF(a, b, c, d, m[i+ 4],  7, -176418897);
      d = FF(d, a, b, c, m[i+ 5], 12,  1200080426);
      c = FF(c, d, a, b, m[i+ 6], 17, -1473231341);
      b = FF(b, c, d, a, m[i+ 7], 22, -45705983);
      a = FF(a, b, c, d, m[i+ 8],  7,  1770035416);
      d = FF(d, a, b, c, m[i+ 9], 12, -1958414417);
      c = FF(c, d, a, b, m[i+10], 17, -42063);
      b = FF(b, c, d, a, m[i+11], 22, -1990404162);
      a = FF(a, b, c, d, m[i+12],  7,  1804603682);
      d = FF(d, a, b, c, m[i+13], 12, -40341101);
      c = FF(c, d, a, b, m[i+14], 17, -1502002290);
      b = FF(b, c, d, a, m[i+15], 22,  1236535329);

      a = GG(a, b, c, d, m[i+ 1],  5, -165796510);
      d = GG(d, a, b, c, m[i+ 6],  9, -1069501632);
      c = GG(c, d, a, b, m[i+11], 14,  643717713);
      b = GG(b, c, d, a, m[i+ 0], 20, -373897302);
      a = GG(a, b, c, d, m[i+ 5],  5, -701558691);
      d = GG(d, a, b, c, m[i+10],  9,  38016083);
      c = GG(c, d, a, b, m[i+15], 14, -660478335);
      b = GG(b, c, d, a, m[i+ 4], 20, -405537848);
      a = GG(a, b, c, d, m[i+ 9],  5,  568446438);
      d = GG(d, a, b, c, m[i+14],  9, -1019803690);
      c = GG(c, d, a, b, m[i+ 3], 14, -187363961);
      b = GG(b, c, d, a, m[i+ 8], 20,  1163531501);
      a = GG(a, b, c, d, m[i+13],  5, -1444681467);
      d = GG(d, a, b, c, m[i+ 2],  9, -51403784);
      c = GG(c, d, a, b, m[i+ 7], 14,  1735328473);
      b = GG(b, c, d, a, m[i+12], 20, -1926607734);

      a = HH(a, b, c, d, m[i+ 5],  4, -378558);
      d = HH(d, a, b, c, m[i+ 8], 11, -2022574463);
      c = HH(c, d, a, b, m[i+11], 16,  1839030562);
      b = HH(b, c, d, a, m[i+14], 23, -35309556);
      a = HH(a, b, c, d, m[i+ 1],  4, -1530992060);
      d = HH(d, a, b, c, m[i+ 4], 11,  1272893353);
      c = HH(c, d, a, b, m[i+ 7], 16, -155497632);
      b = HH(b, c, d, a, m[i+10], 23, -1094730640);
      a = HH(a, b, c, d, m[i+13],  4,  681279174);
      d = HH(d, a, b, c, m[i+ 0], 11, -358537222);
      c = HH(c, d, a, b, m[i+ 3], 16, -722521979);
      b = HH(b, c, d, a, m[i+ 6], 23,  76029189);
      a = HH(a, b, c, d, m[i+ 9],  4, -640364487);
      d = HH(d, a, b, c, m[i+12], 11, -421815835);
      c = HH(c, d, a, b, m[i+15], 16,  530742520);
      b = HH(b, c, d, a, m[i+ 2], 23, -995338651);

      a = II(a, b, c, d, m[i+ 0],  6, -198630844);
      d = II(d, a, b, c, m[i+ 7], 10,  1126891415);
      c = II(c, d, a, b, m[i+14], 15, -1416354905);
      b = II(b, c, d, a, m[i+ 5], 21, -57434055);
      a = II(a, b, c, d, m[i+12],  6,  1700485571);
      d = II(d, a, b, c, m[i+ 3], 10, -1894986606);
      c = II(c, d, a, b, m[i+10], 15, -1051523);
      b = II(b, c, d, a, m[i+ 1], 21, -2054922799);
      a = II(a, b, c, d, m[i+ 8],  6,  1873313359);
      d = II(d, a, b, c, m[i+15], 10, -30611744);
      c = II(c, d, a, b, m[i+ 6], 15, -1560198380);
      b = II(b, c, d, a, m[i+13], 21,  1309151649);
      a = II(a, b, c, d, m[i+ 4],  6, -145523070);
      d = II(d, a, b, c, m[i+11], 10, -1120210379);
      c = II(c, d, a, b, m[i+ 2], 15,  718787259);
      b = II(b, c, d, a, m[i+ 9], 21, -343485551);

      a = (a + aa) >>> 0;
      b = (b + bb) >>> 0;
      c = (c + cc) >>> 0;
      d = (d + dd) >>> 0;
    }

    return crypt.endian([a, b, c, d]);
  };

  // Auxiliary functions
  md5._ff  = function (a, b, c, d, x, s, t) {
    var n = a + (b & c | ~b & d) + (x >>> 0) + t;
    return ((n << s) | (n >>> (32 - s))) + b;
  };
  md5._gg  = function (a, b, c, d, x, s, t) {
    var n = a + (b & d | c & ~d) + (x >>> 0) + t;
    return ((n << s) | (n >>> (32 - s))) + b;
  };
  md5._hh  = function (a, b, c, d, x, s, t) {
    var n = a + (b ^ c ^ d) + (x >>> 0) + t;
    return ((n << s) | (n >>> (32 - s))) + b;
  };
  md5._ii  = function (a, b, c, d, x, s, t) {
    var n = a + (c ^ (b | ~d)) + (x >>> 0) + t;
    return ((n << s) | (n >>> (32 - s))) + b;
  };

  // Package private blocksize
  md5._blocksize = 16;
  md5._digestsize = 16;

  module.exports = function (message, options) {
    if(typeof message == 'undefined')
      return;

    var digestbytes = crypt.wordsToBytes(md5(message, options));
    return options && options.asBytes ? digestbytes :
        options && options.asString ? bin.bytesToString(digestbytes) :
        crypt.bytesToHex(digestbytes);
  };

})();

}).call(this,require("buffer").Buffer)
},{"buffer":57,"charenc":24,"crypt":25}],24:[function(require,module,exports){
var charenc = {
  // UTF-8 encoding
  utf8: {
    // Convert a string to a byte array
    stringToBytes: function(str) {
      return charenc.bin.stringToBytes(unescape(encodeURIComponent(str)));
    },

    // Convert a byte array to a string
    bytesToString: function(bytes) {
      return decodeURIComponent(escape(charenc.bin.bytesToString(bytes)));
    }
  },

  // Binary encoding
  bin: {
    // Convert a string to a byte array
    stringToBytes: function(str) {
      for (var bytes = [], i = 0; i < str.length; i++)
        bytes.push(str.charCodeAt(i) & 0xFF);
      return bytes;
    },

    // Convert a byte array to a string
    bytesToString: function(bytes) {
      for (var str = [], i = 0; i < bytes.length; i++)
        str.push(String.fromCharCode(bytes[i]));
      return str.join('');
    }
  }
};

module.exports = charenc;

},{}],25:[function(require,module,exports){
(function() {
  var base64map
      = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',

  crypt = {
    // Bit-wise rotation left
    rotl: function(n, b) {
      return (n << b) | (n >>> (32 - b));
    },

    // Bit-wise rotation right
    rotr: function(n, b) {
      return (n << (32 - b)) | (n >>> b);
    },

    // Swap big-endian to little-endian and vice versa
    endian: function(n) {
      // If number given, swap endian
      if (n.constructor == Number) {
        return crypt.rotl(n, 8) & 0x00FF00FF | crypt.rotl(n, 24) & 0xFF00FF00;
      }

      // Else, assume array and swap all items
      for (var i = 0; i < n.length; i++)
        n[i] = crypt.endian(n[i]);
      return n;
    },

    // Generate an array of any length of random bytes
    randomBytes: function(n) {
      for (var bytes = []; n > 0; n--)
        bytes.push(Math.floor(Math.random() * 256));
      return bytes;
    },

    // Convert a byte array to big-endian 32-bit words
    bytesToWords: function(bytes) {
      for (var words = [], i = 0, b = 0; i < bytes.length; i++, b += 8)
        words[b >>> 5] |= bytes[i] << (24 - b % 32);
      return words;
    },

    // Convert big-endian 32-bit words to a byte array
    wordsToBytes: function(words) {
      for (var bytes = [], b = 0; b < words.length * 32; b += 8)
        bytes.push((words[b >>> 5] >>> (24 - b % 32)) & 0xFF);
      return bytes;
    },

    // Convert a byte array to a hex string
    bytesToHex: function(bytes) {
      for (var hex = [], i = 0; i < bytes.length; i++) {
        hex.push((bytes[i] >>> 4).toString(16));
        hex.push((bytes[i] & 0xF).toString(16));
      }
      return hex.join('');
    },

    // Convert a hex string to a byte array
    hexToBytes: function(hex) {
      for (var bytes = [], c = 0; c < hex.length; c += 2)
        bytes.push(parseInt(hex.substr(c, 2), 16));
      return bytes;
    },

    // Convert a byte array to a base-64 string
    bytesToBase64: function(bytes) {
      for (var base64 = [], i = 0; i < bytes.length; i += 3) {
        var triplet = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        for (var j = 0; j < 4; j++)
          if (i * 8 + j * 6 <= bytes.length * 8)
            base64.push(base64map.charAt((triplet >>> 6 * (3 - j)) & 0x3F));
          else
            base64.push('=');
      }
      return base64.join('');
    },

    // Convert a base-64 string to a byte array
    base64ToBytes: function(base64) {
      // Remove non-base-64 characters
      base64 = base64.replace(/[^A-Z0-9+\/]/ig, '');

      for (var bytes = [], i = 0, imod4 = 0; i < base64.length;
          imod4 = ++i % 4) {
        if (imod4 == 0) continue;
        bytes.push(((base64map.indexOf(base64.charAt(i - 1))
            & (Math.pow(2, -2 * imod4 + 8) - 1)) << (imod4 * 2))
            | (base64map.indexOf(base64.charAt(i)) >>> (6 - imod4 * 2)));
      }
      return bytes;
    }
  };

  module.exports = crypt;
})();

},{}],26:[function(require,module,exports){
// Browser Request
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// UMD HEADER START 
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else if (typeof exports === 'object') {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like enviroments that support module.exports,
        // like Node.
        module.exports = factory();
    } else {
        // Browser globals (root is window)
        root.returnExports = factory();
  }
}(this, function () {
// UMD HEADER END

var XHR = XMLHttpRequest
if (!XHR) throw new Error('missing XMLHttpRequest')
request.log = {
  'trace': noop, 'debug': noop, 'info': noop, 'warn': noop, 'error': noop
}

var DEFAULT_TIMEOUT = 3 * 60 * 1000 // 3 minutes

//
// request
//

function request(options, callback) {
  // The entry-point to the API: prep the options object and pass the real work to run_xhr.
  if(typeof callback !== 'function')
    throw new Error('Bad callback given: ' + callback)

  if(!options)
    throw new Error('No options given')

  var options_onResponse = options.onResponse; // Save this for later.

  if(typeof options === 'string')
    options = {'uri':options};
  else
    options = JSON.parse(JSON.stringify(options)); // Use a duplicate for mutating.

  options.onResponse = options_onResponse // And put it back.

  if (options.verbose) request.log = getLogger();

  if(options.url) {
    options.uri = options.url;
    delete options.url;
  }

  if(!options.uri && options.uri !== "")
    throw new Error("options.uri is a required argument");

  if(typeof options.uri != "string")
    throw new Error("options.uri must be a string");

  var unsupported_options = ['proxy', '_redirectsFollowed', 'maxRedirects', 'followRedirect']
  for (var i = 0; i < unsupported_options.length; i++)
    if(options[ unsupported_options[i] ])
      throw new Error("options." + unsupported_options[i] + " is not supported")

  options.callback = callback
  options.method = options.method || 'GET';
  options.headers = options.headers || {};
  options.body    = options.body || null
  options.timeout = options.timeout || request.DEFAULT_TIMEOUT

  if(options.headers.host)
    throw new Error("Options.headers.host is not supported");

  if(options.json) {
    options.headers.accept = options.headers.accept || 'application/json'
    if(options.method !== 'GET')
      options.headers['content-type'] = 'application/json'

    if(typeof options.json !== 'boolean')
      options.body = JSON.stringify(options.json)
    else if(typeof options.body !== 'string')
      options.body = JSON.stringify(options.body)
  }
  
  //BEGIN QS Hack
  var serialize = function(obj) {
    var str = [];
    for(var p in obj)
      if (obj.hasOwnProperty(p)) {
        str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
      }
    return str.join("&");
  }
  
  if(options.qs){
    var qs = (typeof options.qs == 'string')? options.qs : serialize(options.qs);
    if(options.uri.indexOf('?') !== -1){ //no get params
        options.uri = options.uri+'&'+qs;
    }else{ //existing get params
        options.uri = options.uri+'?'+qs;
    }
  }
  //END QS Hack
  
  //BEGIN FORM Hack
  var multipart = function(obj) {
    //todo: support file type (useful?)
    var result = {};
    result.boundry = '-------------------------------'+Math.floor(Math.random()*1000000000);
    var lines = [];
    for(var p in obj){
        if (obj.hasOwnProperty(p)) {
            lines.push(
                '--'+result.boundry+"\n"+
                'Content-Disposition: form-data; name="'+p+'"'+"\n"+
                "\n"+
                obj[p]+"\n"
            );
        }
    }
    lines.push( '--'+result.boundry+'--' );
    result.body = lines.join('');
    result.length = result.body.length;
    result.type = 'multipart/form-data; boundary='+result.boundry;
    return result;
  }
  
  if(options.form){
    if(typeof options.form == 'string') throw('form name unsupported');
    if(options.method === 'POST'){
        var encoding = (options.encoding || 'application/x-www-form-urlencoded').toLowerCase();
        options.headers['content-type'] = encoding;
        switch(encoding){
            case 'application/x-www-form-urlencoded':
                options.body = serialize(options.form).replace(/%20/g, "+");
                break;
            case 'multipart/form-data':
                var multi = multipart(options.form);
                //options.headers['content-length'] = multi.length;
                options.body = multi.body;
                options.headers['content-type'] = multi.type;
                break;
            default : throw new Error('unsupported encoding:'+encoding);
        }
    }
  }
  //END FORM Hack

  // If onResponse is boolean true, call back immediately when the response is known,
  // not when the full request is complete.
  options.onResponse = options.onResponse || noop
  if(options.onResponse === true) {
    options.onResponse = callback
    options.callback = noop
  }

  // XXX Browsers do not like this.
  //if(options.body)
  //  options.headers['content-length'] = options.body.length;

  // HTTP basic authentication
  if(!options.headers.authorization && options.auth)
    options.headers.authorization = 'Basic ' + b64_enc(options.auth.username + ':' + options.auth.password);

  return run_xhr(options)
}

var req_seq = 0
function run_xhr(options) {
  var xhr = new XHR
    , timed_out = false
    , is_cors = is_crossDomain(options.uri)
    , supports_cors = ('withCredentials' in xhr)

  req_seq += 1
  xhr.seq_id = req_seq
  xhr.id = req_seq + ': ' + options.method + ' ' + options.uri
  xhr._id = xhr.id // I know I will type "_id" from habit all the time.

  if(is_cors && !supports_cors) {
    var cors_err = new Error('Browser does not support cross-origin request: ' + options.uri)
    cors_err.cors = 'unsupported'
    return options.callback(cors_err, xhr)
  }

  xhr.timeoutTimer = setTimeout(too_late, options.timeout)
  function too_late() {
    timed_out = true
    var er = new Error('ETIMEDOUT')
    er.code = 'ETIMEDOUT'
    er.duration = options.timeout

    request.log.error('Timeout', { 'id':xhr._id, 'milliseconds':options.timeout })
    return options.callback(er, xhr)
  }

  // Some states can be skipped over, so remember what is still incomplete.
  var did = {'response':false, 'loading':false, 'end':false}

  xhr.onreadystatechange = on_state_change
  xhr.open(options.method, options.uri, true) // asynchronous
  if(is_cors)
    xhr.withCredentials = !! options.withCredentials
  xhr.send(options.body)
  return xhr

  function on_state_change(event) {
    if(timed_out)
      return request.log.debug('Ignoring timed out state change', {'state':xhr.readyState, 'id':xhr.id})

    request.log.debug('State change', {'state':xhr.readyState, 'id':xhr.id, 'timed_out':timed_out})

    if(xhr.readyState === XHR.OPENED) {
      request.log.debug('Request started', {'id':xhr.id})
      for (var key in options.headers)
        xhr.setRequestHeader(key, options.headers[key])
    }

    else if(xhr.readyState === XHR.HEADERS_RECEIVED)
      on_response()

    else if(xhr.readyState === XHR.LOADING) {
      on_response()
      on_loading()
    }

    else if(xhr.readyState === XHR.DONE) {
      on_response()
      on_loading()
      on_end()
    }
  }

  function on_response() {
    if(did.response)
      return

    did.response = true
    request.log.debug('Got response', {'id':xhr.id, 'status':xhr.status})
    clearTimeout(xhr.timeoutTimer)
    xhr.statusCode = xhr.status // Node request compatibility

    // Detect failed CORS requests.
    if(is_cors && xhr.statusCode == 0) {
      var cors_err = new Error('CORS request rejected: ' + options.uri)
      cors_err.cors = 'rejected'

      // Do not process this request further.
      did.loading = true
      did.end = true

      return options.callback(cors_err, xhr)
    }

    options.onResponse(null, xhr)
  }

  function on_loading() {
    if(did.loading)
      return

    did.loading = true
    request.log.debug('Response body loading', {'id':xhr.id})
    // TODO: Maybe simulate "data" events by watching xhr.responseText
  }

  function on_end() {
    if(did.end)
      return

    did.end = true
    request.log.debug('Request done', {'id':xhr.id})

    xhr.body = xhr.responseText
    if(options.json) {
      try        { xhr.body = JSON.parse(xhr.responseText) }
      catch (er) { return options.callback(er, xhr)        }
    }

    options.callback(null, xhr, xhr.body)
  }

} // request

request.withCredentials = false;
request.DEFAULT_TIMEOUT = DEFAULT_TIMEOUT;

//
// defaults
//

request.defaults = function(options, requester) {
  var def = function (method) {
    var d = function (params, callback) {
      if(typeof params === 'string')
        params = {'uri': params};
      else {
        params = JSON.parse(JSON.stringify(params));
      }
      for (var i in options) {
        if (params[i] === undefined) params[i] = options[i]
      }
      return method(params, callback)
    }
    return d
  }
  var de = def(request)
  de.get = def(request.get)
  de.post = def(request.post)
  de.put = def(request.put)
  de.head = def(request.head)
  return de
}

//
// HTTP method shortcuts
//

var shortcuts = [ 'get', 'put', 'post', 'head' ];
shortcuts.forEach(function(shortcut) {
  var method = shortcut.toUpperCase();
  var func   = shortcut.toLowerCase();

  request[func] = function(opts) {
    if(typeof opts === 'string')
      opts = {'method':method, 'uri':opts};
    else {
      opts = JSON.parse(JSON.stringify(opts));
      opts.method = method;
    }

    var args = [opts].concat(Array.prototype.slice.apply(arguments, [1]));
    return request.apply(this, args);
  }
})

//
// CouchDB shortcut
//

request.couch = function(options, callback) {
  if(typeof options === 'string')
    options = {'uri':options}

  // Just use the request API to do JSON.
  options.json = true
  if(options.body)
    options.json = options.body
  delete options.body

  callback = callback || noop

  var xhr = request(options, couch_handler)
  return xhr

  function couch_handler(er, resp, body) {
    if(er)
      return callback(er, resp, body)

    if((resp.statusCode < 200 || resp.statusCode > 299) && body.error) {
      // The body is a Couch JSON object indicating the error.
      er = new Error('CouchDB error: ' + (body.error.reason || body.error.error))
      for (var key in body)
        er[key] = body[key]
      return callback(er, resp, body);
    }

    return callback(er, resp, body);
  }
}

//
// Utility
//

function noop() {}

function getLogger() {
  var logger = {}
    , levels = ['trace', 'debug', 'info', 'warn', 'error']
    , level, i

  for(i = 0; i < levels.length; i++) {
    level = levels[i]

    logger[level] = noop
    if(typeof console !== 'undefined' && console && console[level])
      logger[level] = formatted(console, level)
  }

  return logger
}

function formatted(obj, method) {
  return formatted_logger

  function formatted_logger(str, context) {
    if(typeof context === 'object')
      str += ' ' + JSON.stringify(context)

    return obj[method].call(obj, str)
  }
}

// Return whether a URL is a cross-domain request.
function is_crossDomain(url) {
  var rurl = /^([\w\+\.\-]+:)(?:\/\/([^\/?#:]*)(?::(\d+))?)?/

  // jQuery #8138, IE may throw an exception when accessing
  // a field from window.location if document.domain has been set
  var ajaxLocation
  try { ajaxLocation = location.href }
  catch (e) {
    // Use the href attribute of an A element since IE will modify it given document.location
    ajaxLocation = document.createElement( "a" );
    ajaxLocation.href = "";
    ajaxLocation = ajaxLocation.href;
  }

  var ajaxLocParts = rurl.exec(ajaxLocation.toLowerCase()) || []
    , parts = rurl.exec(url.toLowerCase() )

  var result = !!(
    parts &&
    (  parts[1] != ajaxLocParts[1]
    || parts[2] != ajaxLocParts[2]
    || (parts[3] || (parts[1] === "http:" ? 80 : 443)) != (ajaxLocParts[3] || (ajaxLocParts[1] === "http:" ? 80 : 443))
    )
  )

  //console.debug('is_crossDomain('+url+') -> ' + result)
  return result
}

// MIT License from http://phpjs.org/functions/base64_encode:358
function b64_enc (data) {
    // Encodes string using MIME base64 algorithm
    var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var o1, o2, o3, h1, h2, h3, h4, bits, i = 0, ac = 0, enc="", tmp_arr = [];

    if (!data) {
        return data;
    }

    // assume utf8 data
    // data = this.utf8_encode(data+'');

    do { // pack three octets into four hexets
        o1 = data.charCodeAt(i++);
        o2 = data.charCodeAt(i++);
        o3 = data.charCodeAt(i++);

        bits = o1<<16 | o2<<8 | o3;

        h1 = bits>>18 & 0x3f;
        h2 = bits>>12 & 0x3f;
        h3 = bits>>6 & 0x3f;
        h4 = bits & 0x3f;

        // use hexets to index into b64, and append result to encoded string
        tmp_arr[ac++] = b64.charAt(h1) + b64.charAt(h2) + b64.charAt(h3) + b64.charAt(h4);
    } while (i < data.length);

    enc = tmp_arr.join('');

    switch (data.length % 3) {
        case 1:
            enc = enc.slice(0, -2) + '==';
        break;
        case 2:
            enc = enc.slice(0, -1) + '=';
        break;
    }

    return enc;
}
    return request;
//UMD FOOTER START
}));
//UMD FOOTER END

},{}],27:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],28:[function(require,module,exports){
(function (process){
/*global setImmediate: false, setTimeout: false, console: false */

/**
 * async.js shim, based on https://raw.github.com/caolan/async/master/lib/async.js Feb 18, 2014
 * Used under MIT - https://github.com/caolan/async/blob/master/LICENSE
 */

(function () {

    var async = {};

    // async.js functions used in Filer

    //// nextTick implementation with browser-compatible fallback ////
    if (typeof process === 'undefined' || !(process.nextTick)) {
        if (typeof setImmediate === 'function') {
            async.nextTick = function (fn) {
                // not a direct alias for IE10 compatibility
                setImmediate(fn);
            };
            async.setImmediate = async.nextTick;
        }
        else {
            async.nextTick = function (fn) {
                setTimeout(fn, 0);
            };
            async.setImmediate = async.nextTick;
        }
    }
    else {
        async.nextTick = process.nextTick;
        if (typeof setImmediate !== 'undefined') {
            async.setImmediate = function (fn) {
              // not a direct alias for IE10 compatibility
              setImmediate(fn);
            };
        }
        else {
            async.setImmediate = async.nextTick;
        }
    }

    async.eachSeries = function (arr, iterator, callback) {
        callback = callback || function () {};
        if (!arr.length) {
            return callback();
        }
        var completed = 0;
        var iterate = function () {
            iterator(arr[completed], function (err) {
                if (err) {
                    callback(err);
                    callback = function () {};
                }
                else {
                    completed += 1;
                    if (completed >= arr.length) {
                        callback();
                    }
                    else {
                        iterate();
                    }
                }
            });
        };
        iterate();
    };
    async.forEachSeries = async.eachSeries;

    // AMD / RequireJS
    if (typeof define !== 'undefined' && define.amd) {
        define([], function () {
            return async;
        });
    }
    // Node.js
    else if (typeof module !== 'undefined' && module.exports) {
        module.exports = async;
    }
    // included directly via <script> tag
    else {
        root.async = async;
    }

}());

}).call(this,require('_process'))
},{"_process":62}],29:[function(require,module,exports){
// Based on https://github.com/diy/intercom.js/blob/master/lib/events.js
// Copyright 2012 DIY Co Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0

function removeItem(item, array) {
  for (var i = array.length - 1; i >= 0; i--) {
    if (array[i] === item) {
      array.splice(i, 1);
    }
  }
  return array;
}

var EventEmitter = function() {};

EventEmitter.createInterface = function(space) {
  var methods = {};

  methods.on = function(name, fn) {
    if (typeof this[space] === 'undefined') {
      this[space] = {};
    }
    if (!this[space].hasOwnProperty(name)) {
      this[space][name] = [];
    }
    this[space][name].push(fn);
  };

  methods.off = function(name, fn) {
    if (typeof this[space] === 'undefined') return;
    if (this[space].hasOwnProperty(name)) {
      removeItem(fn, this[space][name]);
    }
  };

  methods.trigger = function(name) {
    if (typeof this[space] !== 'undefined' && this[space].hasOwnProperty(name)) {
      var args = Array.prototype.slice.call(arguments, 1);
      for (var i = 0; i < this[space][name].length; i++) {
        this[space][name][i].apply(this[space][name][i], args);
      }
    }
  };

  methods.removeAllListeners = function(name) {
    if (typeof this[space] === 'undefined') return;
    var self = this;
    self[space][name].forEach(function(fn) {
      self.off(name, fn);
    });
  };

  return methods;
};

var pvt = EventEmitter.createInterface('_handlers');
EventEmitter.prototype._on = pvt.on;
EventEmitter.prototype._off = pvt.off;
EventEmitter.prototype._trigger = pvt.trigger;

var pub = EventEmitter.createInterface('handlers');
EventEmitter.prototype.on = function() {
  pub.on.apply(this, arguments);
  Array.prototype.unshift.call(arguments, 'on');
  this._trigger.apply(this, arguments);
};
EventEmitter.prototype.off = pub.off;
EventEmitter.prototype.trigger = pub.trigger;
EventEmitter.prototype.removeAllListeners = pub.removeAllListeners;

module.exports = EventEmitter;

},{}],30:[function(require,module,exports){
(function (global){
// Based on https://github.com/diy/intercom.js/blob/master/lib/intercom.js
// Copyright 2012 DIY Co Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0

var EventEmitter = require('./eventemitter.js');
var guid = require('../src/shared.js').guid;

function throttle(delay, fn) {
  var last = 0;
  return function() {
    var now = Date.now();
    if (now - last > delay) {
      last = now;
      fn.apply(this, arguments);
    }
  };
}

function extend(a, b) {
  if (typeof a === 'undefined' || !a) { a = {}; }
  if (typeof b === 'object') {
    for (var key in b) {
      if (b.hasOwnProperty(key)) {
        a[key] = b[key];
      }
    }
  }
  return a;
}

var localStorage = (function(window) {
  if (typeof window === 'undefined' ||
      typeof window.localStorage === 'undefined') {
    return {
      getItem : function() {},
      setItem : function() {},
      removeItem : function() {}
    };
  }
  return window.localStorage;
}(global));

function Intercom() {
  var self = this;
  var now = Date.now();

  this.origin         = guid();
  this.lastMessage    = now;
  this.receivedIDs    = {};
  this.previousValues = {};

  var storageHandler = function() {
    self._onStorageEvent.apply(self, arguments);
  };

  // If we're in node.js, skip event registration
  if (typeof document === 'undefined') {
    return;
  }

  if (document.attachEvent) {
    document.attachEvent('onstorage', storageHandler);
  } else {
    global.addEventListener('storage', storageHandler, false);
  }
}

Intercom.prototype._transaction = function(fn) {
  var TIMEOUT   = 1000;
  var WAIT      = 20;
  var self      = this;
  var executed  = false;
  var listening = false;
  var waitTimer = null;

  function lock() {
    if (executed) {
      return;
    }

    var now = Date.now();
    var activeLock = localStorage.getItem(INDEX_LOCK)|0;
    if (activeLock && now - activeLock < TIMEOUT) {
      if (!listening) {
        self._on('storage', lock);
        listening = true;
      }
      waitTimer = setTimeout(lock, WAIT);
      return;
    }
    executed = true;
    localStorage.setItem(INDEX_LOCK, now);

    fn();
    unlock();
  }

  function unlock() {
    if (listening) {
      self._off('storage', lock);
    }
    if (waitTimer) {
      clearTimeout(waitTimer);
    }
    localStorage.removeItem(INDEX_LOCK);
  }

  lock();
};

Intercom.prototype._cleanup_emit = throttle(100, function() {
  var self = this;

  self._transaction(function() {
    var now = Date.now();
    var threshold = now - THRESHOLD_TTL_EMIT;
    var changed = 0;
    var messages;

    try {
      messages = JSON.parse(localStorage.getItem(INDEX_EMIT) || '[]');
    } catch(e) {
      messages = [];
    }
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i].timestamp < threshold) {
        messages.splice(i, 1);
        changed++;
      }
    }
    if (changed > 0) {
      localStorage.setItem(INDEX_EMIT, JSON.stringify(messages));
    }
  });
});

Intercom.prototype._cleanup_once = throttle(100, function() {
  var self = this;

  self._transaction(function() {
    var timestamp, ttl, key;
    var table;
    var now  = Date.now();
    var changed = 0;

    try {
      table = JSON.parse(localStorage.getItem(INDEX_ONCE) || '{}');
    } catch(e) {
      table = {};
    }
    for (key in table) {
      if (self._once_expired(key, table)) {
        delete table[key];
        changed++;
      }
    }

    if (changed > 0) {
      localStorage.setItem(INDEX_ONCE, JSON.stringify(table));
    }
  });
});

Intercom.prototype._once_expired = function(key, table) {
  if (!table) {
    return true;
  }
  if (!table.hasOwnProperty(key)) {
    return true;
  }
  if (typeof table[key] !== 'object') {
    return true;
  }

  var ttl = table[key].ttl || THRESHOLD_TTL_ONCE;
  var now = Date.now();
  var timestamp = table[key].timestamp;
  return timestamp < now - ttl;
};

Intercom.prototype._localStorageChanged = function(event, field) {
  if (event && event.key) {
    return event.key === field;
  }

  var currentValue = localStorage.getItem(field);
  if (currentValue === this.previousValues[field]) {
    return false;
  }
  this.previousValues[field] = currentValue;
  return true;
};

Intercom.prototype._onStorageEvent = function(event) {
  event = event || global.event;
  var self = this;

  if (this._localStorageChanged(event, INDEX_EMIT)) {
    this._transaction(function() {
      var now = Date.now();
      var data = localStorage.getItem(INDEX_EMIT);
      var messages;

      try {
        messages = JSON.parse(data || '[]');
      } catch(e) {
        messages = [];
      }
      for (var i = 0; i < messages.length; i++) {
        if (messages[i].origin === self.origin) continue;
        if (messages[i].timestamp < self.lastMessage) continue;
        if (messages[i].id) {
          if (self.receivedIDs.hasOwnProperty(messages[i].id)) continue;
          self.receivedIDs[messages[i].id] = true;
        }
        self.trigger(messages[i].name, messages[i].payload);
      }
      self.lastMessage = now;
    });
  }

  this._trigger('storage', event);
};

Intercom.prototype._emit = function(name, message, id) {
  id = (typeof id === 'string' || typeof id === 'number') ? String(id) : null;
  if (id && id.length) {
    if (this.receivedIDs.hasOwnProperty(id)) return;
    this.receivedIDs[id] = true;
  }

  var packet = {
    id        : id,
    name      : name,
    origin    : this.origin,
    timestamp : Date.now(),
    payload   : message
  };

  var self = this;
  this._transaction(function() {
    var data = localStorage.getItem(INDEX_EMIT) || '[]';
    var delimiter = (data === '[]') ? '' : ',';
    data = [data.substring(0, data.length - 1), delimiter, JSON.stringify(packet), ']'].join('');
    localStorage.setItem(INDEX_EMIT, data);
    self.trigger(name, message);

    setTimeout(function() {
      self._cleanup_emit();
    }, 50);
  });
};

Intercom.prototype.emit = function(name, message) {
  this._emit.apply(this, arguments);
  this._trigger('emit', name, message);
};

Intercom.prototype.once = function(key, fn, ttl) {
  if (!Intercom.supported) {
    return;
  }

  var self = this;
  this._transaction(function() {
    var data;
    try {
      data = JSON.parse(localStorage.getItem(INDEX_ONCE) || '{}');
    } catch(e) {
      data = {};
    }
    if (!self._once_expired(key, data)) {
      return;
    }

    data[key] = {};
    data[key].timestamp = Date.now();
    if (typeof ttl === 'number') {
      data[key].ttl = ttl * 1000;
    }

    localStorage.setItem(INDEX_ONCE, JSON.stringify(data));
    fn();

    setTimeout(function() {
      self._cleanup_once();
    }, 50);
  });
};

extend(Intercom.prototype, EventEmitter.prototype);

Intercom.supported = (typeof localStorage !== 'undefined');

var INDEX_EMIT = 'intercom';
var INDEX_ONCE = 'intercom_once';
var INDEX_LOCK = 'intercom_lock';

var THRESHOLD_TTL_EMIT = 50000;
var THRESHOLD_TTL_ONCE = 1000 * 3600;

Intercom.destroy = function() {
  localStorage.removeItem(INDEX_LOCK);
  localStorage.removeItem(INDEX_EMIT);
  localStorage.removeItem(INDEX_ONCE);
};

Intercom.getInstance = (function() {
  var intercom;
  return function() {
    if (!intercom) {
      intercom = new Intercom();
    }
    return intercom;
  };
})();

module.exports = Intercom;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../src/shared.js":52,"./eventemitter.js":29}],31:[function(require,module,exports){
// Cherry-picked bits of underscore.js, lodash.js

/**
 * Lo-Dash 2.4.0 <http://lodash.com/>
 * Copyright 2012-2013 The Dojo Foundation <http://dojofoundation.org/>
 * Based on Underscore.js 1.5.2 <http://underscorejs.org/LICENSE>
 * Copyright 2009-2013 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 * Available under MIT license <http://lodash.com/license>
 */
var ArrayProto = Array.prototype;
var nativeForEach = ArrayProto.forEach;
var nativeIndexOf = ArrayProto.indexOf;
var nativeSome = ArrayProto.some;

var ObjProto = Object.prototype;
var hasOwnProperty = ObjProto.hasOwnProperty;
var nativeKeys = Object.keys;

var breaker = {};

function has(obj, key) {
  return hasOwnProperty.call(obj, key);
}

var keys = nativeKeys || function(obj) {
  if (obj !== Object(obj)) throw new TypeError('Invalid object');
  var keys = [];
  for (var key in obj) if (has(obj, key)) keys.push(key);
  return keys;
};

function size(obj) {
  if (obj == null) return 0;
  return (obj.length === +obj.length) ? obj.length : keys(obj).length;
}

function identity(value) {
  return value;
}

function each(obj, iterator, context) {
  var i, length;
  if (obj == null) return;
  if (nativeForEach && obj.forEach === nativeForEach) {
    obj.forEach(iterator, context);
  } else if (obj.length === +obj.length) {
    for (i = 0, length = obj.length; i < length; i++) {
      if (iterator.call(context, obj[i], i, obj) === breaker) return;
    }
  } else {
    var keys = keys(obj);
    for (i = 0, length = keys.length; i < length; i++) {
      if (iterator.call(context, obj[keys[i]], keys[i], obj) === breaker) return;
    }
  }
};

function any(obj, iterator, context) {
  iterator || (iterator = identity);
  var result = false;
  if (obj == null) return result;
  if (nativeSome && obj.some === nativeSome) return obj.some(iterator, context);
  each(obj, function(value, index, list) {
    if (result || (result = iterator.call(context, value, index, list))) return breaker;
  });
  return !!result;
};

function contains(obj, target) {
  if (obj == null) return false;
  if (nativeIndexOf && obj.indexOf === nativeIndexOf) return obj.indexOf(target) != -1;
  return any(obj, function(value) {
    return value === target;
  });
};

function Wrapped(value) {
  this.value = value;
}
Wrapped.prototype.has = function(key) {
  return has(this.value, key);
};
Wrapped.prototype.contains = function(target) {
  return contains(this.value, target);
};
Wrapped.prototype.size = function() {
  return size(this.value);
};

function nodash(value) {
  // don't wrap if already wrapped, even if wrapped by a different `lodash` constructor
  return (value && typeof value == 'object' && !Array.isArray(value) && hasOwnProperty.call(value, '__wrapped__'))
    ? value
    : new Wrapped(value);
}

module.exports = nodash;

},{}],32:[function(require,module,exports){
/*
 * base64-arraybuffer
 * https://github.com/niklasvh/base64-arraybuffer
 *
 * Copyright (c) 2012 Niklas von Hertzen
 * Licensed under the MIT license.
 */
(function(chars){
  "use strict";

  exports.encode = function(arraybuffer) {
    var bytes = new Uint8Array(arraybuffer),
    i, len = bytes.length, base64 = "";

    for (i = 0; i < len; i+=3) {
      base64 += chars[bytes[i] >> 2];
      base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
      base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
      base64 += chars[bytes[i + 2] & 63];
    }

    if ((len % 3) === 2) {
      base64 = base64.substring(0, base64.length - 1) + "=";
    } else if (len % 3 === 1) {
      base64 = base64.substring(0, base64.length - 2) + "==";
    }

    return base64;
  };

  exports.decode =  function(base64) {
    var bufferLength = base64.length * 0.75,
    len = base64.length, i, p = 0,
    encoded1, encoded2, encoded3, encoded4;

    if (base64[base64.length - 1] === "=") {
      bufferLength--;
      if (base64[base64.length - 2] === "=") {
        bufferLength--;
      }
    }

    var arraybuffer = new ArrayBuffer(bufferLength),
    bytes = new Uint8Array(arraybuffer);

    for (i = 0; i < len; i+=4) {
      encoded1 = chars.indexOf(base64[i]);
      encoded2 = chars.indexOf(base64[i+1]);
      encoded3 = chars.indexOf(base64[i+2]);
      encoded4 = chars.indexOf(base64[i+3]);

      bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }

    return arraybuffer;
  };
})("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");

},{}],33:[function(require,module,exports){
(function (process){
;(function (require, exports, module, platform) {

if (module) module.exports = minimatch
else exports.minimatch = minimatch

if (!require) {
  require = function (id) {
    switch (id) {
      case "sigmund": return function sigmund (obj) {
        return JSON.stringify(obj)
      }
      case "path": return { basename: function (f) {
        f = f.split(/[\/\\]/)
        var e = f.pop()
        if (!e) e = f.pop()
        return e
      }}
      case "lru-cache": return function LRUCache () {
        // not quite an LRU, but still space-limited.
        var cache = {}
        var cnt = 0
        this.set = function (k, v) {
          cnt ++
          if (cnt >= 100) cache = {}
          cache[k] = v
        }
        this.get = function (k) { return cache[k] }
      }
    }
  }
}

minimatch.Minimatch = Minimatch

var LRU = require("lru-cache")
  , cache = minimatch.cache = new LRU({max: 100})
  , GLOBSTAR = minimatch.GLOBSTAR = Minimatch.GLOBSTAR = {}
  , sigmund = require("sigmund")

var path = require("path")
  // any single thing other than /
  // don't need to escape / when using new RegExp()
  , qmark = "[^/]"

  // * => any number of characters
  , star = qmark + "*?"

  // ** when dots are allowed.  Anything goes, except .. and .
  // not (^ or / followed by one or two dots followed by $ or /),
  // followed by anything, any number of times.
  , twoStarDot = "(?:(?!(?:\\\/|^)(?:\\.{1,2})($|\\\/)).)*?"

  // not a ^ or / followed by a dot,
  // followed by anything, any number of times.
  , twoStarNoDot = "(?:(?!(?:\\\/|^)\\.).)*?"

  // characters that need to be escaped in RegExp.
  , reSpecials = charSet("().*{}+?[]^$\\!")

// "abc" -> { a:true, b:true, c:true }
function charSet (s) {
  return s.split("").reduce(function (set, c) {
    set[c] = true
    return set
  }, {})
}

// normalizes slashes.
var slashSplit = /\/+/

minimatch.filter = filter
function filter (pattern, options) {
  options = options || {}
  return function (p, i, list) {
    return minimatch(p, pattern, options)
  }
}

function ext (a, b) {
  a = a || {}
  b = b || {}
  var t = {}
  Object.keys(b).forEach(function (k) {
    t[k] = b[k]
  })
  Object.keys(a).forEach(function (k) {
    t[k] = a[k]
  })
  return t
}

minimatch.defaults = function (def) {
  if (!def || !Object.keys(def).length) return minimatch

  var orig = minimatch

  var m = function minimatch (p, pattern, options) {
    return orig.minimatch(p, pattern, ext(def, options))
  }

  m.Minimatch = function Minimatch (pattern, options) {
    return new orig.Minimatch(pattern, ext(def, options))
  }

  return m
}

Minimatch.defaults = function (def) {
  if (!def || !Object.keys(def).length) return Minimatch
  return minimatch.defaults(def).Minimatch
}


function minimatch (p, pattern, options) {
  if (typeof pattern !== "string") {
    throw new TypeError("glob pattern string required")
  }

  if (!options) options = {}

  // shortcut: comments match nothing.
  if (!options.nocomment && pattern.charAt(0) === "#") {
    return false
  }

  // "" only matches ""
  if (pattern.trim() === "") return p === ""

  return new Minimatch(pattern, options).match(p)
}

function Minimatch (pattern, options) {
  if (!(this instanceof Minimatch)) {
    return new Minimatch(pattern, options, cache)
  }

  if (typeof pattern !== "string") {
    throw new TypeError("glob pattern string required")
  }

  if (!options) options = {}
  pattern = pattern.trim()

  // windows: need to use /, not \
  // On other platforms, \ is a valid (albeit bad) filename char.
  if (platform === "win32") {
    pattern = pattern.split("\\").join("/")
  }

  // lru storage.
  // these things aren't particularly big, but walking down the string
  // and turning it into a regexp can get pretty costly.
  var cacheKey = pattern + "\n" + sigmund(options)
  var cached = minimatch.cache.get(cacheKey)
  if (cached) return cached
  minimatch.cache.set(cacheKey, this)

  this.options = options
  this.set = []
  this.pattern = pattern
  this.regexp = null
  this.negate = false
  this.comment = false
  this.empty = false

  // make the set of regexps etc.
  this.make()
}

Minimatch.prototype.debug = function() {}

Minimatch.prototype.make = make
function make () {
  // don't do it more than once.
  if (this._made) return

  var pattern = this.pattern
  var options = this.options

  // empty patterns and comments match nothing.
  if (!options.nocomment && pattern.charAt(0) === "#") {
    this.comment = true
    return
  }
  if (!pattern) {
    this.empty = true
    return
  }

  // step 1: figure out negation, etc.
  this.parseNegate()

  // step 2: expand braces
  var set = this.globSet = this.braceExpand()

  if (options.debug) this.debug = console.error

  this.debug(this.pattern, set)

  // step 3: now we have a set, so turn each one into a series of path-portion
  // matching patterns.
  // These will be regexps, except in the case of "**", which is
  // set to the GLOBSTAR object for globstar behavior,
  // and will not contain any / characters
  set = this.globParts = set.map(function (s) {
    return s.split(slashSplit)
  })

  this.debug(this.pattern, set)

  // glob --> regexps
  set = set.map(function (s, si, set) {
    return s.map(this.parse, this)
  }, this)

  this.debug(this.pattern, set)

  // filter out everything that didn't compile properly.
  set = set.filter(function (s) {
    return -1 === s.indexOf(false)
  })

  this.debug(this.pattern, set)

  this.set = set
}

Minimatch.prototype.parseNegate = parseNegate
function parseNegate () {
  var pattern = this.pattern
    , negate = false
    , options = this.options
    , negateOffset = 0

  if (options.nonegate) return

  for ( var i = 0, l = pattern.length
      ; i < l && pattern.charAt(i) === "!"
      ; i ++) {
    negate = !negate
    negateOffset ++
  }

  if (negateOffset) this.pattern = pattern.substr(negateOffset)
  this.negate = negate
}

// Brace expansion:
// a{b,c}d -> abd acd
// a{b,}c -> abc ac
// a{0..3}d -> a0d a1d a2d a3d
// a{b,c{d,e}f}g -> abg acdfg acefg
// a{b,c}d{e,f}g -> abdeg acdeg abdeg abdfg
//
// Invalid sets are not expanded.
// a{2..}b -> a{2..}b
// a{b}c -> a{b}c
minimatch.braceExpand = function (pattern, options) {
  return new Minimatch(pattern, options).braceExpand()
}

Minimatch.prototype.braceExpand = braceExpand

function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

function braceExpand (pattern, options) {
  options = options || this.options
  pattern = typeof pattern === "undefined"
    ? this.pattern : pattern

  if (typeof pattern === "undefined") {
    throw new Error("undefined pattern")
  }

  if (options.nobrace ||
      !pattern.match(/\{.*\}/)) {
    // shortcut. no need to expand.
    return [pattern]
  }

  var escaping = false

  // examples and comments refer to this crazy pattern:
  // a{b,c{d,e},{f,g}h}x{y,z}
  // expected:
  // abxy
  // abxz
  // acdxy
  // acdxz
  // acexy
  // acexz
  // afhxy
  // afhxz
  // aghxy
  // aghxz

  // everything before the first \{ is just a prefix.
  // So, we pluck that off, and work with the rest,
  // and then prepend it to everything we find.
  if (pattern.charAt(0) !== "{") {
    this.debug(pattern)
    var prefix = null
    for (var i = 0, l = pattern.length; i < l; i ++) {
      var c = pattern.charAt(i)
      this.debug(i, c)
      if (c === "\\") {
        escaping = !escaping
      } else if (c === "{" && !escaping) {
        prefix = pattern.substr(0, i)
        break
      }
    }

    // actually no sets, all { were escaped.
    if (prefix === null) {
      this.debug("no sets")
      return [pattern]
    }

   var tail = braceExpand.call(this, pattern.substr(i), options)
    return tail.map(function (t) {
      return prefix + t
    })
  }

  // now we have something like:
  // {b,c{d,e},{f,g}h}x{y,z}
  // walk through the set, expanding each part, until
  // the set ends.  then, we'll expand the suffix.
  // If the set only has a single member, then'll put the {} back

  // first, handle numeric sets, since they're easier
  var numset = pattern.match(/^\{(-?[0-9]+)\.\.(-?[0-9]+)\}/)
  if (numset) {
    this.debug("numset", numset[1], numset[2])
    var suf = braceExpand.call(this, pattern.substr(numset[0].length), options)
      , start = +numset[1]
      , needPadding = numset[1][0] === '0'
      , startWidth = numset[1].length
      , padded
      , end = +numset[2]
      , inc = start > end ? -1 : 1
      , set = []

    for (var i = start; i != (end + inc); i += inc) {
      padded = needPadding ? pad(i, startWidth) : i + ''
      // append all the suffixes
      for (var ii = 0, ll = suf.length; ii < ll; ii ++) {
        set.push(padded + suf[ii])
      }
    }
    return set
  }

  // ok, walk through the set
  // We hope, somewhat optimistically, that there
  // will be a } at the end.
  // If the closing brace isn't found, then the pattern is
  // interpreted as braceExpand("\\" + pattern) so that
  // the leading \{ will be interpreted literally.
  var i = 1 // skip the \{
    , depth = 1
    , set = []
    , member = ""
    , sawEnd = false
    , escaping = false

  function addMember () {
    set.push(member)
    member = ""
  }

  this.debug("Entering for")
  FOR: for (i = 1, l = pattern.length; i < l; i ++) {
    var c = pattern.charAt(i)
    this.debug("", i, c)

    if (escaping) {
      escaping = false
      member += "\\" + c
    } else {
      switch (c) {
        case "\\":
          escaping = true
          continue

        case "{":
          depth ++
          member += "{"
          continue

        case "}":
          depth --
          // if this closes the actual set, then we're done
          if (depth === 0) {
            addMember()
            // pluck off the close-brace
            i ++
            break FOR
          } else {
            member += c
            continue
          }

        case ",":
          if (depth === 1) {
            addMember()
          } else {
            member += c
          }
          continue

        default:
          member += c
          continue
      } // switch
    } // else
  } // for

  // now we've either finished the set, and the suffix is
  // pattern.substr(i), or we have *not* closed the set,
  // and need to escape the leading brace
  if (depth !== 0) {
    this.debug("didn't close", pattern)
    return braceExpand.call(this, "\\" + pattern, options)
  }

  // x{y,z} -> ["xy", "xz"]
  this.debug("set", set)
  this.debug("suffix", pattern.substr(i))
  var suf = braceExpand.call(this, pattern.substr(i), options)
  // ["b", "c{d,e}","{f,g}h"] ->
  //   [["b"], ["cd", "ce"], ["fh", "gh"]]
  var addBraces = set.length === 1
  this.debug("set pre-expanded", set)
  set = set.map(function (p) {
    return braceExpand.call(this, p, options)
  }, this)
  this.debug("set expanded", set)


  // [["b"], ["cd", "ce"], ["fh", "gh"]] ->
  //   ["b", "cd", "ce", "fh", "gh"]
  set = set.reduce(function (l, r) {
    return l.concat(r)
  })

  if (addBraces) {
    set = set.map(function (s) {
      return "{" + s + "}"
    })
  }

  // now attach the suffixes.
  var ret = []
  for (var i = 0, l = set.length; i < l; i ++) {
    for (var ii = 0, ll = suf.length; ii < ll; ii ++) {
      ret.push(set[i] + suf[ii])
    }
  }
  return ret
}

// parse a component of the expanded set.
// At this point, no pattern may contain "/" in it
// so we're going to return a 2d array, where each entry is the full
// pattern, split on '/', and then turned into a regular expression.
// A regexp is made at the end which joins each array with an
// escaped /, and another full one which joins each regexp with |.
//
// Following the lead of Bash 4.1, note that "**" only has special meaning
// when it is the *only* thing in a path portion.  Otherwise, any series
// of * is equivalent to a single *.  Globstar behavior is enabled by
// default, and can be disabled by setting options.noglobstar.
Minimatch.prototype.parse = parse
var SUBPARSE = {}
function parse (pattern, isSub) {
  var options = this.options

  // shortcuts
  if (!options.noglobstar && pattern === "**") return GLOBSTAR
  if (pattern === "") return ""

  var re = ""
    , hasMagic = !!options.nocase
    , escaping = false
    // ? => one single character
    , patternListStack = []
    , plType
    , stateChar
    , inClass = false
    , reClassStart = -1
    , classStart = -1
    // . and .. never match anything that doesn't start with .,
    // even when options.dot is set.
    , patternStart = pattern.charAt(0) === "." ? "" // anything
      // not (start or / followed by . or .. followed by / or end)
      : options.dot ? "(?!(?:^|\\\/)\\.{1,2}(?:$|\\\/))"
      : "(?!\\.)"
    , self = this

  function clearStateChar () {
    if (stateChar) {
      // we had some state-tracking character
      // that wasn't consumed by this pass.
      switch (stateChar) {
        case "*":
          re += star
          hasMagic = true
          break
        case "?":
          re += qmark
          hasMagic = true
          break
        default:
          re += "\\"+stateChar
          break
      }
      self.debug('clearStateChar %j %j', stateChar, re)
      stateChar = false
    }
  }

  for ( var i = 0, len = pattern.length, c
      ; (i < len) && (c = pattern.charAt(i))
      ; i ++ ) {

    this.debug("%s\t%s %s %j", pattern, i, re, c)

    // skip over any that are escaped.
    if (escaping && reSpecials[c]) {
      re += "\\" + c
      escaping = false
      continue
    }

    SWITCH: switch (c) {
      case "/":
        // completely not allowed, even escaped.
        // Should already be path-split by now.
        return false

      case "\\":
        clearStateChar()
        escaping = true
        continue

      // the various stateChar values
      // for the "extglob" stuff.
      case "?":
      case "*":
      case "+":
      case "@":
      case "!":
        this.debug("%s\t%s %s %j <-- stateChar", pattern, i, re, c)

        // all of those are literals inside a class, except that
        // the glob [!a] means [^a] in regexp
        if (inClass) {
          this.debug('  in class')
          if (c === "!" && i === classStart + 1) c = "^"
          re += c
          continue
        }

        // if we already have a stateChar, then it means
        // that there was something like ** or +? in there.
        // Handle the stateChar, then proceed with this one.
        self.debug('call clearStateChar %j', stateChar)
        clearStateChar()
        stateChar = c
        // if extglob is disabled, then +(asdf|foo) isn't a thing.
        // just clear the statechar *now*, rather than even diving into
        // the patternList stuff.
        if (options.noext) clearStateChar()
        continue

      case "(":
        if (inClass) {
          re += "("
          continue
        }

        if (!stateChar) {
          re += "\\("
          continue
        }

        plType = stateChar
        patternListStack.push({ type: plType
                              , start: i - 1
                              , reStart: re.length })
        // negation is (?:(?!js)[^/]*)
        re += stateChar === "!" ? "(?:(?!" : "(?:"
        this.debug('plType %j %j', stateChar, re)
        stateChar = false
        continue

      case ")":
        if (inClass || !patternListStack.length) {
          re += "\\)"
          continue
        }

        clearStateChar()
        hasMagic = true
        re += ")"
        plType = patternListStack.pop().type
        // negation is (?:(?!js)[^/]*)
        // The others are (?:<pattern>)<type>
        switch (plType) {
          case "!":
            re += "[^/]*?)"
            break
          case "?":
          case "+":
          case "*": re += plType
          case "@": break // the default anyway
        }
        continue

      case "|":
        if (inClass || !patternListStack.length || escaping) {
          re += "\\|"
          escaping = false
          continue
        }

        clearStateChar()
        re += "|"
        continue

      // these are mostly the same in regexp and glob
      case "[":
        // swallow any state-tracking char before the [
        clearStateChar()

        if (inClass) {
          re += "\\" + c
          continue
        }

        inClass = true
        classStart = i
        reClassStart = re.length
        re += c
        continue

      case "]":
        //  a right bracket shall lose its special
        //  meaning and represent itself in
        //  a bracket expression if it occurs
        //  first in the list.  -- POSIX.2 2.8.3.2
        if (i === classStart + 1 || !inClass) {
          re += "\\" + c
          escaping = false
          continue
        }

        // finish up the class.
        hasMagic = true
        inClass = false
        re += c
        continue

      default:
        // swallow any state char that wasn't consumed
        clearStateChar()

        if (escaping) {
          // no need
          escaping = false
        } else if (reSpecials[c]
                   && !(c === "^" && inClass)) {
          re += "\\"
        }

        re += c

    } // switch
  } // for


  // handle the case where we left a class open.
  // "[abc" is valid, equivalent to "\[abc"
  if (inClass) {
    // split where the last [ was, and escape it
    // this is a huge pita.  We now have to re-walk
    // the contents of the would-be class to re-translate
    // any characters that were passed through as-is
    var cs = pattern.substr(classStart + 1)
      , sp = this.parse(cs, SUBPARSE)
    re = re.substr(0, reClassStart) + "\\[" + sp[0]
    hasMagic = hasMagic || sp[1]
  }

  // handle the case where we had a +( thing at the *end*
  // of the pattern.
  // each pattern list stack adds 3 chars, and we need to go through
  // and escape any | chars that were passed through as-is for the regexp.
  // Go through and escape them, taking care not to double-escape any
  // | chars that were already escaped.
  var pl
  while (pl = patternListStack.pop()) {
    var tail = re.slice(pl.reStart + 3)
    // maybe some even number of \, then maybe 1 \, followed by a |
    tail = tail.replace(/((?:\\{2})*)(\\?)\|/g, function (_, $1, $2) {
      if (!$2) {
        // the | isn't already escaped, so escape it.
        $2 = "\\"
      }

      // need to escape all those slashes *again*, without escaping the
      // one that we need for escaping the | character.  As it works out,
      // escaping an even number of slashes can be done by simply repeating
      // it exactly after itself.  That's why this trick works.
      //
      // I am sorry that you have to see this.
      return $1 + $1 + $2 + "|"
    })

    this.debug("tail=%j\n   %s", tail, tail)
    var t = pl.type === "*" ? star
          : pl.type === "?" ? qmark
          : "\\" + pl.type

    hasMagic = true
    re = re.slice(0, pl.reStart)
       + t + "\\("
       + tail
  }

  // handle trailing things that only matter at the very end.
  clearStateChar()
  if (escaping) {
    // trailing \\
    re += "\\\\"
  }

  // only need to apply the nodot start if the re starts with
  // something that could conceivably capture a dot
  var addPatternStart = false
  switch (re.charAt(0)) {
    case ".":
    case "[":
    case "(": addPatternStart = true
  }

  // if the re is not "" at this point, then we need to make sure
  // it doesn't match against an empty path part.
  // Otherwise a/* will match a/, which it should not.
  if (re !== "" && hasMagic) re = "(?=.)" + re

  if (addPatternStart) re = patternStart + re

  // parsing just a piece of a larger pattern.
  if (isSub === SUBPARSE) {
    return [ re, hasMagic ]
  }

  // skip the regexp for non-magical patterns
  // unescape anything in it, though, so that it'll be
  // an exact match against a file etc.
  if (!hasMagic) {
    return globUnescape(pattern)
  }

  var flags = options.nocase ? "i" : ""
    , regExp = new RegExp("^" + re + "$", flags)

  regExp._glob = pattern
  regExp._src = re

  return regExp
}

minimatch.makeRe = function (pattern, options) {
  return new Minimatch(pattern, options || {}).makeRe()
}

Minimatch.prototype.makeRe = makeRe
function makeRe () {
  if (this.regexp || this.regexp === false) return this.regexp

  // at this point, this.set is a 2d array of partial
  // pattern strings, or "**".
  //
  // It's better to use .match().  This function shouldn't
  // be used, really, but it's pretty convenient sometimes,
  // when you just want to work with a regex.
  var set = this.set

  if (!set.length) return this.regexp = false
  var options = this.options

  var twoStar = options.noglobstar ? star
      : options.dot ? twoStarDot
      : twoStarNoDot
    , flags = options.nocase ? "i" : ""

  var re = set.map(function (pattern) {
    return pattern.map(function (p) {
      return (p === GLOBSTAR) ? twoStar
           : (typeof p === "string") ? regExpEscape(p)
           : p._src
    }).join("\\\/")
  }).join("|")

  // must match entire pattern
  // ending in a * or ** will make it less strict.
  re = "^(?:" + re + ")$"

  // can match anything, as long as it's not this.
  if (this.negate) re = "^(?!" + re + ").*$"

  try {
    return this.regexp = new RegExp(re, flags)
  } catch (ex) {
    return this.regexp = false
  }
}

minimatch.match = function (list, pattern, options) {
  options = options || {}
  var mm = new Minimatch(pattern, options)
  list = list.filter(function (f) {
    return mm.match(f)
  })
  if (mm.options.nonull && !list.length) {
    list.push(pattern)
  }
  return list
}

Minimatch.prototype.match = match
function match (f, partial) {
  this.debug("match", f, this.pattern)
  // short-circuit in the case of busted things.
  // comments, etc.
  if (this.comment) return false
  if (this.empty) return f === ""

  if (f === "/" && partial) return true

  var options = this.options

  // windows: need to use /, not \
  // On other platforms, \ is a valid (albeit bad) filename char.
  if (platform === "win32") {
    f = f.split("\\").join("/")
  }

  // treat the test path as a set of pathparts.
  f = f.split(slashSplit)
  this.debug(this.pattern, "split", f)

  // just ONE of the pattern sets in this.set needs to match
  // in order for it to be valid.  If negating, then just one
  // match means that we have failed.
  // Either way, return on the first hit.

  var set = this.set
  this.debug(this.pattern, "set", set)

  // Find the basename of the path by looking for the last non-empty segment
  var filename;
  for (var i = f.length - 1; i >= 0; i--) {
    filename = f[i]
    if (filename) break
  }

  for (var i = 0, l = set.length; i < l; i ++) {
    var pattern = set[i], file = f
    if (options.matchBase && pattern.length === 1) {
      file = [filename]
    }
    var hit = this.matchOne(file, pattern, partial)
    if (hit) {
      if (options.flipNegate) return true
      return !this.negate
    }
  }

  // didn't get any hits.  this is success if it's a negative
  // pattern, failure otherwise.
  if (options.flipNegate) return false
  return this.negate
}

// set partial to true to test if, for example,
// "/a/b" matches the start of "/*/b/*/d"
// Partial means, if you run out of file before you run
// out of pattern, then that's fine, as long as all
// the parts match.
Minimatch.prototype.matchOne = function (file, pattern, partial) {
  var options = this.options

  this.debug("matchOne",
              { "this": this
              , file: file
              , pattern: pattern })

  this.debug("matchOne", file.length, pattern.length)

  for ( var fi = 0
          , pi = 0
          , fl = file.length
          , pl = pattern.length
      ; (fi < fl) && (pi < pl)
      ; fi ++, pi ++ ) {

    this.debug("matchOne loop")
    var p = pattern[pi]
      , f = file[fi]

    this.debug(pattern, p, f)

    // should be impossible.
    // some invalid regexp stuff in the set.
    if (p === false) return false

    if (p === GLOBSTAR) {
      this.debug('GLOBSTAR', [pattern, p, f])

      // "**"
      // a/**/b/**/c would match the following:
      // a/b/x/y/z/c
      // a/x/y/z/b/c
      // a/b/x/b/x/c
      // a/b/c
      // To do this, take the rest of the pattern after
      // the **, and see if it would match the file remainder.
      // If so, return success.
      // If not, the ** "swallows" a segment, and try again.
      // This is recursively awful.
      //
      // a/**/b/**/c matching a/b/x/y/z/c
      // - a matches a
      // - doublestar
      //   - matchOne(b/x/y/z/c, b/**/c)
      //     - b matches b
      //     - doublestar
      //       - matchOne(x/y/z/c, c) -> no
      //       - matchOne(y/z/c, c) -> no
      //       - matchOne(z/c, c) -> no
      //       - matchOne(c, c) yes, hit
      var fr = fi
        , pr = pi + 1
      if (pr === pl) {
        this.debug('** at the end')
        // a ** at the end will just swallow the rest.
        // We have found a match.
        // however, it will not swallow /.x, unless
        // options.dot is set.
        // . and .. are *never* matched by **, for explosively
        // exponential reasons.
        for ( ; fi < fl; fi ++) {
          if (file[fi] === "." || file[fi] === ".." ||
              (!options.dot && file[fi].charAt(0) === ".")) return false
        }
        return true
      }

      // ok, let's see if we can swallow whatever we can.
      WHILE: while (fr < fl) {
        var swallowee = file[fr]

        this.debug('\nglobstar while',
                    file, fr, pattern, pr, swallowee)

        // XXX remove this slice.  Just pass the start index.
        if (this.matchOne(file.slice(fr), pattern.slice(pr), partial)) {
          this.debug('globstar found match!', fr, fl, swallowee)
          // found a match.
          return true
        } else {
          // can't swallow "." or ".." ever.
          // can only swallow ".foo" when explicitly asked.
          if (swallowee === "." || swallowee === ".." ||
              (!options.dot && swallowee.charAt(0) === ".")) {
            this.debug("dot detected!", file, fr, pattern, pr)
            break WHILE
          }

          // ** swallows a segment, and continue.
          this.debug('globstar swallow a segment, and continue')
          fr ++
        }
      }
      // no match was found.
      // However, in partial mode, we can't say this is necessarily over.
      // If there's more *pattern* left, then
      if (partial) {
        // ran out of file
        this.debug("\n>>> no match, partial?", file, fr, pattern, pr)
        if (fr === fl) return true
      }
      return false
    }

    // something other than **
    // non-magic patterns just have to match exactly
    // patterns with magic have been turned into regexps.
    var hit
    if (typeof p === "string") {
      if (options.nocase) {
        hit = f.toLowerCase() === p.toLowerCase()
      } else {
        hit = f === p
      }
      this.debug("string match", p, f, hit)
    } else {
      hit = f.match(p)
      this.debug("pattern match", p, f, hit)
    }

    if (!hit) return false
  }

  // Note: ending in / means that we'll get a final ""
  // at the end of the pattern.  This can only match a
  // corresponding "" at the end of the file.
  // If the file ends in /, then it can only match a
  // a pattern that ends in /, unless the pattern just
  // doesn't have any more for it. But, a/b/ should *not*
  // match "a/b/*", even though "" matches against the
  // [^/]*? pattern, except in partial mode, where it might
  // simply not be reached yet.
  // However, a/b/ should still satisfy a/*

  // now either we fell off the end of the pattern, or we're done.
  if (fi === fl && pi === pl) {
    // ran out of pattern and filename at the same time.
    // an exact hit!
    return true
  } else if (fi === fl) {
    // ran out of file, but still had pattern left.
    // this is ok if we're doing the match as part of
    // a glob fs traversal.
    return partial
  } else if (pi === pl) {
    // ran out of pattern, still have file left.
    // this is only acceptable if we're on the very last
    // empty segment of a file with a trailing slash.
    // a/* should match a/b/
    var emptyFileEnd = (fi === fl - 1) && (file[fi] === "")
    return emptyFileEnd
  }

  // should be unreachable.
  throw new Error("wtf?")
}


// replace stuff like \* with *
function globUnescape (s) {
  return s.replace(/\\(.)/g, "$1")
}


function regExpEscape (s) {
  return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")
}

})( typeof require === "function" ? require : null,
    this,
    typeof module === "object" ? module : null,
    typeof process === "object" ? process.platform : "win32"
  )

}).call(this,require('_process'))
},{"_process":62,"lru-cache":34,"path":61,"sigmund":35}],34:[function(require,module,exports){
;(function () { // closure for web browsers

if (typeof module === 'object' && module.exports) {
  module.exports = LRUCache
} else {
  // just set the global for non-node platforms.
  this.LRUCache = LRUCache
}

function hOP (obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function naiveLength () { return 1 }

function LRUCache (options) {
  if (!(this instanceof LRUCache))
    return new LRUCache(options)

  if (typeof options === 'number')
    options = { max: options }

  if (!options)
    options = {}

  this._max = options.max
  // Kind of weird to have a default max of Infinity, but oh well.
  if (!this._max || !(typeof this._max === "number") || this._max <= 0 )
    this._max = Infinity

  this._lengthCalculator = options.length || naiveLength
  if (typeof this._lengthCalculator !== "function")
    this._lengthCalculator = naiveLength

  this._allowStale = options.stale || false
  this._maxAge = options.maxAge || null
  this._dispose = options.dispose
  this.reset()
}

// resize the cache when the max changes.
Object.defineProperty(LRUCache.prototype, "max",
  { set : function (mL) {
      if (!mL || !(typeof mL === "number") || mL <= 0 ) mL = Infinity
      this._max = mL
      if (this._length > this._max) trim(this)
    }
  , get : function () { return this._max }
  , enumerable : true
  })

// resize the cache when the lengthCalculator changes.
Object.defineProperty(LRUCache.prototype, "lengthCalculator",
  { set : function (lC) {
      if (typeof lC !== "function") {
        this._lengthCalculator = naiveLength
        this._length = this._itemCount
        for (var key in this._cache) {
          this._cache[key].length = 1
        }
      } else {
        this._lengthCalculator = lC
        this._length = 0
        for (var key in this._cache) {
          this._cache[key].length = this._lengthCalculator(this._cache[key].value)
          this._length += this._cache[key].length
        }
      }

      if (this._length > this._max) trim(this)
    }
  , get : function () { return this._lengthCalculator }
  , enumerable : true
  })

Object.defineProperty(LRUCache.prototype, "length",
  { get : function () { return this._length }
  , enumerable : true
  })


Object.defineProperty(LRUCache.prototype, "itemCount",
  { get : function () { return this._itemCount }
  , enumerable : true
  })

LRUCache.prototype.forEach = function (fn, thisp) {
  thisp = thisp || this
  var i = 0;
  for (var k = this._mru - 1; k >= 0 && i < this._itemCount; k--) if (this._lruList[k]) {
    i++
    var hit = this._lruList[k]
    if (this._maxAge && (Date.now() - hit.now > this._maxAge)) {
      del(this, hit)
      if (!this._allowStale) hit = undefined
    }
    if (hit) {
      fn.call(thisp, hit.value, hit.key, this)
    }
  }
}

LRUCache.prototype.keys = function () {
  var keys = new Array(this._itemCount)
  var i = 0
  for (var k = this._mru - 1; k >= 0 && i < this._itemCount; k--) if (this._lruList[k]) {
    var hit = this._lruList[k]
    keys[i++] = hit.key
  }
  return keys
}

LRUCache.prototype.values = function () {
  var values = new Array(this._itemCount)
  var i = 0
  for (var k = this._mru - 1; k >= 0 && i < this._itemCount; k--) if (this._lruList[k]) {
    var hit = this._lruList[k]
    values[i++] = hit.value
  }
  return values
}

LRUCache.prototype.reset = function () {
  if (this._dispose && this._cache) {
    for (var k in this._cache) {
      this._dispose(k, this._cache[k].value)
    }
  }

  this._cache = Object.create(null) // hash of items by key
  this._lruList = Object.create(null) // list of items in order of use recency
  this._mru = 0 // most recently used
  this._lru = 0 // least recently used
  this._length = 0 // number of items in the list
  this._itemCount = 0
}

// Provided for debugging/dev purposes only. No promises whatsoever that
// this API stays stable.
LRUCache.prototype.dump = function () {
  return this._cache
}

LRUCache.prototype.dumpLru = function () {
  return this._lruList
}

LRUCache.prototype.set = function (key, value) {
  if (hOP(this._cache, key)) {
    // dispose of the old one before overwriting
    if (this._dispose) this._dispose(key, this._cache[key].value)
    if (this._maxAge) this._cache[key].now = Date.now()
    this._cache[key].value = value
    this.get(key)
    return true
  }

  var len = this._lengthCalculator(value)
  var age = this._maxAge ? Date.now() : 0
  var hit = new Entry(key, value, this._mru++, len, age)

  // oversized objects fall out of cache automatically.
  if (hit.length > this._max) {
    if (this._dispose) this._dispose(key, value)
    return false
  }

  this._length += hit.length
  this._lruList[hit.lu] = this._cache[key] = hit
  this._itemCount ++

  if (this._length > this._max) trim(this)
  return true
}

LRUCache.prototype.has = function (key) {
  if (!hOP(this._cache, key)) return false
  var hit = this._cache[key]
  if (this._maxAge && (Date.now() - hit.now > this._maxAge)) {
    return false
  }
  return true
}

LRUCache.prototype.get = function (key) {
  return get(this, key, true)
}

LRUCache.prototype.peek = function (key) {
  return get(this, key, false)
}

LRUCache.prototype.pop = function () {
  var hit = this._lruList[this._lru]
  del(this, hit)
  return hit || null
}

LRUCache.prototype.del = function (key) {
  del(this, this._cache[key])
}

function get (self, key, doUse) {
  var hit = self._cache[key]
  if (hit) {
    if (self._maxAge && (Date.now() - hit.now > self._maxAge)) {
      del(self, hit)
      if (!self._allowStale) hit = undefined
    } else {
      if (doUse) use(self, hit)
    }
    if (hit) hit = hit.value
  }
  return hit
}

function use (self, hit) {
  shiftLU(self, hit)
  hit.lu = self._mru ++
  self._lruList[hit.lu] = hit
}

function trim (self) {
  while (self._lru < self._mru && self._length > self._max)
    del(self, self._lruList[self._lru])
}

function shiftLU (self, hit) {
  delete self._lruList[ hit.lu ]
  while (self._lru < self._mru && !self._lruList[self._lru]) self._lru ++
}

function del (self, hit) {
  if (hit) {
    if (self._dispose) self._dispose(hit.key, hit.value)
    self._length -= hit.length
    self._itemCount --
    delete self._cache[ hit.key ]
    shiftLU(self, hit)
  }
}

// classy, since V8 prefers predictable objects.
function Entry (key, value, lu, length, now) {
  this.key = key
  this.value = value
  this.lu = lu
  this.length = length
  this.now = now
}

})()

},{}],35:[function(require,module,exports){
module.exports = sigmund
function sigmund (subject, maxSessions) {
    maxSessions = maxSessions || 10;
    var notes = [];
    var analysis = '';
    var RE = RegExp;

    function psychoAnalyze (subject, session) {
        if (session > maxSessions) return;

        if (typeof subject === 'function' ||
            typeof subject === 'undefined') {
            return;
        }

        if (typeof subject !== 'object' || !subject ||
            (subject instanceof RE)) {
            analysis += subject;
            return;
        }

        if (notes.indexOf(subject) !== -1 || session === maxSessions) return;

        notes.push(subject);
        analysis += '{';
        Object.keys(subject).forEach(function (issue, _, __) {
            // pseudo-private values.  skip those.
            if (issue.charAt(0) === '_') return;
            var to = typeof subject[issue];
            if (to === 'function' || to === 'undefined') return;
            analysis += issue;
            psychoAnalyze(subject[issue], session + 1);
        });
    }
    psychoAnalyze(subject, 0);
    return analysis;
}

// vim: set softtabstop=4 shiftwidth=4:

},{}],36:[function(require,module,exports){
(function (Buffer){
function FilerBuffer (subject, encoding, nonZero) {

  // Automatically turn ArrayBuffer into Uint8Array so that underlying
  // Buffer code doesn't just throw away and ignore ArrayBuffer data.
  if (subject instanceof ArrayBuffer) {
    subject = new Uint8Array(subject);
  }

  return new Buffer(subject, encoding, nonZero);
};

// Inherit prototype from Buffer
FilerBuffer.prototype = Object.create(Buffer.prototype);
FilerBuffer.prototype.constructor = FilerBuffer;

// Also copy static methods onto FilerBuffer ctor
Object.keys(Buffer).forEach(function (p) {
  if (Buffer.hasOwnProperty(p)) {
    FilerBuffer[p] = Buffer[p];
  }
});

module.exports = FilerBuffer;

}).call(this,require("buffer").Buffer)
},{"buffer":57}],37:[function(require,module,exports){
var O_READ = 'READ';
var O_WRITE = 'WRITE';
var O_CREATE = 'CREATE';
var O_EXCLUSIVE = 'EXCLUSIVE';
var O_TRUNCATE = 'TRUNCATE';
var O_APPEND = 'APPEND';
var XATTR_CREATE = 'CREATE';
var XATTR_REPLACE = 'REPLACE';

module.exports = {
  FILE_SYSTEM_NAME: 'local',

  FILE_STORE_NAME: 'files',

  IDB_RO: 'readonly',
  IDB_RW: 'readwrite',

  WSQL_VERSION: "1",
  WSQL_SIZE: 5 * 1024 * 1024,
  WSQL_DESC: "FileSystem Storage",

  MODE_FILE: 'FILE',
  MODE_DIRECTORY: 'DIRECTORY',
  MODE_SYMBOLIC_LINK: 'SYMLINK',
  MODE_META: 'META',

  SYMLOOP_MAX: 10,

  BINARY_MIME_TYPE: 'application/octet-stream',
  JSON_MIME_TYPE: 'application/json',

  ROOT_DIRECTORY_NAME: '/', // basename(normalize(path))

  // FS Mount Flags
  FS_FORMAT: 'FORMAT',
  FS_NOCTIME: 'NOCTIME',
  FS_NOMTIME: 'NOMTIME',
  FS_NODUPEIDCHECK: 'FS_NODUPEIDCHECK',

  // FS File Open Flags
  O_READ: O_READ,
  O_WRITE: O_WRITE,
  O_CREATE: O_CREATE,
  O_EXCLUSIVE: O_EXCLUSIVE,
  O_TRUNCATE: O_TRUNCATE,
  O_APPEND: O_APPEND,

  O_FLAGS: {
    'r': [O_READ],
    'r+': [O_READ, O_WRITE],
    'w': [O_WRITE, O_CREATE, O_TRUNCATE],
    'w+': [O_WRITE, O_READ, O_CREATE, O_TRUNCATE],
    'wx': [O_WRITE, O_CREATE, O_EXCLUSIVE, O_TRUNCATE],
    'wx+': [O_WRITE, O_READ, O_CREATE, O_EXCLUSIVE, O_TRUNCATE],
    'a': [O_WRITE, O_CREATE, O_APPEND],
    'a+': [O_WRITE, O_READ, O_CREATE, O_APPEND],
    'ax': [O_WRITE, O_CREATE, O_EXCLUSIVE, O_APPEND],
    'ax+': [O_WRITE, O_READ, O_CREATE, O_EXCLUSIVE, O_APPEND]
  },

  XATTR_CREATE: XATTR_CREATE,
  XATTR_REPLACE: XATTR_REPLACE,

  FS_READY: 'READY',
  FS_PENDING: 'PENDING',
  FS_ERROR: 'ERROR',

  SUPER_NODE_ID: '00000000-0000-0000-0000-000000000000',

  // Reserved File Descriptors for streams
  STDIN: 0,
  STDOUT: 1,
  STDERR: 2,
  FIRST_DESCRIPTOR: 3,

  ENVIRONMENT: {
    TMP: '/tmp',
    PATH: ''
  }
};

},{}],38:[function(require,module,exports){
var MODE_FILE = require('./constants.js').MODE_FILE;

module.exports = function DirectoryEntry(id, type) {
  this.id = id;
  this.type = type || MODE_FILE;
};

},{"./constants.js":37}],39:[function(require,module,exports){
(function (Buffer){
// Adapt encodings to work with Buffer or Uint8Array, they expect the latter
function decode(buf) {
  return buf.toString('utf8');
}

function encode(string) {
  return new Buffer(string, 'utf8');
}

module.exports = {
  encode: encode,
  decode: decode
};

}).call(this,require("buffer").Buffer)
},{"buffer":57}],40:[function(require,module,exports){
var errors = {};
[
  /**
   * node.js errors - we only use some of these, add as needed.
   */
  //'-1:UNKNOWN:unknown error',
  //'0:OK:success',
  //'1:EOF:end of file',
  //'2:EADDRINFO:getaddrinfo error',
  //'3:EACCES:permission denied',
  //'4:EAGAIN:resource temporarily unavailable',
  //'5:EADDRINUSE:address already in use',
  //'6:EADDRNOTAVAIL:address not available',
  //'7:EAFNOSUPPORT:address family not supported',
  //'8:EALREADY:connection already in progress',
  '9:EBADF:bad file descriptor',
  '10:EBUSY:resource busy or locked',
  //'11:ECONNABORTED:software caused connection abort',
  //'12:ECONNREFUSED:connection refused',
  //'13:ECONNRESET:connection reset by peer',
  //'14:EDESTADDRREQ:destination address required',
  //'15:EFAULT:bad address in system call argument',
  //'16:EHOSTUNREACH:host is unreachable',
  //'17:EINTR:interrupted system call',
  '18:EINVAL:invalid argument',
  //'19:EISCONN:socket is already connected',
  //'20:EMFILE:too many open files',
  //'21:EMSGSIZE:message too long',
  //'22:ENETDOWN:network is down',
  //'23:ENETUNREACH:network is unreachable',
  //'24:ENFILE:file table overflow',
  //'25:ENOBUFS:no buffer space available',
  //'26:ENOMEM:not enough memory',
  '27:ENOTDIR:not a directory',
  '28:EISDIR:illegal operation on a directory',
  //'29:ENONET:machine is not on the network',
  // errno 30 skipped, as per https://github.com/rvagg/node-errno/blob/master/errno.js
  //'31:ENOTCONN:socket is not connected',
  //'32:ENOTSOCK:socket operation on non-socket',
  //'33:ENOTSUP:operation not supported on socket',
  '34:ENOENT:no such file or directory',
  //'35:ENOSYS:function not implemented',
  //'36:EPIPE:broken pipe',
  //'37:EPROTO:protocol error',
  //'38:EPROTONOSUPPORT:protocol not supported',
  //'39:EPROTOTYPE:protocol wrong type for socket',
  //'40:ETIMEDOUT:connection timed out',
  //'41:ECHARSET:invalid Unicode character',
  //'42:EAIFAMNOSUPPORT:address family for hostname not supported',
  // errno 43 skipped, as per https://github.com/rvagg/node-errno/blob/master/errno.js
  //'44:EAISERVICE:servname not supported for ai_socktype',
  //'45:EAISOCKTYPE:ai_socktype not supported',
  //'46:ESHUTDOWN:cannot send after transport endpoint shutdown',
  '47:EEXIST:file already exists',
  //'48:ESRCH:no such process',
  //'49:ENAMETOOLONG:name too long',
  '50:EPERM:operation not permitted',
  '51:ELOOP:too many symbolic links encountered',
  //'52:EXDEV:cross-device link not permitted',
  '53:ENOTEMPTY:directory not empty',
  //'54:ENOSPC:no space left on device',
  '55:EIO:i/o error',
  //'56:EROFS:read-only file system',
  //'57:ENODEV:no such device',
  //'58:ESPIPE:invalid seek',
  //'59:ECANCELED:operation canceled',

  /**
   * Filer specific errors
   */
  '1000:ENOTMOUNTED:not mounted',
  '1001:EFILESYSTEMERROR:missing super node, use \'FORMAT\' flag to format filesystem.',
  '1002:ENOATTR:attribute does not exist'

].forEach(function(e) {
  e = e.split(':');
  var errno = +e[0];
  var errName = e[1];
  var defaultMessage = e[2];

  function FilerError(msg, path) {
    Error.call(this);

    this.name = errName;
    this.code = errName;
    this.errno = errno;
    this.message = msg || defaultMessage;
    if(path) {
      this.path = path;
    }
    this.stack = (new Error(this.message)).stack;
  }
  FilerError.prototype = Object.create(Error.prototype);
  FilerError.prototype.constructor = FilerError;
  FilerError.prototype.toString = function() {
    var pathInfo = this.path ? (', \'' + this.path + '\'') : '';
    return this.name + ': ' + this.message + pathInfo;
  };

  // We expose the error as both Errors.EINVAL and Errors[18]
  errors[errName] = errors[errno] = FilerError;
});

module.exports = errors;

},{}],41:[function(require,module,exports){
var _ = require('../../lib/nodash.js');

var Path = require('../path.js');
var normalize = Path.normalize;
var dirname = Path.dirname;
var basename = Path.basename;
var isAbsolutePath = Path.isAbsolute;
var isNullPath = Path.isNull;

var Constants = require('../constants.js');
var MODE_FILE = Constants.MODE_FILE;
var MODE_DIRECTORY = Constants.MODE_DIRECTORY;
var MODE_SYMBOLIC_LINK = Constants.MODE_SYMBOLIC_LINK;
var MODE_META = Constants.MODE_META;

var ROOT_DIRECTORY_NAME = Constants.ROOT_DIRECTORY_NAME;
var SUPER_NODE_ID = Constants.SUPER_NODE_ID;
var SYMLOOP_MAX = Constants.SYMLOOP_MAX;

var O_READ = Constants.O_READ;
var O_WRITE = Constants.O_WRITE;
var O_CREATE = Constants.O_CREATE;
var O_EXCLUSIVE = Constants.O_EXCLUSIVE;
var O_TRUNCATE = Constants.O_TRUNCATE;
var O_APPEND = Constants.O_APPEND;
var O_FLAGS = Constants.O_FLAGS;

var XATTR_CREATE = Constants.XATTR_CREATE;
var XATTR_REPLACE = Constants.XATTR_REPLACE;
var FS_NOMTIME = Constants.FS_NOMTIME;
var FS_NOCTIME = Constants.FS_NOCTIME;

var Encoding = require('../encoding.js');
var Errors = require('../errors.js');
var DirectoryEntry = require('../directory-entry.js');
var OpenFileDescription = require('../open-file-description.js');
var SuperNode = require('../super-node.js');
var Node = require('../node.js');
var Stats = require('../stats.js');
var Buffer = require('../buffer.js');

/**
 * Update node times. Only passed times are modified (undefined times are ignored)
 * and filesystem flags are examined in order to override update logic.
 */
function update_node_times(context, path, node, times, callback) {
  // Honour mount flags for how we update times
  var flags = context.flags;
  if(_(flags).contains(FS_NOCTIME)) {
    delete times.ctime;
  }
  if(_(flags).contains(FS_NOMTIME)) {
    delete times.mtime;
  }

  // Only do the update if required (i.e., times are still present)
  var update = false;
  if(times.ctime) {
    node.ctime = times.ctime;
    // We don't do atime tracking for perf reasons, but do mirror ctime
    node.atime = times.ctime;
    update = true;
  }
  if(times.atime) {
    // The only time we explicitly pass atime is when utimes(), futimes() is called.
    // Override ctime mirror here if so
    node.atime = times.atime;
    update = true;
  }
  if(times.mtime) {
    node.mtime = times.mtime;
    update = true;
  }

  function complete(error) {
    // Queue this change so we can send watch events.
    // Unlike node.js, we send the full path vs. basename/dirname only.
    context.changes.push({ event: 'change', path: path });
    callback(error);
  }

  if(update) {
    context.putObject(node.id, node, complete);
  } else {
    complete();
  }
}

/**
 * make_node()
 */
// in: file or directory path
// out: new node representing file/directory
function make_node(context, path, mode, callback) {
  if(mode !== MODE_DIRECTORY && mode !== MODE_FILE) {
    return callback(new Errors.EINVAL('mode must be a directory or file', path));
  }

  path = normalize(path);

  var name = basename(path);
  var parentPath = dirname(path);
  var parentNode;
  var parentNodeData;
  var node;

  // Check if the parent node exists
  function create_node_in_parent(error, parentDirectoryNode) {
    if(error) {
      callback(error);
    } else if(parentDirectoryNode.mode !== MODE_DIRECTORY) {
      callback(new Errors.ENOTDIR('a component of the path prefix is not a directory', path));
    } else {
      parentNode = parentDirectoryNode;
      find_node(context, path, check_if_node_exists);
    }
  }

  // Check if the node to be created already exists
  function check_if_node_exists(error, result) {
    if(!error && result) {
      callback(new Errors.EEXIST('path name already exists', path));
    } else if(error && !(error instanceof Errors.ENOENT)) {
      callback(error);
    } else {
      context.getObject(parentNode.data, create_node);
    }
  }

  // Create the new node
  function create_node(error, result) {
    if(error) {
      callback(error);
    } else {
      parentNodeData = result;
      Node.create({guid: context.guid, mode: mode}, function(error, result) {
        if(error) {
          callback(error);
          return;
        }
        node = result;
        node.nlinks += 1;
        context.putObject(node.id, node, update_parent_node_data);
      });
    }
  }

  // Update parent node time
  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      var now = Date.now();
      update_node_times(context, parentPath, node, { mtime: now, ctime: now }, callback);
    }
  }

  // Update the parent nodes data
  function update_parent_node_data(error) {
    if(error) {
      callback(error);
    } else {
      parentNodeData[name] = new DirectoryEntry(node.id, mode);
      context.putObject(parentNode.data, parentNodeData, update_time);
    }
  }

  // Find the parent node
  find_node(context, parentPath, create_node_in_parent);
}

/**
 * find_node
 */
// in: file or directory path
// out: node structure, or error
function find_node(context, path, callback) {
  path = normalize(path);
  if(!path) {
    return callback(new Errors.ENOENT('path is an empty string'));
  }
  var name = basename(path);
  var parentPath = dirname(path);
  var followedCount = 0;

  function read_root_directory_node(error, superNode) {
    if(error) {
      callback(error);
    } else if(!superNode || superNode.mode !== MODE_META || !superNode.rnode) {
      callback(new Errors.EFILESYSTEMERROR());
    } else {
      context.getObject(superNode.rnode, check_root_directory_node);
    }
  }

  function check_root_directory_node(error, rootDirectoryNode) {
    if(error) {
      callback(error);
    } else if(!rootDirectoryNode) {
      callback(new Errors.ENOENT());
    } else {
      callback(null, rootDirectoryNode);
    }
  }

  // in: parent directory node
  // out: parent directory data
  function read_parent_directory_data(error, parentDirectoryNode) {
    if(error) {
      callback(error);
    } else if(parentDirectoryNode.mode !== MODE_DIRECTORY || !parentDirectoryNode.data) {
      callback(new Errors.ENOTDIR('a component of the path prefix is not a directory', path));
    } else {
      context.getObject(parentDirectoryNode.data, get_node_from_parent_directory_data);
    }
  }

  // in: parent directory data
  // out: searched node
  function get_node_from_parent_directory_data(error, parentDirectoryData) {
    if(error) {
      callback(error);
    } else {
      if(!_(parentDirectoryData).has(name)) {
        callback(new Errors.ENOENT(null, path));
      } else {
        var nodeId = parentDirectoryData[name].id;
        context.getObject(nodeId, is_symbolic_link);
      }
    }
  }

  function is_symbolic_link(error, node) {
    if(error) {
      callback(error);
    } else {
      if(node.mode == MODE_SYMBOLIC_LINK) {
        followedCount++;
        if(followedCount > SYMLOOP_MAX){
          callback(new Errors.ELOOP(null, path));
        } else {
          follow_symbolic_link(node.data);
        }
      } else {
        callback(null, node);
      }
    }
  }

  function follow_symbolic_link(data) {
    data = normalize(data);
    parentPath = dirname(data);
    name = basename(data);
    if(ROOT_DIRECTORY_NAME == name) {
      context.getObject(SUPER_NODE_ID, read_root_directory_node);
    } else {
      find_node(context, parentPath, read_parent_directory_data);
    }
  }

  if(ROOT_DIRECTORY_NAME == name) {
    context.getObject(SUPER_NODE_ID, read_root_directory_node);
  } else {
    find_node(context, parentPath, read_parent_directory_data);
  }
}


/**
 * set extended attribute (refactor)
 */
function set_extended_attribute (context, path, node, name, value, flag, callback) {
  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      update_node_times(context, path, node, { ctime: Date.now() }, callback);
    }
  }

  var xattrs = node.xattrs;

  if (flag === XATTR_CREATE && xattrs.hasOwnProperty(name)) {
    callback(new Errors.EEXIST('attribute already exists', path));
  }
  else if (flag === XATTR_REPLACE && !xattrs.hasOwnProperty(name)) {
    callback(new Errors.ENOATTR(null, path));
  }
  else {
    xattrs[name] = value;
    context.putObject(node.id, node, update_time);
  }
}

/**
 * ensure_root_directory. Creates a root node if necessary.
 *
 * Note: this should only be invoked when formatting a new file system.
 * Multiple invocations of this by separate instances will still result
 * in only a single super node.
 */
function ensure_root_directory(context, callback) {
  var superNode;
  var directoryNode;
  var directoryData;

  function ensure_super_node(error, existingNode) {
    if(!error && existingNode) {
      // Another instance has beat us and already created the super node.
      callback();
    } else if(error && !(error instanceof Errors.ENOENT)) {
      callback(error);
    } else {
      SuperNode.create({guid: context.guid}, function(error, result) {
        if(error) {
          callback(error);
          return;
        }
        superNode = result;
        context.putObject(superNode.id, superNode, write_directory_node);
      });
    }
  }

  function write_directory_node(error) {
    if(error) {
      callback(error);
    } else {
      Node.create({guid: context.guid, id: superNode.rnode, mode: MODE_DIRECTORY}, function(error, result) {
        if(error) {
          callback(error);
          return;
        }
        directoryNode = result;
        directoryNode.nlinks += 1;
        context.putObject(directoryNode.id, directoryNode, write_directory_data);
      });
    }
  }

  function write_directory_data(error) {
    if(error) {
      callback(error);
    } else {
      directoryData = {};
      context.putObject(directoryNode.data, directoryData, callback);
    }
  }

  context.getObject(SUPER_NODE_ID, ensure_super_node);
}

/**
 * make_directory
 */
function make_directory(context, path, callback) {
  path = normalize(path);
  var name = basename(path);
  var parentPath = dirname(path);

  var directoryNode;
  var directoryData;
  var parentDirectoryNode;
  var parentDirectoryData;

  function check_if_directory_exists(error, result) {
    if(!error && result) {
      callback(new Errors.EEXIST(null, path));
    } else if(error && !(error instanceof Errors.ENOENT)) {
      callback(error);
    } else {
      find_node(context, parentPath, read_parent_directory_data);
    }
  }

  function read_parent_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      parentDirectoryNode = result;
      context.getObject(parentDirectoryNode.data, write_directory_node);
    }
  }

  function write_directory_node(error, result) {
    if(error) {
      callback(error);
    } else {
      parentDirectoryData = result;
      Node.create({guid: context.guid, mode: MODE_DIRECTORY}, function(error, result) {
        if(error) {
          callback(error);
          return;
        }
        directoryNode = result;
        directoryNode.nlinks += 1;
        context.putObject(directoryNode.id, directoryNode, write_directory_data);
      });
    }
  }

  function write_directory_data(error) {
    if(error) {
      callback(error);
    } else {
      directoryData = {};
      context.putObject(directoryNode.data, directoryData, update_parent_directory_data);
    }
  }

  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      var now = Date.now();
      update_node_times(context, parentPath, parentDirectoryNode, { mtime: now, ctime: now }, callback);
    }
  }

  function update_parent_directory_data(error) {
    if(error) {
      callback(error);
    } else {
      parentDirectoryData[name] = new DirectoryEntry(directoryNode.id, MODE_DIRECTORY);
      context.putObject(parentDirectoryNode.data, parentDirectoryData, update_time);
    }
  }

  find_node(context, path, check_if_directory_exists);
}

/**
 * remove_directory
 */
function remove_directory(context, path, callback) {
  path = normalize(path);
  var name = basename(path);
  var parentPath = dirname(path);

  var directoryNode;
  var directoryData;
  var parentDirectoryNode;
  var parentDirectoryData;

  function read_parent_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      parentDirectoryNode = result;
      context.getObject(parentDirectoryNode.data, check_if_node_exists);
    }
  }

  function check_if_node_exists(error, result) {
    if(error) {
      callback(error);
    } else if(ROOT_DIRECTORY_NAME == name) {
      callback(new Errors.EBUSY(null, path));
    } else if(!_(result).has(name)) {
      callback(new Errors.ENOENT(null, path));
    } else {
      parentDirectoryData = result;
      directoryNode = parentDirectoryData[name].id;
      context.getObject(directoryNode, check_if_node_is_directory);
    }
  }

  function check_if_node_is_directory(error, result) {
    if(error) {
      callback(error);
    } else if(result.mode != MODE_DIRECTORY) {
      callback(new Errors.ENOTDIR(null, path));
    } else {
      directoryNode = result;
      context.getObject(directoryNode.data, check_if_directory_is_empty);
    }
  }

  function check_if_directory_is_empty(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryData = result;
      if(_(directoryData).size() > 0) {
        callback(new Errors.ENOTEMPTY(null, path));
      } else {
        remove_directory_entry_from_parent_directory_node();
      }
    }
  }

  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      var now = Date.now();
      update_node_times(context, parentPath, parentDirectoryNode, { mtime: now, ctime: now }, remove_directory_node);
    }
  }

  function remove_directory_entry_from_parent_directory_node() {
    delete parentDirectoryData[name];
    context.putObject(parentDirectoryNode.data, parentDirectoryData, update_time);
  }

  function remove_directory_node(error) {
    if(error) {
      callback(error);
    } else {
      context.delete(directoryNode.id, remove_directory_data);
    }
  }

  function remove_directory_data(error) {
    if(error) {
      callback(error);
    } else {
      context.delete(directoryNode.data, callback);
    }
  }

  find_node(context, parentPath, read_parent_directory_data);
}

function open_file(context, path, flags, callback) {
  path = normalize(path);
  var name = basename(path);
  var parentPath = dirname(path);

  var directoryNode;
  var directoryData;
  var directoryEntry;
  var fileNode;
  var fileData;

  var followedCount = 0;

  if(ROOT_DIRECTORY_NAME == name) {
    if(_(flags).contains(O_WRITE)) {
      callback(new Errors.EISDIR('the named file is a directory and O_WRITE is set', path));
    } else {
      find_node(context, path, set_file_node);
    }
  } else {
    find_node(context, parentPath, read_directory_data);
  }

  function read_directory_data(error, result) {
    if(error) {
      callback(error);
    } else if(result.mode !== MODE_DIRECTORY) {
      callback(new Errors.ENOENT(null, path));
    } else {
      directoryNode = result;
      context.getObject(directoryNode.data, check_if_file_exists);
    }
  }

  function check_if_file_exists(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryData = result;
      if(_(directoryData).has(name)) {
        if(_(flags).contains(O_EXCLUSIVE)) {
          callback(new Errors.ENOENT('O_CREATE and O_EXCLUSIVE are set, and the named file exists', path));
        } else {
          directoryEntry = directoryData[name];
          if(directoryEntry.type == MODE_DIRECTORY && _(flags).contains(O_WRITE)) {
            callback(new Errors.EISDIR('the named file is a directory and O_WRITE is set', path));
          } else {
            context.getObject(directoryEntry.id, check_if_symbolic_link);
          }
        }
      } else {
        if(!_(flags).contains(O_CREATE)) {
          callback(new Errors.ENOENT('O_CREATE is not set and the named file does not exist', path));
        } else {
          write_file_node();
        }
      }
    }
  }

  function check_if_symbolic_link(error, result) {
    if(error) {
      callback(error);
    } else {
      var node = result;
      if(node.mode == MODE_SYMBOLIC_LINK) {
        followedCount++;
        if(followedCount > SYMLOOP_MAX){
          callback(new Errors.ELOOP(null, path));
        } else {
          follow_symbolic_link(node.data);
        }
      } else {
        set_file_node(undefined, node);
      }
    }
  }

  function follow_symbolic_link(data) {
    data = normalize(data);
    parentPath = dirname(data);
    name = basename(data);
    if(ROOT_DIRECTORY_NAME == name) {
      if(_(flags).contains(O_WRITE)) {
        callback(new Errors.EISDIR('the named file is a directory and O_WRITE is set', path));
      } else {
        find_node(context, path, set_file_node);
      }
    }
    find_node(context, parentPath, read_directory_data);
  }

  function set_file_node(error, result) {
    if(error) {
      callback(error);
    } else {
      fileNode = result;
      callback(null, fileNode);
    }
  }

  function write_file_node() {
    Node.create({guid: context.guid, mode: MODE_FILE}, function(error, result) {
      if(error) {
        callback(error);
        return;
      }
      fileNode = result;
      fileNode.nlinks += 1;
      context.putObject(fileNode.id, fileNode, write_file_data);
    });
  }

  function write_file_data(error) {
    if(error) {
      callback(error);
    } else {
      fileData = new Buffer(0);
      fileData.fill(0);
      context.putBuffer(fileNode.data, fileData, update_directory_data);
    }
  }

  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      var now = Date.now();
      update_node_times(context, parentPath, directoryNode, { mtime: now, ctime: now }, handle_update_result);
    }
  }

  function update_directory_data(error) {
    if(error) {
      callback(error);
    } else {
      directoryData[name] = new DirectoryEntry(fileNode.id, MODE_FILE);
      context.putObject(directoryNode.data, directoryData, update_time);
    }
  }

  function handle_update_result(error) {
    if(error) {
      callback(error);
    } else {
      callback(null, fileNode);
    }
  }
}

function replace_data(context, ofd, buffer, offset, length, callback) {
  var fileNode;

  function return_nbytes(error) {
    if(error) {
      callback(error);
    } else {
      callback(null, length);
    }
  }

  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      var now = Date.now();
      update_node_times(context, ofd.path, fileNode, { mtime: now, ctime: now }, return_nbytes);
    }
  }

  function update_file_node(error) {
    if(error) {
      callback(error);
    } else {
      context.putObject(fileNode.id, fileNode, update_time);
    }
  }

  function write_file_data(error, result) {
    if(error) {
      callback(error);
    } else {
      fileNode = result;
      var newData = new Buffer(length);
      newData.fill(0);
      buffer.copy(newData, 0, offset, offset + length);
      ofd.position = length;

      fileNode.size = length;
      fileNode.version += 1;

      context.putBuffer(fileNode.data, newData, update_file_node);
    }
  }

  context.getObject(ofd.id, write_file_data);
}

function write_data(context, ofd, buffer, offset, length, position, callback) {
  var fileNode;
  var fileData;

  function return_nbytes(error) {
    if(error) {
      callback(error);
    } else {
      callback(null, length);
    }
  }

  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      var now = Date.now();
      update_node_times(context, ofd.path, fileNode, { mtime: now, ctime: now }, return_nbytes);
    }
  }

  function update_file_node(error) {
    if(error) {
      callback(error);
    } else {
      context.putObject(fileNode.id, fileNode, update_time);
    }
  }

  function update_file_data(error, result) {
    if(error) {
      callback(error);
    } else {
      fileData = result;
      if(!fileData) {
        return callback(new Errors.EIO('Expected Buffer'));
      }
      var _position = (!(undefined === position || null === position)) ? position : ofd.position;
      var newSize = Math.max(fileData.length, _position + length);
      var newData = new Buffer(newSize);
      newData.fill(0);
      if(fileData) {
        fileData.copy(newData);
      }
      buffer.copy(newData, _position, offset, offset + length);
      if(undefined === position) {
        ofd.position += length;
      }

      fileNode.size = newSize;
      fileNode.version += 1;

      context.putBuffer(fileNode.data, newData, update_file_node);
    }
  }

  function read_file_data(error, result) {
    if(error) {
      callback(error);
    } else {
      fileNode = result;
      context.getBuffer(fileNode.data, update_file_data);
    }
  }

  context.getObject(ofd.id, read_file_data);
}

function read_data(context, ofd, buffer, offset, length, position, callback) {
  var fileNode;
  var fileData;

  function handle_file_data(error, result) {
    if(error) {
      callback(error);
    } else {
      fileData = result;
      if(!fileData) {
        return callback(new Errors.EIO('Expected Buffer'));
      }
      var _position = (!(undefined === position || null === position)) ? position : ofd.position;
      length = (_position + length > buffer.length) ? length - _position : length;
      fileData.copy(buffer, offset, _position, _position + length);
      if(undefined === position) {
        ofd.position += length;
      }
      callback(null, length);
    }
  }

  function read_file_data(error, result) {
    if(error) {
      callback(error);
    } else if(result.mode === 'DIRECTORY') {
      callback(new Errors.EISDIR('the named file is a directory', ofd.path));
    } else {
      fileNode = result;
      context.getBuffer(fileNode.data, handle_file_data);
    }
  }

  context.getObject(ofd.id, read_file_data);
}

function stat_file(context, path, callback) {
  path = normalize(path);
  var name = basename(path);
  find_node(context, path, callback);
}

function fstat_file(context, ofd, callback) {
  ofd.getNode(context, callback);
}

function lstat_file(context, path, callback) {
  path = normalize(path);
  var name = basename(path);
  var parentPath = dirname(path);

  var directoryNode;
  var directoryData;

  if(ROOT_DIRECTORY_NAME == name) {
    find_node(context, path, callback);
  } else {
    find_node(context, parentPath, read_directory_data);
  }

  function read_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryNode = result;
      context.getObject(directoryNode.data, check_if_file_exists);
    }
  }

  function check_if_file_exists(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryData = result;
      if(!_(directoryData).has(name)) {
        callback(new Errors.ENOENT('a component of the path does not name an existing file', path));
      } else {
        context.getObject(directoryData[name].id, callback);
      }
    }
  }
}

function link_node(context, oldpath, newpath, callback) {
  oldpath = normalize(oldpath);
  var oldname = basename(oldpath);
  var oldParentPath = dirname(oldpath);

  newpath = normalize(newpath);
  var newname = basename(newpath);
  var newParentPath = dirname(newpath);

  var oldDirectoryNode;
  var oldDirectoryData;
  var newDirectoryNode;
  var newDirectoryData;
  var fileNode;

  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      update_node_times(context, newpath,  fileNode, { ctime: Date.now() }, callback);
    }
  }

  function update_file_node(error, result) {
    if(error) {
      callback(error);
    } else {
      fileNode = result;
      fileNode.nlinks += 1;
      context.putObject(fileNode.id, fileNode, update_time);
    }
  }

  function read_directory_entry(error, result) {
    if(error) {
      callback(error);
    } else {
      context.getObject(newDirectoryData[newname].id, update_file_node);
    }
  }

  function check_if_new_file_exists(error, result) {
    if(error) {
      callback(error);
    } else {
      newDirectoryData = result;
      if(_(newDirectoryData).has(newname)) {
        callback(new Errors.EEXIST('newpath resolves to an existing file', newname));
      } else {
        newDirectoryData[newname] = oldDirectoryData[oldname];
        context.putObject(newDirectoryNode.data, newDirectoryData, read_directory_entry);
      }
    }
  }

  function read_new_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      newDirectoryNode = result;
      context.getObject(newDirectoryNode.data, check_if_new_file_exists);
    }
  }

  function check_if_old_file_exists(error, result) {
    if(error) {
      callback(error);
    } else {
      oldDirectoryData = result;
      if(!_(oldDirectoryData).has(oldname)) {
        callback(new Errors.ENOENT('a component of either path prefix does not exist', oldname));
      } else {
        find_node(context, newParentPath, read_new_directory_data);
      }
    }
  }

  function read_old_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      oldDirectoryNode = result;
      context.getObject(oldDirectoryNode.data, check_if_old_file_exists);
    }
  }

  find_node(context, oldParentPath, read_old_directory_data);
}

function unlink_node(context, path, callback) {
  path = normalize(path);
  var name = basename(path);
  var parentPath = dirname(path);

  var directoryNode;
  var directoryData;
  var fileNode;

  function update_directory_data(error) {
    if(error) {
      callback(error);
    } else {
      delete directoryData[name];
      context.putObject(directoryNode.data, directoryData, function(error) {
        var now = Date.now();
        update_node_times(context, parentPath, directoryNode, { mtime: now, ctime: now }, callback);
      });
    }
  }

  function delete_file_data(error) {
    if(error) {
      callback(error);
    } else {
      context.delete(fileNode.data, update_directory_data);
    }
  }

  function update_file_node(error, result) {
    if(error) {
      callback(error);
    } else {
      fileNode = result;
      fileNode.nlinks -= 1;
      if(fileNode.nlinks < 1) {
        context.delete(fileNode.id, delete_file_data);
      } else {
        context.putObject(fileNode.id, fileNode, function(error) {
          update_node_times(context, path, fileNode, { ctime: Date.now() }, update_directory_data);
        });
      }
    }
  }

  function check_if_node_is_directory(error, result) {
    if(error) {
      callback(error);
    } else if(result.mode === 'DIRECTORY') {
      callback(new Errors.EPERM('unlink not permitted on directories', name));
    } else {
      update_file_node(null, result);
    }
  }

  function check_if_file_exists(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryData = result;
      if(!_(directoryData).has(name)) {
        callback(new Errors.ENOENT('a component of the path does not name an existing file', name));
      } else {
        context.getObject(directoryData[name].id, check_if_node_is_directory);
      }
    }
  }

  function read_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryNode = result;
      context.getObject(directoryNode.data, check_if_file_exists);
    }
  }

  find_node(context, parentPath, read_directory_data);
}

function read_directory(context, path, callback) {
  path = normalize(path);
  var name = basename(path);

  var directoryNode;
  var directoryData;

  function handle_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryData = result;
      var files = Object.keys(directoryData);
      callback(null, files);
    }
  }

  function read_directory_data(error, result) {
    if(error) {
      callback(error);
    } else if(result.mode !== MODE_DIRECTORY) {
      callback(new Errors.ENOTDIR(null, path));
    } else {
      directoryNode = result;
      context.getObject(directoryNode.data, handle_directory_data);
    }
  }

  find_node(context, path, read_directory_data);
}

function make_symbolic_link(context, srcpath, dstpath, callback) {
  dstpath = normalize(dstpath);
  var name = basename(dstpath);
  var parentPath = dirname(dstpath);

  var directoryNode;
  var directoryData;
  var fileNode;

  if(ROOT_DIRECTORY_NAME == name) {
    callback(new Errors.EEXIST(null, name));
  } else {
    find_node(context, parentPath, read_directory_data);
  }

  function read_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryNode = result;
      context.getObject(directoryNode.data, check_if_file_exists);
    }
  }

  function check_if_file_exists(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryData = result;
      if(_(directoryData).has(name)) {
        callback(new Errors.EEXIST(null, name));
      } else {
        write_file_node();
      }
    }
  }

  function write_file_node() {
    Node.create({guid: context.guid, mode: MODE_SYMBOLIC_LINK}, function(error, result) {
      if(error) {
        callback(error);
        return;
      }
      fileNode = result;
      fileNode.nlinks += 1;
      fileNode.size = srcpath.length;
      fileNode.data = srcpath;
      context.putObject(fileNode.id, fileNode, update_directory_data);
    });
  }

  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      var now = Date.now();
      update_node_times(context, parentPath, directoryNode, { mtime: now, ctime: now }, callback);
    }
  }

  function update_directory_data(error) {
    if(error) {
      callback(error);
    } else {
      directoryData[name] = new DirectoryEntry(fileNode.id, MODE_SYMBOLIC_LINK);
      context.putObject(directoryNode.data, directoryData, update_time);
    }
  }
}

function read_link(context, path, callback) {
  path = normalize(path);
  var name = basename(path);
  var parentPath = dirname(path);

  var directoryNode;
  var directoryData;

  find_node(context, parentPath, read_directory_data);

  function read_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryNode = result;
      context.getObject(directoryNode.data, check_if_file_exists);
    }
  }

  function check_if_file_exists(error, result) {
    if(error) {
      callback(error);
    } else {
      directoryData = result;
      if(!_(directoryData).has(name)) {
        callback(new Errors.ENOENT('a component of the path does not name an existing file', name));
      } else {
        context.getObject(directoryData[name].id, check_if_symbolic);
      }
    }
  }

  function check_if_symbolic(error, result) {
    if(error) {
      callback(error);
    } else {
      if(result.mode != MODE_SYMBOLIC_LINK) {
        callback(new Errors.EINVAL('path not a symbolic link', path));
      } else {
        callback(null, result.data);
      }
    }
  }
}

function truncate_file(context, path, length, callback) {
  path = normalize(path);

  var fileNode;

  function read_file_data (error, node) {
    if (error) {
      callback(error);
    } else if(node.mode == MODE_DIRECTORY ) {
      callback(new Errors.EISDIR(null, path));
    } else{
      fileNode = node;
      context.getBuffer(fileNode.data, truncate_file_data);
    }
  }

  function truncate_file_data(error, fileData) {
    if (error) {
      callback(error);
    } else {
      if(!fileData) {
        return callback(new Errors.EIO('Expected Buffer'));
      }
      var data = new Buffer(length);
      data.fill(0);
      if(fileData) {
        fileData.copy(data);
      }
      context.putBuffer(fileNode.data, data, update_file_node);
    }
  }

  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      var now = Date.now();
      update_node_times(context, path, fileNode, { mtime: now, ctime: now }, callback);
    }
  }

  function update_file_node (error) {
    if(error) {
      callback(error);
    } else {
      fileNode.size = length;
      fileNode.version += 1;
      context.putObject(fileNode.id, fileNode, update_time);
    }
  }

  if(length < 0) {
    callback(new Errors.EINVAL('length cannot be negative'));
  } else {
    find_node(context, path, read_file_data);
  }
}

function ftruncate_file(context, ofd, length, callback) {
  var fileNode;

  function read_file_data (error, node) {
    if (error) {
      callback(error);
    } else if(node.mode == MODE_DIRECTORY ) {
      callback(new Errors.EISDIR());
    } else{
      fileNode = node;
      context.getBuffer(fileNode.data, truncate_file_data);
    }
  }

  function truncate_file_data(error, fileData) {
    if (error) {
      callback(error);
    } else {
      var data;
      if(!fileData) {
        return callback(new Errors.EIO('Expected Buffer'));
      }
      if(fileData) {
        data = fileData.slice(0, length);
      } else {
        data = new Buffer(length);
        data.fill(0);
      }
      context.putBuffer(fileNode.data, data, update_file_node);
    }
  }

  function update_time(error) {
    if(error) {
      callback(error);
    } else {
      var now = Date.now();
      update_node_times(context, ofd.path, fileNode, { mtime: now, ctime: now }, callback);
    }
  }

  function update_file_node (error) {
    if(error) {
      callback(error);
    } else {
      fileNode.size = length;
      fileNode.version += 1;
      context.putObject(fileNode.id, fileNode, update_time);
    }
  }

  if(length < 0) {
    callback(new Errors.EINVAL('length cannot be negative'));
  } else {
    ofd.getNode(context, read_file_data);
  }
}

function utimes_file(context, path, atime, mtime, callback) {
  path = normalize(path);

  function update_times(error, node) {
    if (error) {
      callback(error);
    } else {
      update_node_times(context, path, node, { atime: atime, ctime: mtime, mtime: mtime }, callback);
    }
  }

  if (typeof atime != 'number' || typeof mtime != 'number') {
    callback(new Errors.EINVAL('atime and mtime must be number', path));
  }
  else if (atime < 0 || mtime < 0) {
    callback(new Errors.EINVAL('atime and mtime must be positive integers', path));
  }
  else {
    find_node(context, path, update_times);
  }
}

function futimes_file(context, ofd, atime, mtime, callback) {

  function update_times (error, node) {
    if (error) {
      callback(error);
    } else {
      update_node_times(context, ofd.path, node, { atime: atime, ctime: mtime, mtime: mtime }, callback);
    }
  }

  if (typeof atime != 'number' || typeof mtime != 'number') {
    callback(new Errors.EINVAL('atime and mtime must be a number'));
  }
  else if (atime < 0 || mtime < 0) {
    callback(new Errors.EINVAL('atime and mtime must be positive integers'));
  }
  else {
    ofd.getNode(context, update_times);
  }
}

function setxattr_file(context, path, name, value, flag, callback) {
  path = normalize(path);

  function setxattr(error, node) {
    if(error) {
      return callback(error);
    }
    set_extended_attribute(context, path, node, name, value, flag, callback);
  }

  if (typeof name != 'string') {
    callback(new Errors.EINVAL('attribute name must be a string', path));
  }
  else if (!name) {
    callback(new Errors.EINVAL('attribute name cannot be an empty string', path));
  }
  else if (flag !== null &&
           flag !== XATTR_CREATE && flag !== XATTR_REPLACE) {
    callback(new Errors.EINVAL('invalid flag, must be null, XATTR_CREATE or XATTR_REPLACE', path));
  }
  else {
    find_node(context, path, setxattr);
  }
}

function fsetxattr_file (context, ofd, name, value, flag, callback) {
  function setxattr(error, node) {
    if(error) {
      return callback(error);
    }
    set_extended_attribute(context, ofd.path, node, name, value, flag, callback);
  }

  if (typeof name !== 'string') {
    callback(new Errors.EINVAL('attribute name must be a string'));
  }
  else if (!name) {
    callback(new Errors.EINVAL('attribute name cannot be an empty string'));
  }
  else if (flag !== null &&
           flag !== XATTR_CREATE && flag !== XATTR_REPLACE) {
    callback(new Errors.EINVAL('invalid flag, must be null, XATTR_CREATE or XATTR_REPLACE'));
  }
  else {
    ofd.getNode(context, setxattr);
  }
}

function getxattr_file (context, path, name, callback) {
  path = normalize(path);

  function get_xattr(error, node) {
    if(error) {
      return callback(error);
    }

    var xattrs = node.xattrs;

    if (!xattrs.hasOwnProperty(name)) {
      callback(new Errors.ENOATTR(null, path));
    }
    else {
      callback(null, xattrs[name]);
    }
  }

  if (typeof name != 'string') {
    callback(new Errors.EINVAL('attribute name must be a string', path));
  }
  else if (!name) {
    callback(new Errors.EINVAL('attribute name cannot be an empty string', path));
  }
  else {
    find_node(context, path, get_xattr);
  }
}

function fgetxattr_file (context, ofd, name, callback) {

  function get_xattr (error, node) {
    if (error) {
      return callback(error);
    }

    var xattrs = node.xattrs;

    if (!xattrs.hasOwnProperty(name)) {
      callback(new Errors.ENOATTR());
    }
    else {
      callback(null, xattrs[name]);
    }
  }

  if (typeof name != 'string') {
    callback(new Errors.EINVAL());
  }
  else if (!name) {
    callback(new Errors.EINVAL('attribute name cannot be an empty string'));
  }
  else {
    ofd.getNode(context, get_xattr);
  }
}

function removexattr_file (context, path, name, callback) {
  path = normalize(path);

  function remove_xattr (error, node) {
    if (error) {
      return callback(error);
    }

    function update_time(error) {
      if(error) {
        callback(error);
      } else {
        update_node_times(context, path, node, { ctime: Date.now() }, callback);
      }
    }

    var xattrs = node.xattrs;

    if (!xattrs.hasOwnProperty(name)) {
      callback(new Errors.ENOATTR(null, path));
    }
    else {
      delete xattrs[name];
      context.putObject(node.id, node, update_time);
    }
  }

  if (typeof name !== 'string') {
    callback(new Errors.EINVAL('attribute name must be a string', path));
  }
  else if (!name) {
    callback(new Errors.EINVAL('attribute name cannot be an empty string', path));
  }
  else {
    find_node(context, path, remove_xattr);
  }
}

function fremovexattr_file (context, ofd, name, callback) {

  function remove_xattr (error, node) {
    if (error) {
      return callback(error);
    }

    function update_time(error) {
      if(error) {
        callback(error);
      } else {
        update_node_times(context, ofd.path, node, { ctime: Date.now() }, callback);
      }
    }

    var xattrs = node.xattrs;

    if (!xattrs.hasOwnProperty(name)) {
      callback(new Errors.ENOATTR());
    }
    else {
      delete xattrs[name];
      context.putObject(node.id, node, update_time);
    }
  }

  if (typeof name != 'string') {
    callback(new Errors.EINVAL('attribute name must be a string'));
  }
  else if (!name) {
    callback(new Errors.EINVAL('attribute name cannot be an empty string'));
  }
  else {
    ofd.getNode(context, remove_xattr);
  }
}

function validate_flags(flags) {
  if(!_(O_FLAGS).has(flags)) {
    return null;
  }
  return O_FLAGS[flags];
}

function validate_file_options(options, enc, fileMode){
  if(!options) {
    options = { encoding: enc, flag: fileMode };
  } else if(typeof options === "function") {
    options = { encoding: enc, flag: fileMode };
  } else if(typeof options === "string") {
    options = { encoding: options, flag: fileMode };
  }
  return options;
}

function pathCheck(path, callback) {
  var err;

  if(!path) {
    err = new Errors.EINVAL('Path must be a string', path);
  } else if(isNullPath(path)) {
    err = new Errors.EINVAL('Path must be a string without null bytes.', path);
  } else if(!isAbsolutePath(path)) {
    err = new Errors.EINVAL('Path must be absolute.', path);
  }

  if(err) {
    callback(err);
    return false;
  }
  return true;
}


function open(fs, context, path, flags, mode, callback) {
  // NOTE: we support the same signature as node with a `mode` arg,
  // but ignore it.
  callback = arguments[arguments.length - 1];
  if(!pathCheck(path, callback)) return;

  function check_result(error, fileNode) {
    if(error) {
      callback(error);
    } else {
      var position;
      if(_(flags).contains(O_APPEND)) {
        position = fileNode.size;
      } else {
        position = 0;
      }
      var openFileDescription = new OpenFileDescription(path, fileNode.id, flags, position);
      var fd = fs.allocDescriptor(openFileDescription);
      callback(null, fd);
    }
  }

  flags = validate_flags(flags);
  if(!flags) {
    callback(new Errors.EINVAL('flags is not valid'), path);
  }

  open_file(context, path, flags, check_result);
}

function close(fs, context, fd, callback) {
  if(!_(fs.openFiles).has(fd)) {
    callback(new Errors.EBADF());
  } else {
    fs.releaseDescriptor(fd);
    callback(null);
  }
}

function mknod(fs, context, path, mode, callback) {
  if(!pathCheck(path, callback)) return;
  make_node(context, path, mode, callback);
}

function mkdir(fs, context, path, mode, callback) {
  // NOTE: we support passing a mode arg, but we ignore it internally for now.
  callback = arguments[arguments.length - 1];
  if(!pathCheck(path, callback)) return;
  make_directory(context, path, callback);
}

function rmdir(fs, context, path, callback) {
  if(!pathCheck(path, callback)) return;
  remove_directory(context, path, callback);
}

function stat(fs, context, path, callback) {
  if(!pathCheck(path, callback)) return;

  function check_result(error, result) {
    if(error) {
      callback(error);
    } else {
      var stats = new Stats(result, fs.name);
      callback(null, stats);
    }
  }

  stat_file(context, path, check_result);
}

function fstat(fs, context, fd, callback) {
  function check_result(error, result) {
    if(error) {
      callback(error);
    } else {
      var stats = new Stats(result, fs.name);
      callback(null, stats);
    }
  }

  var ofd = fs.openFiles[fd];
  if(!ofd) {
    callback(new Errors.EBADF());
  } else {
    fstat_file(context, ofd, check_result);
  }
}

function link(fs, context, oldpath, newpath, callback) {
  if(!pathCheck(oldpath, callback)) return;
  if(!pathCheck(newpath, callback)) return;
  link_node(context, oldpath, newpath, callback);
}

function unlink(fs, context, path, callback) {
  if(!pathCheck(path, callback)) return;
  unlink_node(context, path, callback);
}

function read(fs, context, fd, buffer, offset, length, position, callback) {
  // Follow how node.js does this
  function wrapped_cb(err, bytesRead) {
    // Retain a reference to buffer so that it can't be GC'ed too soon.
    callback(err, bytesRead || 0, buffer);
  }

  offset = (undefined === offset) ? 0 : offset;
  length = (undefined === length) ? buffer.length - offset : length;
  callback = arguments[arguments.length - 1];

  var ofd = fs.openFiles[fd];
  if(!ofd) {
    callback(new Errors.EBADF());
  } else if(!_(ofd.flags).contains(O_READ)) {
    callback(new Errors.EBADF('descriptor does not permit reading'));
  } else {
    read_data(context, ofd, buffer, offset, length, position, wrapped_cb);
  }
}

function readFile(fs, context, path, options, callback) {
  callback = arguments[arguments.length - 1];
  options = validate_file_options(options, null, 'r');

  if(!pathCheck(path, callback)) return;

  var flags = validate_flags(options.flag || 'r');
  if(!flags) {
    return callback(new Errors.EINVAL('flags is not valid', path));
  }

  open_file(context, path, flags, function(err, fileNode) {
    if(err) {
      return callback(err);
    }
    var ofd = new OpenFileDescription(path, fileNode.id, flags, 0);
    var fd = fs.allocDescriptor(ofd);

    function cleanup() {
      fs.releaseDescriptor(fd);
    }

    fstat_file(context, ofd, function(err, fstatResult) {
      if(err) {
        cleanup();
        return callback(err);
      }

      var stats = new Stats(fstatResult, fs.name);

      if(stats.isDirectory()) {
        cleanup();
        return callback(new Errors.EISDIR('illegal operation on directory', path));
      }

      var size = stats.size;
      var buffer = new Buffer(size);
      buffer.fill(0);

      read_data(context, ofd, buffer, 0, size, 0, function(err, nbytes) {
        cleanup();

        if(err) {
          return callback(err);
        }

        var data;
        if(options.encoding === 'utf8') {
          data = Encoding.decode(buffer);
        } else {
          data = buffer;
        }
        callback(null, data);
      });
    });
  });
}

function write(fs, context, fd, buffer, offset, length, position, callback) {
  callback = arguments[arguments.length - 1];
  offset = (undefined === offset) ? 0 : offset;
  length = (undefined === length) ? buffer.length - offset : length;

  var ofd = fs.openFiles[fd];
  if(!ofd) {
    callback(new Errors.EBADF());
  } else if(!_(ofd.flags).contains(O_WRITE)) {
    callback(new Errors.EBADF('descriptor does not permit writing'));
  } else if(buffer.length - offset < length) {
    callback(new Errors.EIO('intput buffer is too small'));
  } else {
    write_data(context, ofd, buffer, offset, length, position, callback);
  }
}

function writeFile(fs, context, path, data, options, callback) {
  callback = arguments[arguments.length - 1];
  options = validate_file_options(options, 'utf8', 'w');

  if(!pathCheck(path, callback)) return;

  var flags = validate_flags(options.flag || 'w');
  if(!flags) {
    return callback(new Errors.EINVAL('flags is not valid', path));
  }

  data = data || '';
  if(typeof data === "number") {
    data = '' + data;
  }
  if(typeof data === "string" && options.encoding === 'utf8') {
    data = Encoding.encode(data);
  }

  open_file(context, path, flags, function(err, fileNode) {
    if(err) {
      return callback(err);
    }
    var ofd = new OpenFileDescription(path, fileNode.id, flags, 0);
    var fd = fs.allocDescriptor(ofd);

    replace_data(context, ofd, data, 0, data.length, function(err, nbytes) {
      fs.releaseDescriptor(fd);

      if(err) {
        return callback(err);
      }
      callback(null);
    });
  });
}

function appendFile(fs, context, path, data, options, callback) {
  callback = arguments[arguments.length - 1];
  options = validate_file_options(options, 'utf8', 'a');

  if(!pathCheck(path, callback)) return;

  var flags = validate_flags(options.flag || 'a');
  if(!flags) {
    return callback(new Errors.EINVAL('flags is not valid', path));
  }

  data = data || '';
  if(typeof data === "number") {
    data = '' + data;
  }
  if(typeof data === "string" && options.encoding === 'utf8') {
    data = Encoding.encode(data);
  }

  open_file(context, path, flags, function(err, fileNode) {
    if(err) {
      return callback(err);
    }
    var ofd = new OpenFileDescription(path, fileNode.id, flags, fileNode.size);
    var fd = fs.allocDescriptor(ofd);

    write_data(context, ofd, data, 0, data.length, ofd.position, function(err, nbytes) {
      fs.releaseDescriptor(fd);

      if(err) {
        return callback(err);
      }
      callback(null);
    });
  });
}

function exists(fs, context, path, callback) {
  function cb(err, stats) {
    callback(err ? false : true);
  }
  stat(fs, context, path, cb);
}

function getxattr(fs, context, path, name, callback) {
  if (!pathCheck(path, callback)) return;
  getxattr_file(context, path, name, callback);
}

function fgetxattr(fs, context, fd, name, callback) {
  var ofd = fs.openFiles[fd];
  if (!ofd) {
    callback(new Errors.EBADF());
  }
  else {
    fgetxattr_file(context, ofd, name, callback);
  }
}

function setxattr(fs, context, path, name, value, flag, callback) {
  if(typeof flag === 'function') {
    callback = flag;
    flag = null;
  }

  if (!pathCheck(path, callback)) return;
  setxattr_file(context, path, name, value, flag, callback);
}

function fsetxattr(fs, context, fd, name, value, flag, callback) {
  if(typeof flag === 'function') {
    callback = flag;
    flag = null;
  }

  var ofd = fs.openFiles[fd];
  if (!ofd) {
    callback(new Errors.EBADF());
  }
  else if (!_(ofd.flags).contains(O_WRITE)) {
    callback(new Errors.EBADF('descriptor does not permit writing'));
  }
  else {
    fsetxattr_file(context, ofd, name, value, flag, callback);
  }
}

function removexattr(fs, context, path, name, callback) {
  if (!pathCheck(path, callback)) return;
  removexattr_file(context, path, name, callback);
}

function fremovexattr(fs, context, fd, name, callback) {
  var ofd = fs.openFiles[fd];
  if (!ofd) {
    callback(new Errors.EBADF());
  }
  else if (!_(ofd.flags).contains(O_WRITE)) {
    callback(new Errors.EBADF('descriptor does not permit writing'));
  }
  else {
    fremovexattr_file(context, ofd, name, callback);
  }
}

function lseek(fs, context, fd, offset, whence, callback) {
  function update_descriptor_position(error, stats) {
    if(error) {
      callback(error);
    } else {
      if(stats.size + offset < 0) {
        callback(new Errors.EINVAL('resulting file offset would be negative'));
      } else {
        ofd.position = stats.size + offset;
        callback(null, ofd.position);
      }
    }
  }

  var ofd = fs.openFiles[fd];
  if(!ofd) {
    callback(new Errors.EBADF());
  }

  if('SET' === whence) {
    if(offset < 0) {
      callback(new Errors.EINVAL('resulting file offset would be negative'));
    } else {
      ofd.position = offset;
      callback(null, ofd.position);
    }
  } else if('CUR' === whence) {
    if(ofd.position + offset < 0) {
      callback(new Errors.EINVAL('resulting file offset would be negative'));
    } else {
      ofd.position += offset;
      callback(null, ofd.position);
    }
  } else if('END' === whence) {
    fstat_file(context, ofd, update_descriptor_position);
  } else {
    callback(new Errors.EINVAL('whence argument is not a proper value'));
  }
}

function readdir(fs, context, path, callback) {
  if(!pathCheck(path, callback)) return;
  read_directory(context, path, callback);
}

function utimes(fs, context, path, atime, mtime, callback) {
  if(!pathCheck(path, callback)) return;

  var currentTime = Date.now();
  atime = (atime) ? atime : currentTime;
  mtime = (mtime) ? mtime : currentTime;

  utimes_file(context, path, atime, mtime, callback);
}

function futimes(fs, context, fd, atime, mtime, callback) {
  var currentTime = Date.now();
  atime = (atime) ? atime : currentTime;
  mtime = (mtime) ? mtime : currentTime;

  var ofd = fs.openFiles[fd];
  if(!ofd) {
    callback(new Errors.EBADF());
  } else if(!_(ofd.flags).contains(O_WRITE)) {
    callback(new Errors.EBADF('descriptor does not permit writing'));
  } else {
    futimes_file(context, ofd, atime, mtime, callback);
  }
}

function rename(fs, context, oldpath, newpath, callback) {
  if(!pathCheck(oldpath, callback)) return;
  if(!pathCheck(newpath, callback)) return;

  var oldParentPath = Path.dirname(oldpath);
  var newParentPath = Path.dirname(oldpath);
  var oldName = Path.basename(oldpath);
  var newName = Path.basename(newpath);
  var oldParentDirectory, oldParentData;
  var newParentDirectory, newParentData;

  function update_times(error, newNode) {
    if(error) {
      callback(error);
    } else {
      update_node_times(context, newpath,  newNode, { ctime: Date.now() }, callback);
    }
  }

  function read_new_directory(error) {
    if(error) {
      callback(error);
    } else {
      context.getObject(newParentData[newName].id, update_times);
    }
  }

  function update_old_parent_directory_data(error) {
    if(error) {
      callback(error);
    } else {
      delete oldParentData[oldName];
      context.putObject(oldParentDirectory.data, oldParentData, read_new_directory);
    }
  }

  function update_new_parent_directory_data(error) {
    if(error) {
      callback(error);
    } else {
      newParentData[newName] = oldParentData[oldName];
      context.putObject(newParentDirectory.data, newParentData, update_old_parent_directory_data);
    }
  }

  function check_if_new_directory_exists(error, result) {
    if(error) {
      callback(error);
    } else {
      newParentData = result;
      if(_(newParentData).has(newName)) {
        remove_directory(context, newpath, update_new_parent_directory_data);
      } else {
        update_new_parent_directory_data();
      }
    }
  }

  function read_new_parent_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      newParentDirectory = result;
      context.getObject(newParentDirectory.data, check_if_new_directory_exists);
    }
  }

  function get_new_parent_directory(error, result) {
    if(error) {
      callback(error);
    } else {
      oldParentData = result;
      find_node(context, newParentPath, read_new_parent_directory_data);
    }
  }

  function read_parent_directory_data(error, result) {
    if(error) {
      callback(error);
    } else {
      oldParentDirectory = result;
      context.getObject(result.data, get_new_parent_directory);
    }
  }

  function unlink_old_file(error) {
    if(error) {
      callback(error);
    } else {
      unlink_node(context, oldpath, callback);
    }
  }

  function check_node_type(error, node) {
    if(error) {
      callback(error);
    } else if(node.mode === 'DIRECTORY') {
      find_node(context, oldParentPath, read_parent_directory_data);
    } else {
      link_node(context, oldpath, newpath, unlink_old_file);
    }
  }

  find_node(context, oldpath, check_node_type);
}

function symlink(fs, context, srcpath, dstpath, type, callback) {
  // NOTE: we support passing the `type` arg, but ignore it.
  callback = arguments[arguments.length - 1];
  if(!pathCheck(srcpath, callback)) return;
  if(!pathCheck(dstpath, callback)) return;
  make_symbolic_link(context, srcpath, dstpath, callback);
}

function readlink(fs, context, path, callback) {
  if(!pathCheck(path, callback)) return;
  read_link(context, path, callback);
}

function lstat(fs, context, path, callback) {
  if(!pathCheck(path, callback)) return;

  function check_result(error, result) {
    if(error) {
      callback(error);
    } else {
      var stats = new Stats(result, fs.name);
      callback(null, stats);
    }
  }

  lstat_file(context, path, check_result);
}

function truncate(fs, context, path, length, callback) {
  // NOTE: length is optional
  callback = arguments[arguments.length - 1];
  length = length || 0;

  if(!pathCheck(path, callback)) return;
  truncate_file(context, path, length, callback);
}

function ftruncate(fs, context, fd, length, callback) {
  // NOTE: length is optional
  callback = arguments[arguments.length - 1];
  length = length || 0;

  var ofd = fs.openFiles[fd];
  if(!ofd) {
    callback(new Errors.EBADF());
  } else if(!_(ofd.flags).contains(O_WRITE)) {
    callback(new Errors.EBADF('descriptor does not permit writing'));
  } else {
    ftruncate_file(context, ofd, length, callback);
  }
}

module.exports = {
  ensureRootDirectory: ensure_root_directory,
  open: open,
  close: close,
  mknod: mknod,
  mkdir: mkdir,
  rmdir: rmdir,
  unlink: unlink,
  stat: stat,
  fstat: fstat,
  link: link,
  read: read,
  readFile: readFile,
  write: write,
  writeFile: writeFile,
  appendFile: appendFile,
  exists: exists,
  getxattr: getxattr,
  fgetxattr: fgetxattr,
  setxattr: setxattr,
  fsetxattr: fsetxattr,
  removexattr: removexattr,
  fremovexattr: fremovexattr,
  lseek: lseek,
  readdir: readdir,
  utimes: utimes,
  futimes: futimes,
  rename: rename,
  symlink: symlink,
  readlink: readlink,
  lstat: lstat,
  truncate: truncate,
  ftruncate: ftruncate
};

},{"../../lib/nodash.js":31,"../buffer.js":36,"../constants.js":37,"../directory-entry.js":38,"../encoding.js":39,"../errors.js":40,"../node.js":45,"../open-file-description.js":46,"../path.js":47,"../stats.js":55,"../super-node.js":56}],42:[function(require,module,exports){
var _ = require('../../lib/nodash.js');

var isNullPath = require('../path.js').isNull;
var nop = require('../shared.js').nop;

var Constants = require('../constants.js');
var FILE_SYSTEM_NAME = Constants.FILE_SYSTEM_NAME;
var FS_FORMAT = Constants.FS_FORMAT;
var FS_READY = Constants.FS_READY;
var FS_PENDING = Constants.FS_PENDING;
var FS_ERROR = Constants.FS_ERROR;
var FS_NODUPEIDCHECK = Constants.FS_NODUPEIDCHECK;

var providers = require('../providers/index.js');

var Shell = require('../shell/shell.js');
var Intercom = require('../../lib/intercom.js');
var FSWatcher = require('../fs-watcher.js');
var Errors = require('../errors.js');
var defaultGuidFn = require('../shared.js').guid;

var STDIN = Constants.STDIN;
var STDOUT = Constants.STDOUT;
var STDERR = Constants.STDERR;
var FIRST_DESCRIPTOR = Constants.FIRST_DESCRIPTOR;

// The core fs operations live on impl
var impl = require('./implementation.js');

// node.js supports a calling pattern that leaves off a callback.
function maybeCallback(callback) {
  if(typeof callback === "function") {
    return callback;
  }
  return function(err) {
    if(err) {
      throw err;
    }
  };
}

// Default callback that logs an error if passed in
function defaultCallback(err) {
  if(err) {
    console.error('Filer error: ', err);
  }
}

/**
 * FileSystem
 *
 * A FileSystem takes an `options` object, which can specify a number of,
 * options.  All options are optional, and include:
 *
 * name: the name of the file system, defaults to "local"
 *
 * flags: one or more flags to use when creating/opening the file system.
 *        For example: "FORMAT" will cause the file system to be formatted.
 *        No explicit flags are set by default.
 *
 * provider: an explicit storage provider to use for the file
 *           system's database context provider.  A number of context
 *           providers are included (see /src/providers), and users
 *           can write one of their own and pass it in to be used.
 *           By default an IndexedDB provider is used.
 *
 * guid: a function for generating unique IDs for nodes in the filesystem.
 *       Use this to override the built-in UUID generation. (Used mainly for tests).
 *
 * callback: a callback function to be executed when the file system becomes
 *           ready for use. Depending on the context provider used, this might
 *           be right away, or could take some time. The callback should expect
 *           an `error` argument, which will be null if everything worked.  Also
 *           users should check the file system's `readyState` and `error`
 *           properties to make sure it is usable.
 */
function FileSystem(options, callback) {
  options = options || {};
  callback = callback || defaultCallback;

  var flags = options.flags;
  var guid = options.guid ? options.guid : defaultGuidFn;
  var provider = options.provider || new providers.Default(options.name || FILE_SYSTEM_NAME);
  // If we're given a provider, match its name unless we get an explicit name
  var name = options.name || provider.name;
  var forceFormatting = _(flags).contains(FS_FORMAT);

  var fs = this;
  fs.readyState = FS_PENDING;
  fs.name = name;
  fs.error = null;

  fs.stdin = STDIN;
  fs.stdout = STDOUT;
  fs.stderr = STDERR;

  // Expose Shell constructor
  this.Shell = Shell.bind(undefined, this);

  // Safely expose the list of open files and file
  // descriptor management functions
  var openFiles = {};
  var nextDescriptor = FIRST_DESCRIPTOR;
  Object.defineProperty(this, "openFiles", {
    get: function() { return openFiles; }
  });
  this.allocDescriptor = function(openFileDescription) {
    var fd = nextDescriptor ++;
    openFiles[fd] = openFileDescription;
    return fd;
  };
  this.releaseDescriptor = function(fd) {
    delete openFiles[fd];
  };

  // Safely expose the operation queue
  var queue = [];
  this.queueOrRun = function(operation) {
    var error;

    if(FS_READY == fs.readyState) {
      operation.call(fs);
    } else if(FS_ERROR == fs.readyState) {
      error = new Errors.EFILESYSTEMERROR('unknown error');
    } else {
      queue.push(operation);
    }

    return error;
  };
  function runQueued() {
    queue.forEach(function(operation) {
      operation.call(this);
    }.bind(fs));
    queue = null;
  }

  // We support the optional `options` arg from node, but ignore it
  this.watch = function(filename, options, listener) {
    if(isNullPath(filename)) {
      throw new Error('Path must be a string without null bytes.');
    }
    if(typeof options === 'function') {
      listener = options;
      options = {};
    }
    options = options || {};
    listener = listener || nop;

    var watcher = new FSWatcher();
    watcher.start(filename, false, options.recursive);
    watcher.on('change', listener);

    return watcher;
  };

  // Deal with various approaches to node ID creation
  function wrappedGuidFn(context) {
    return function(callback) {
      // Skip the duplicate ID check if asked to
      if(_(flags).contains(FS_NODUPEIDCHECK)) {
        callback(null, guid());
        return;
      }

      // Otherwise (default) make sure this id is unused first
      function guidWithCheck(callback) {
        var id = guid();
        context.getObject(id, function(err, value) {
          if(err) {
            callback(err);
            return;
          }

          // If this id is unused, use it, otherwise find another
          if(!value) {
            callback(null, id);
          } else {
            guidWithCheck(callback);
          }
        });
      }
      guidWithCheck(callback);
    };
  }

  // Let other instances (in this or other windows) know about
  // any changes to this fs instance.
  function broadcastChanges(changes) {
    if(!changes.length) {
      return;
    }
    var intercom = Intercom.getInstance();
    changes.forEach(function(change) {
      intercom.emit(change.event, change.path);
    });
  }

  // Open file system storage provider
  provider.open(function(err) {
    function complete(error) {
      function wrappedContext(methodName) {
        var context = provider[methodName]();
        context.flags = flags;
        context.changes = [];
        context.guid = wrappedGuidFn(context);

        // When the context is finished, let the fs deal with any change events
        context.close = function() {
          var changes = context.changes;
          broadcastChanges(changes);
          changes.length = 0;
        };

        return context;
      }

      // Wrap the provider so we can extend the context with fs flags and
      // an array of changes (e.g., watch event 'change' and 'rename' events
      // for paths updated during the lifetime of the context). From this
      // point forward we won't call open again, so it's safe to drop it.
      fs.provider = {
        openReadWriteContext: function() {
          return wrappedContext('getReadWriteContext');
        },
        openReadOnlyContext: function() {
          return wrappedContext('getReadOnlyContext');
        }
      };

      if(error) {
        fs.readyState = FS_ERROR;
      } else {
        fs.readyState = FS_READY;
      }
      runQueued();
      callback(error, fs);
    }

    if(err) {
      return complete(err);
    }

    var context = provider.getReadWriteContext();
    context.guid = wrappedGuidFn(context);

    // Mount the filesystem, formatting if necessary
    if(forceFormatting) {
      // Wipe the storage provider, then write root block
      context.clear(function(err) {
        if(err) {
          return complete(err);
        }
        impl.ensureRootDirectory(context, complete);
      });
    } else {
      // Use existing (or create new) root and mount
      impl.ensureRootDirectory(context, complete);
    }
  });
}

// Expose storage providers on FileSystem constructor
FileSystem.providers = providers;

/**
 * Public API for FileSystem
 */
[
  'open',
  'close',
  'mknod',
  'mkdir',
  'rmdir',
  'stat',
  'fstat',
  'link',
  'unlink',
  'read',
  'readFile',
  'write',
  'writeFile',
  'appendFile',
  'exists',
  'lseek',
  'readdir',
  'rename',
  'readlink',
  'symlink',
  'lstat',
  'truncate',
  'ftruncate',
  'utimes',
  'futimes',
  'setxattr',
  'getxattr',
  'fsetxattr',
  'fgetxattr',
  'removexattr',
  'fremovexattr'
].forEach(function(methodName) {
  FileSystem.prototype[methodName] = function() {
    var fs = this;
    var args = Array.prototype.slice.call(arguments, 0);
    var lastArgIndex = args.length - 1;

    // We may or may not get a callback, and since node.js supports
    // fire-and-forget style fs operations, we have to dance a bit here.
    var missingCallback = typeof args[lastArgIndex] !== 'function';
    var callback = maybeCallback(args[lastArgIndex]);

    var error = fs.queueOrRun(function() {
      var context = fs.provider.openReadWriteContext();

      // Fail early if the filesystem is in an error state (e.g.,
      // provider failed to open.
      if(FS_ERROR === fs.readyState) {
        var err = new Errors.EFILESYSTEMERROR('filesystem unavailable, operation canceled');
        return callback.call(fs, err);
      }

      // Wrap the callback so we can explicitly close the context
      function complete() {
        context.close();
        callback.apply(fs, arguments);
      }

      // Either add or replace the callback with our wrapper complete()
      if(missingCallback) {
        args.push(complete);
      } else {
        args[lastArgIndex] = complete;
      }

      // Forward this call to the impl's version, using the following
      // call signature, with complete() as the callback/last-arg now:
      // fn(fs, context, arg0, arg1, ... , complete);
      var fnArgs = [fs, context].concat(args);
      impl[methodName].apply(null, fnArgs);
    });
    if(error) {
      callback(error);
    }
  };
});

module.exports = FileSystem;

},{"../../lib/intercom.js":30,"../../lib/nodash.js":31,"../constants.js":37,"../errors.js":40,"../fs-watcher.js":43,"../path.js":47,"../providers/index.js":48,"../shared.js":52,"../shell/shell.js":54,"./implementation.js":41}],43:[function(require,module,exports){
var EventEmitter = require('../lib/eventemitter.js');
var Path = require('./path.js');
var Intercom = require('../lib/intercom.js');

/**
 * FSWatcher based on node.js' FSWatcher
 * see https://github.com/joyent/node/blob/master/lib/fs.js
 */
function FSWatcher() {
  EventEmitter.call(this);
  var self = this;
  var recursive = false;
  var recursivePathPrefix;
  var filename;

  function onchange(path) {
    // Watch for exact filename, or parent path when recursive is true.
    if(filename === path || (recursive && path.indexOf(recursivePathPrefix) === 0)) {
      self.trigger('change', 'change', path);
    }
  }

  // We support, but ignore the second arg, which node.js uses.
  self.start = function(filename_, persistent_, recursive_) {
    // Bail if we've already started (and therefore have a filename);
    if(filename) {
      return;
    }

    if(Path.isNull(filename_)) {
      throw new Error('Path must be a string without null bytes.');
    }

    // TODO: get realpath for symlinks on filename...

    // Filer's Path.normalize strips trailing slashes, which we use here.
    // See https://github.com/js-platform/filer/issues/105
    filename = Path.normalize(filename_);

    // Whether to watch beneath this path or not
    recursive = recursive_ === true;
    // If recursive, construct a path prefix portion for comparisons later
    // (i.e., '/path' becomes '/path/' so we can search within a filename for the
    // prefix). We also take care to allow for '/' on its own.
    if(recursive) {
      recursivePathPrefix = filename === '/' ? '/' : filename + '/';
    }

    var intercom = Intercom.getInstance();
    intercom.on('change', onchange);
  };

  self.close = function() {
    var intercom = Intercom.getInstance();
    intercom.off('change', onchange);
    self.removeAllListeners('change');
  };
}
FSWatcher.prototype = new EventEmitter();
FSWatcher.prototype.constructor = FSWatcher;

module.exports = FSWatcher;

},{"../lib/eventemitter.js":29,"../lib/intercom.js":30,"./path.js":47}],44:[function(require,module,exports){
module.exports = {
  FileSystem: require('./filesystem/interface.js'),
  Buffer: require('./buffer.js'),
  Path: require('./path.js'),
  Errors: require('./errors.js'),
  Shell: require('./shell/shell.js')
};

},{"./buffer.js":36,"./errors.js":40,"./filesystem/interface.js":42,"./path.js":47,"./shell/shell.js":54}],45:[function(require,module,exports){
var MODE_FILE = require('./constants.js').MODE_FILE;

function Node(options) {
  var now = Date.now();

  this.id = options.id;
  this.mode = options.mode || MODE_FILE;  // node type (file, directory, etc)
  this.size = options.size || 0; // size (bytes for files, entries for directories)
  this.atime = options.atime || now; // access time (will mirror ctime after creation)
  this.ctime = options.ctime || now; // creation/change time
  this.mtime = options.mtime || now; // modified time
  this.flags = options.flags || []; // file flags
  this.xattrs = options.xattrs || {}; // extended attributes
  this.nlinks = options.nlinks || 0; // links count
  this.version = options.version || 0; // node version
  this.blksize = undefined; // block size
  this.nblocks = 1; // blocks count
  this.data = options.data; // id for data object
}

// Make sure the options object has an id on property,
// either from caller or one we generate using supplied guid fn.
function ensureID(options, prop, callback) {
  if(options[prop]) {
    callback(null);
  } else {
    options.guid(function(err, id) {
      options[prop] = id;
      callback(err);
    });
  }
}

Node.create = function(options, callback) {
  // We expect both options.id and options.data to be provided/generated.
  ensureID(options, 'id', function(err) {
    if(err) {
      callback(err);
      return;
    }

    ensureID(options, 'data', function(err) {
      if(err) {
        callback(err);
        return;
      }

      callback(null, new Node(options));
    });
  });
};

module.exports = Node;

},{"./constants.js":37}],46:[function(require,module,exports){
var Errors = require('./errors.js');

function OpenFileDescription(path, id, flags, position) {
  this.path = path;
  this.id = id;
  this.flags = flags;
  this.position = position;
}

// Tries to find the node associated with an ofd's `id`.
// If not found, an error is returned on the callback.
OpenFileDescription.prototype.getNode = function(context, callback) {
  var id = this.id;
  var path = this.path;

  function check_if_node_exists(error, node) {
    if(error) {
      return callback(error);
    }

    if(!node) {
      return callback(new Errors.EBADF('file descriptor refers to unknown node', path));
    }

    callback(null, node);
  }

  context.getObject(id, check_if_node_exists);
};

module.exports = OpenFileDescription;

},{"./errors.js":40}],47:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// Based on https://github.com/joyent/node/blob/41e53e557992a7d552a8e23de035f9463da25c99/lib/path.js

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
      /^(\/?)([\s\S]+\/(?!$)|\/)?((?:\.{1,2}$|[\s\S]+?)?(\.[^.\/]*)?)$/;
var splitPath = function(filename) {
  var result = splitPathRe.exec(filename);
  return [result[1] || '', result[2] || '', result[3] || '', result[4] || ''];
};

// path.resolve([from ...], to)
function resolve() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    // XXXfiler: we don't have process.cwd() so we use '/' as a fallback
    var path = (i >= 0) ? arguments[i] : '/';

    // Skip empty and invalid entries
    if (typeof path !== 'string' || !path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(resolvedPath.split('/').filter(function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
}

// path.normalize(path)
function normalize(path) {
  var isAbsolute = path.charAt(0) === '/',
      trailingSlash = path.substr(-1) === '/';

  // Normalize the path
  path = normalizeArray(path.split('/').filter(function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  /*
   if (path && trailingSlash) {
   path += '/';
   }
   */

  return (isAbsolute ? '/' : '') + path;
}

function join() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return normalize(paths.filter(function(p, index) {
    return p && typeof p === 'string';
  }).join('/'));
}

// path.relative(from, to)
function relative(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
}

function dirname(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
}

function basename(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  // XXXfiler: node.js just does `return f`
  return f === "" ? "/" : f;
}

function extname(path) {
  return splitPath(path)[3];
}

function isAbsolute(path) {
  if(path.charAt(0) === '/') {
    return true;
  }
  return false;
}

function isNull(path) {
  if (('' + path).indexOf('\u0000') !== -1) {
    return true;
  }
  return false;
}

// Make sure we don't double-add a trailing slash (e.g., '/' -> '//')
function addTrailing(path) {
  return path.replace(/\/*$/, '/');
}

// Deal with multiple slashes at the end, one, or none
// and make sure we don't return the empty string.
function removeTrailing(path) {
  path = path.replace(/\/*$/, '');
  return path === '' ? '/' : path;
}

// XXXfiler: we don't support path.exists() or path.existsSync(), which
// are deprecated, and need a FileSystem instance to work. Use fs.stat().

module.exports = {
  normalize: normalize,
  resolve: resolve,
  join: join,
  relative: relative,
  sep: '/',
  delimiter: ':',
  dirname: dirname,
  basename: basename,
  extname: extname,
  isAbsolute: isAbsolute,
  isNull: isNull,
  // Non-node but useful...
  addTrailing: addTrailing,
  removeTrailing: removeTrailing
};

},{}],48:[function(require,module,exports){
var IndexedDB = require('./indexeddb.js');
var WebSQL = require('./websql.js');
var Memory = require('./memory.js');

module.exports = {
  IndexedDB: IndexedDB,
  WebSQL: WebSQL,
  Memory: Memory,

  /**
   * Convenience Provider references
   */

  // The default provider to use when none is specified
  Default: IndexedDB,

  // The Fallback provider does automatic fallback checks
  Fallback: (function() {
    if(IndexedDB.isSupported()) {
      return IndexedDB;
    }

    if(WebSQL.isSupported()) {
      return WebSQL;
    }

    function NotSupported() {
      throw "[Filer Error] Your browser doesn't support IndexedDB or WebSQL.";
    }
    NotSupported.isSupported = function() {
      return false;
    };
    return NotSupported;
  }())
};

},{"./indexeddb.js":49,"./memory.js":50,"./websql.js":51}],49:[function(require,module,exports){
(function (global,Buffer){
var FILE_SYSTEM_NAME = require('../constants.js').FILE_SYSTEM_NAME;
var FILE_STORE_NAME = require('../constants.js').FILE_STORE_NAME;
var IDB_RW = require('../constants.js').IDB_RW;
var IDB_RO = require('../constants.js').IDB_RO;
var Errors = require('../errors.js');
var FilerBuffer = require('../buffer.js');

var indexedDB = global.indexedDB       ||
                global.mozIndexedDB    ||
                global.webkitIndexedDB ||
                global.msIndexedDB;

function IndexedDBContext(db, mode) {
  var transaction = db.transaction(FILE_STORE_NAME, mode);
  this.objectStore = transaction.objectStore(FILE_STORE_NAME);
}

IndexedDBContext.prototype.clear = function(callback) {
  try {
    var request = this.objectStore.clear();
    request.onsuccess = function(event) {
      callback();
    };
    request.onerror = function(error) {
      callback(error);
    };
  } catch(e) {
    callback(e);
  }
};

function _get(objectStore, key, callback) {
  try {
    var request = objectStore.get(key);
    request.onsuccess = function onsuccess(event) {
      var result = event.target.result;
      callback(null, result);
    };
    request.onerror = function onerror(error) {
      callback(error);
    };
  } catch(e) {
    callback(e);
  }
}
IndexedDBContext.prototype.getObject = function(key, callback) {
  _get(this.objectStore, key, callback);
};
IndexedDBContext.prototype.getBuffer = function(key, callback) {
  _get(this.objectStore, key, function(err, arrayBuffer) {
    if(err) {
      return callback(err);
    }
    callback(null, new FilerBuffer(arrayBuffer));
  });
};

function _put(objectStore, key, value, callback) {
  try {
    var request = objectStore.put(value, key);
    request.onsuccess = function onsuccess(event) {
      var result = event.target.result;
      callback(null, result);
    };
    request.onerror = function onerror(error) {
      callback(error);
    };
  } catch(e) {
    callback(e);
  }
}
IndexedDBContext.prototype.putObject = function(key, value, callback) {
  _put(this.objectStore, key, value, callback);
};
IndexedDBContext.prototype.putBuffer = function(key, uint8BackedBuffer, callback) {
  var buf;
  if(!Buffer._useTypedArrays) { // workaround for fxos 1.3
    buf = uint8BackedBuffer.toArrayBuffer();
  } else {
    buf = uint8BackedBuffer.buffer;
  }
  _put(this.objectStore, key, buf, callback);
};

IndexedDBContext.prototype.delete = function(key, callback) {
  try {
    var request = this.objectStore.delete(key);
    request.onsuccess = function onsuccess(event) {
      var result = event.target.result;
      callback(null, result);
    };
    request.onerror = function(error) {
      callback(error);
    };
  } catch(e) {
    callback(e);
  }
};


function IndexedDB(name) {
  this.name = name || FILE_SYSTEM_NAME;
  this.db = null;
}
IndexedDB.isSupported = function() {
  return !!indexedDB;
};

IndexedDB.prototype.open = function(callback) {
  var that = this;

  // Bail if we already have a db open
  if(that.db) {
    return callback();
  }

  // NOTE: we're not using versioned databases.
  var openRequest = indexedDB.open(that.name);

  // If the db doesn't exist, we'll create it
  openRequest.onupgradeneeded = function onupgradeneeded(event) {
    var db = event.target.result;

    if(db.objectStoreNames.contains(FILE_STORE_NAME)) {
      db.deleteObjectStore(FILE_STORE_NAME);
    }
    db.createObjectStore(FILE_STORE_NAME);
  };

  openRequest.onsuccess = function onsuccess(event) {
    that.db = event.target.result;
    callback();
  };
  openRequest.onerror = function onerror(error) {
    callback(new Errors.EINVAL('IndexedDB cannot be accessed. If private browsing is enabled, disable it.'));
  };
};
IndexedDB.prototype.getReadOnlyContext = function() {
  // Due to timing issues in Chrome with readwrite vs. readonly indexeddb transactions
  // always use readwrite so we can make sure pending commits finish before callbacks.
  // See https://github.com/js-platform/filer/issues/128
  return new IndexedDBContext(this.db, IDB_RW);
};
IndexedDB.prototype.getReadWriteContext = function() {
  return new IndexedDBContext(this.db, IDB_RW);
};

module.exports = IndexedDB;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"../buffer.js":36,"../constants.js":37,"../errors.js":40,"buffer":57}],50:[function(require,module,exports){
var FILE_SYSTEM_NAME = require('../constants.js').FILE_SYSTEM_NAME;
// NOTE: prefer setImmediate to nextTick for proper recursion yielding.
// see https://github.com/js-platform/filer/pull/24
var asyncCallback = require('../../lib/async.js').setImmediate;

/**
 * Make shared in-memory DBs possible when using the same name.
 */
var createDB = (function() {
  var pool = {};
  return function getOrCreate(name) {
    if(!pool.hasOwnProperty(name)) {
      pool[name] = {};
    }
    return pool[name];
  };
}());

function MemoryContext(db, readOnly) {
  this.readOnly = readOnly;
  this.objectStore = db;
}

MemoryContext.prototype.clear = function(callback) {
  if(this.readOnly) {
    asyncCallback(function() {
      callback("[MemoryContext] Error: write operation on read only context");
    });
    return;
  }
  var objectStore = this.objectStore;
  Object.keys(objectStore).forEach(function(key){
    delete objectStore[key];
  });
  asyncCallback(callback);
};

// Memory context doesn't care about differences between Object and Buffer
MemoryContext.prototype.getObject =
MemoryContext.prototype.getBuffer =
function(key, callback) {
  var that = this;
  asyncCallback(function() {
    callback(null, that.objectStore[key]);
  });
};
MemoryContext.prototype.putObject =
MemoryContext.prototype.putBuffer =
function(key, value, callback) {
  if(this.readOnly) {
    asyncCallback(function() {
      callback("[MemoryContext] Error: write operation on read only context");
    });
    return;
  }
  this.objectStore[key] = value;
  asyncCallback(callback);
};

MemoryContext.prototype.delete = function(key, callback) {
  if(this.readOnly) {
    asyncCallback(function() {
      callback("[MemoryContext] Error: write operation on read only context");
    });
    return;
  }
  delete this.objectStore[key];
  asyncCallback(callback);
};


function Memory(name) {
  this.name = name || FILE_SYSTEM_NAME;
}
Memory.isSupported = function() {
  return true;
};

Memory.prototype.open = function(callback) {
  this.db = createDB(this.name);
  asyncCallback(callback);
};
Memory.prototype.getReadOnlyContext = function() {
  return new MemoryContext(this.db, true);
};
Memory.prototype.getReadWriteContext = function() {
  return new MemoryContext(this.db, false);
};

module.exports = Memory;

},{"../../lib/async.js":28,"../constants.js":37}],51:[function(require,module,exports){
(function (global){
var FILE_SYSTEM_NAME = require('../constants.js').FILE_SYSTEM_NAME;
var FILE_STORE_NAME = require('../constants.js').FILE_STORE_NAME;
var WSQL_VERSION = require('../constants.js').WSQL_VERSION;
var WSQL_SIZE = require('../constants.js').WSQL_SIZE;
var WSQL_DESC = require('../constants.js').WSQL_DESC;
var Errors = require('../errors.js');
var FilerBuffer = require('../buffer.js');
var base64ArrayBuffer = require('base64-arraybuffer');

function WebSQLContext(db, isReadOnly) {
  var that = this;
  this.getTransaction = function(callback) {
    if(that.transaction) {
      callback(that.transaction);
      return;
    }
    // Either do readTransaction() (read-only) or transaction() (read/write)
    db[isReadOnly ? 'readTransaction' : 'transaction'](function(transaction) {
      that.transaction = transaction;
      callback(transaction);
    });
  };
}

WebSQLContext.prototype.clear = function(callback) {
  function onError(transaction, error) {
    callback(error);
  }
  function onSuccess(transaction, result) {
    callback(null);
  }
  this.getTransaction(function(transaction) {
    transaction.executeSql("DELETE FROM " + FILE_STORE_NAME + ";",
                           [], onSuccess, onError);
  });
};

function _get(getTransaction, key, callback) {
  function onSuccess(transaction, result) {
    // If the key isn't found, return null
    var value = result.rows.length === 0 ? null : result.rows.item(0).data;
    callback(null, value);
  }
  function onError(transaction, error) {
    callback(error);
  }
  getTransaction(function(transaction) {
    transaction.executeSql("SELECT data FROM " + FILE_STORE_NAME + " WHERE id = ? LIMIT 1;",
                           [key], onSuccess, onError);
  });
}
WebSQLContext.prototype.getObject = function(key, callback) {
  _get(this.getTransaction, key, function(err, result) {
    if(err) {
      return callback(err);
    }

    try {
      if(result) {
        result = JSON.parse(result);
      }
    } catch(e) {
      return callback(e);
    }

    callback(null, result);
  });
};
WebSQLContext.prototype.getBuffer = function(key, callback) {
  _get(this.getTransaction, key, function(err, result) {
    if(err) {
      return callback(err);
    }

    // Deal with zero-length ArrayBuffers, which will be encoded as ''
    if(result || result === '') {
      var arrayBuffer = base64ArrayBuffer.decode(result);
      result = new FilerBuffer(arrayBuffer);
    }

    callback(null, result);
  });
};

function _put(getTransaction, key, value, callback) {
  function onSuccess(transaction, result) {
    callback(null);
  }
  function onError(transaction, error) {
    callback(error);
  }
  getTransaction(function(transaction) {
    transaction.executeSql("INSERT OR REPLACE INTO " + FILE_STORE_NAME + " (id, data) VALUES (?, ?);",
                           [key, value], onSuccess, onError);
  });
}
WebSQLContext.prototype.putObject = function(key, value, callback) {
  var json = JSON.stringify(value);
  _put(this.getTransaction, key, json, callback);
};
WebSQLContext.prototype.putBuffer = function(key, uint8BackedBuffer, callback) {
  var base64 = base64ArrayBuffer.encode(uint8BackedBuffer.buffer);
  _put(this.getTransaction, key, base64, callback);
};

WebSQLContext.prototype.delete = function(key, callback) {
  function onSuccess(transaction, result) {
    callback(null);
  }
  function onError(transaction, error) {
    callback(error);
  }
  this.getTransaction(function(transaction) {
    transaction.executeSql("DELETE FROM " + FILE_STORE_NAME + " WHERE id = ?;",
                           [key], onSuccess, onError);
  });
};


function WebSQL(name) {
  this.name = name || FILE_SYSTEM_NAME;
  this.db = null;
}
WebSQL.isSupported = function() {
  return !!global.openDatabase;
};

WebSQL.prototype.open = function(callback) {
  var that = this;

  // Bail if we already have a db open
  if(that.db) {
    return callback();
  }

  var db = global.openDatabase(that.name, WSQL_VERSION, WSQL_DESC, WSQL_SIZE);
  if(!db) {
    callback("[WebSQL] Unable to open database.");
    return;
  }

  function onError(transaction, error) {
    if (error.code === 5) {
      callback(new Errors.EINVAL('WebSQL cannot be accessed. If private browsing is enabled, disable it.'));
    }
    callback(error);
  }
  function onSuccess(transaction, result) {
    that.db = db;
    callback();
  }

  // Create the table and index we'll need to store the fs data.
  db.transaction(function(transaction) {
    function createIndex(transaction) {
      transaction.executeSql("CREATE INDEX IF NOT EXISTS idx_" + FILE_STORE_NAME + "_id" +
                             " on " + FILE_STORE_NAME + " (id);",
                             [], onSuccess, onError);
    }
    transaction.executeSql("CREATE TABLE IF NOT EXISTS " + FILE_STORE_NAME + " (id unique, data TEXT);",
                           [], createIndex, onError);
  });
};
WebSQL.prototype.getReadOnlyContext = function() {
  return new WebSQLContext(this.db, true);
};
WebSQL.prototype.getReadWriteContext = function() {
  return new WebSQLContext(this.db, false);
};

module.exports = WebSQL;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../buffer.js":36,"../constants.js":37,"../errors.js":40,"base64-arraybuffer":32}],52:[function(require,module,exports){
function guid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  }).toUpperCase();
}

function nop() {}

/**
 * Convert a Uint8Array to a regular array
 */
function u8toArray(u8) {
  var array = [];
  var len = u8.length;
  for(var i = 0; i < len; i++) {
    array[i] = u8[i];
  }
  return array;
}

module.exports = {
  guid: guid,
  u8toArray: u8toArray,
  nop: nop
};

},{}],53:[function(require,module,exports){
var defaults = require('../constants.js').ENVIRONMENT;

module.exports = function Environment(env) {
  env = env || {};
  env.TMP = env.TMP || defaults.TMP;
  env.PATH = env.PATH || defaults.PATH;

  this.get = function(name) {
    return env[name];
  };

  this.set = function(name, value) {
    env[name] = value;
  };
};

},{"../constants.js":37}],54:[function(require,module,exports){
var Path = require('../path.js');
var Errors = require('../errors.js');
var Environment = require('./environment.js');
var async = require('../../lib/async.js');
var Encoding = require('../encoding.js');
var minimatch = require('minimatch');

function Shell(fs, options) {
  options = options || {};

  var env = new Environment(options.env);
  var cwd = '/';

  /**
   * The bound FileSystem (cannot be changed)
   */
  Object.defineProperty(this, 'fs', {
    get: function() { return fs; },
    enumerable: true
  });

  /**
   * The shell's environment (e.g., for things like
   * path, tmp, and other env vars). Use env.get()
   * and env.set() to work with variables.
   */
  Object.defineProperty(this, 'env', {
    get: function() { return env; },
    enumerable: true
  });

  /**
   * Change the current working directory. We
   * include `cd` on the `this` vs. proto so that
   * we can access cwd without exposing it externally.
   */
  this.cd = function(path, callback) {
    path = Path.resolve(cwd, path);
    // Make sure the path actually exists, and is a dir
    fs.stat(path, function(err, stats) {
      if(err) {
        callback(new Errors.ENOTDIR(null, path));
        return;
      }
      if(stats.type === 'DIRECTORY') {
        cwd = path;
        callback();
      } else {
        callback(new Errors.ENOTDIR(null, path));
      }
    });
  };

  /**
   * Get the current working directory (changed with `cd()`)
   */
  this.pwd = function() {
    return cwd;
  };
}

/**
 * Execute the .js command located at `path`. Such commands
 * should assume the existence of 3 arguments, which will be
 * defined at runtime:
 *
 *   * fs - the current shell's bound filesystem object
 *   * args - a list of arguments for the command, or an empty list if none
 *   * callback - a callback function(error, result) to call when done.
 *
 * The .js command's contents should be the body of a function
 * that looks like this:
 *
 * function(fs, args, callback) {
 *   // .js code here
 * }
 */
Shell.prototype.exec = function(path, args, callback) {
  /* jshint evil:true */
  var sh = this;
  var fs = sh.fs;
  if(typeof args === 'function') {
    callback = args;
    args = [];
  }
  args = args || [];
  callback = callback || function(){};
  path = Path.resolve(sh.pwd(), path);

  fs.readFile(path, "utf8", function(error, data) {
    if(error) {
      callback(error);
      return;
    }
    try {
      var cmd = new Function('fs', 'args', 'callback', data);
      cmd(fs, args, callback);
    } catch(e) {
      callback(e);
    }
  });
};

/**
 * Create a file if it does not exist, or update access and
 * modified times if it does. Valid options include:
 *
 *  * updateOnly - whether to create the file if missing (defaults to false)
 *  * date - use the provided Date value instead of current date/time
 */
Shell.prototype.touch = function(path, options, callback) {
  var sh = this;
  var fs = sh.fs;
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  callback = callback || function(){};
  path = Path.resolve(sh.pwd(), path);

  function createFile(path) {
    fs.writeFile(path, '', callback);
  }

  function updateTimes(path) {
    var now = Date.now();
    var atime = options.date || now;
    var mtime = options.date || now;

    fs.utimes(path, atime, mtime, callback);
  }

  fs.stat(path, function(error, stats) {
    if(error) {
      if(options.updateOnly === true) {
        callback();
      } else {
        createFile(path);
      }
    } else {
      updateTimes(path);
    }
  });
};

/**
 * Concatenate multiple files into a single String, with each
 * file separated by a newline. The `files` argument should
 * be a String (path to single file) or an Array of Strings
 * (multiple file paths).
 */
Shell.prototype.cat = function(files, callback) {
  var sh = this;
  var fs = sh.fs;
  var all = '';
  callback = callback || function(){};

  if(!files) {
    callback(new Errors.EINVAL('Missing files argument'));
    return;
  }

  files = typeof files === 'string' ? [ files ] : files;

  function append(item, callback) {
    var filename = Path.resolve(sh.pwd(), item);
    fs.readFile(filename, 'utf8', function(error, data) {
      if(error) {
        callback(error);
        return;
      }
      all += data + '\n';
      callback();
    });
  }

  async.eachSeries(files, append, function(error) {
    if(error) {
      callback(error);
    } else {
      callback(null, all.replace(/\n$/, ''));
    }
  });
};

/**
 * Get the listing of a directory, returning an array of
 * file entries in the following form:
 *
 * {
 *   path: <String> the basename of the directory entry
 *   links: <Number> the number of links to the entry
 *   size: <Number> the size in bytes of the entry
 *   modified: <Number> the last modified date/time
 *   type: <String> the type of the entry
 *   contents: <Array> an optional array of child entries
 * }
 *
 * By default ls() gives a shallow listing. If you want
 * to follow directories as they are encountered, use
 * the `recursive=true` option.
 */
Shell.prototype.ls = function(dir, options, callback) {
  var sh = this;
  var fs = sh.fs;
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  callback = callback || function(){};

  if(!dir) {
    callback(new Errors.EINVAL('Missing dir argument'));
    return;
  }

  function list(path, callback) {
    var pathname = Path.resolve(sh.pwd(), path);
    var result = [];

    fs.readdir(pathname, function(error, entries) {
      if(error) {
        callback(error);
        return;
      }

      function getDirEntry(name, callback) {
        name = Path.join(pathname, name);
        fs.stat(name, function(error, stats) {
          if(error) {
            callback(error);
            return;
          }
          var entry = {
            path: Path.basename(name),
            links: stats.nlinks,
            size: stats.size,
            modified: stats.mtime,
            type: stats.type
          };

          if(options.recursive && stats.type === 'DIRECTORY') {
            list(Path.join(pathname, entry.path), function(error, items) {
              if(error) {
                callback(error);
                return;
              }
              entry.contents = items;
              result.push(entry);
              callback();
            });
          } else {
            result.push(entry);
            callback();
          }
        });
      }

      async.eachSeries(entries, getDirEntry, function(error) {
        callback(error, result);
      });
    });
  }

  list(dir, callback);
};

/**
 * Removes the file or directory at `path`. If `path` is a file
 * it will be removed. If `path` is a directory, it will be
 * removed if it is empty, otherwise the callback will receive
 * an error. In order to remove non-empty directories, use the
 * `recursive=true` option.
 */
Shell.prototype.rm = function(path, options, callback) {
  var sh = this;
  var fs = sh.fs;
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  callback = callback || function(){};

  if(!path) {
    callback(new Errors.EINVAL('Missing path argument'));
    return;
  }

  function remove(pathname, callback) {
    pathname = Path.resolve(sh.pwd(), pathname);
    fs.stat(pathname, function(error, stats) {
      if(error) {
        callback(error);
        return;
      }

      // If this is a file, delete it and we're done
      if(stats.type === 'FILE') {
        fs.unlink(pathname, callback);
        return;
      }

      // If it's a dir, check if it's empty
      fs.readdir(pathname, function(error, entries) {
        if(error) {
          callback(error);
          return;
        }

        // If dir is empty, delete it and we're done
        if(entries.length === 0) {
          fs.rmdir(pathname, callback);
          return;
        }

        // If not, see if we're allowed to delete recursively
        if(!options.recursive) {
          callback(new Errors.ENOTEMPTY(null, pathname));
          return;
        }

        // Remove each dir entry recursively, then delete the dir.
        entries = entries.map(function(filename) {
          // Root dir entries absolutely
          return Path.join(pathname, filename);
        });
        async.eachSeries(entries, remove, function(error) {
          if(error) {
            callback(error);
            return;
          }
          fs.rmdir(pathname, callback);
        });
      });
    });
  }

  remove(path, callback);
};

/**
 * Gets the path to the temporary directory, creating it if not
 * present. The directory used is the one specified in
 * env.TMP. The callback receives (error, tempDirName).
 */
Shell.prototype.tempDir = function(callback) {
  var sh = this;
  var fs = sh.fs;
  var tmp = sh.env.get('TMP');
  callback = callback || function(){};

  // Try and create it, and it will either work or fail
  // but either way it's now there.
  fs.mkdir(tmp, function(err) {
    callback(null, tmp);
  });
};

/**
 * Recursively creates the directory at `path`. If the parent
 * of `path` does not exist, it will be created.
 * Based off EnsureDir by Sam X. Xu
 * https://www.npmjs.org/package/ensureDir
 * MIT License
 */
Shell.prototype.mkdirp = function(path, callback) {
  var sh = this;
  var fs = sh.fs;
  callback = callback || function(){};

  if(!path) {
    callback(new Errors.EINVAL('Missing path argument'));
    return;
  }
  else if (path === '/') {
    callback();
    return;
  }
  function _mkdirp(path, callback) {
    fs.stat(path, function (err, stat) {
      if(stat) {
        if(stat.isDirectory()) {
          callback();
          return;
        }
        else if (stat.isFile()) {
          callback(new Errors.ENOTDIR(null, path));
          return;
        }
      }
      else if (err && err.code !== 'ENOENT') {
        callback(err);
        return;
      }
      else {
        var parent = Path.dirname(path);
        if(parent === '/') {
          fs.mkdir(path, function (err) {
            if (err && err.code != 'EEXIST') {
              callback(err);
              return;
            }
            callback();
            return;
          });
        }
        else {
          _mkdirp(parent, function (err) {
            if (err) return callback(err);
            fs.mkdir(path, function (err) {
              if (err && err.code != 'EEXIST') {
                callback(err);
                return;
              }
              callback();
              return;
            });
          });
        }
      }
    });
  }

  _mkdirp(path, callback);
};

/**
 * Recursively walk a directory tree, reporting back all paths
 * that were found along the way. The `path` must be a dir.
 * Valid options include a `regex` for pattern matching paths
 * and an `exec` function of the form `function(path, next)` where
 * `path` is the current path that was found (dir paths have an '/'
 * appended) and `next` is a callback to call when done processing
 * the current path, passing any error object back as the first argument.
 * `find` returns a flat array of absolute paths for all matching/found
 * paths as the final argument to the callback.
 */
 Shell.prototype.find = function(path, options, callback) {
  var sh = this;
  var fs = sh.fs;
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  callback = callback || function(){};

  var exec = options.exec || function(path, next) { next(); };
  var found = [];

  if(!path) {
    callback(new Errors.EINVAL('Missing path argument'));
    return;
  }

  function processPath(path, callback) {
    exec(path, function(err) {
      if(err) {
        callback(err);
        return;
      }

      found.push(path);
      callback();
    });
  }

  function maybeProcessPath(path, callback) {
    // Test the path against the user's regex, name, path primaries (if any)
    // and remove any trailing slashes added previously.
    var rawPath = Path.removeTrailing(path);

    // Check entire path against provided regex, if any
    if(options.regex && !options.regex.test(rawPath)) {
      callback();
      return;
    }

    // Check basename for matches against name primary, if any
    if(options.name && !minimatch(Path.basename(rawPath), options.name)) {
      callback();
      return;
    }

    // Check dirname for matches against path primary, if any
    if(options.path && !minimatch(Path.dirname(rawPath), options.path)) {
      callback();
      return;
    }

    processPath(path, callback);
  }

  function walk(path, callback) {
    path = Path.resolve(sh.pwd(), path);

    // The path is either a file or dir, and instead of doing
    // a stat() to determine it first, we just try to readdir()
    // and it will either work or not, and we handle the non-dir error.
    fs.readdir(path, function(err, entries) {
      if(err) {
        if(err.code === 'ENOTDIR' /* file case, ignore error */) {
          maybeProcessPath(path, callback);
        } else {
          callback(err);
        }
        return;
      }

      // Path is really a dir, add a trailing / and report it found
      maybeProcessPath(Path.addTrailing(path), function(err) {
        if(err) {
          callback(err);
          return;
        }

        entries = entries.map(function(entry) {
          return Path.join(path, entry);
        });

        async.eachSeries(entries, walk, function(err) {
          callback(err, found);
        });
      });
    });
  }

  // Make sure we are starting with a dir path
  fs.stat(path, function(err, stats) {
    if(err) {
      callback(err);
      return;
    }
    if(!stats.isDirectory()) {
      callback(new Errors.ENOTDIR(null, path));
      return;
    }

    walk(path, callback);
  });
};

module.exports = Shell;

},{"../../lib/async.js":28,"../encoding.js":39,"../errors.js":40,"../path.js":47,"./environment.js":53,"minimatch":33}],55:[function(require,module,exports){
var Constants = require('./constants.js');

function Stats(fileNode, devName) {
  this.node = fileNode.id;
  this.dev = devName;
  this.size = fileNode.size;
  this.nlinks = fileNode.nlinks;
  this.atime = fileNode.atime;
  this.mtime = fileNode.mtime;
  this.ctime = fileNode.ctime;
  this.type = fileNode.mode;
}

Stats.prototype.isFile = function() {
  return this.type === Constants.MODE_FILE;
};

Stats.prototype.isDirectory = function() {
  return this.type === Constants.MODE_DIRECTORY;
};

Stats.prototype.isSymbolicLink = function() {
  return this.type === Constants.MODE_SYMBOLIC_LINK;
};

// These will always be false in Filer.
Stats.prototype.isSocket          =
Stats.prototype.isFIFO            =
Stats.prototype.isCharacterDevice =
Stats.prototype.isBlockDevice     =
function() {
  return false;
};

module.exports = Stats;

},{"./constants.js":37}],56:[function(require,module,exports){
var Constants = require('./constants.js');

function SuperNode(options) {
  var now = Date.now();

  this.id = Constants.SUPER_NODE_ID;
  this.mode = Constants.MODE_META;
  this.atime = options.atime || now;
  this.ctime = options.ctime || now;
  this.mtime = options.mtime || now;
  // root node id (randomly generated)
  this.rnode = options.rnode;
}

SuperNode.create = function(options, callback) {
  options.guid(function(err, rnode) {
    if(err) {
      callback(err);
      return;
    }
    options.rnode = options.rnode || rnode;
    callback(null, new SuperNode(options));
  });
};

module.exports = SuperNode;

},{"./constants.js":37}],57:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Find the length
  var length
  if (type === 'number')
    length = subject > 0 ? subject >>> 0 : 0
  else if (type === 'string') {
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) { // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data))
      subject = subject.data
    length = +subject.length > 0 ? Math.floor(+subject.length) : 0
  } else
    throw new TypeError('must start with number, buffer, array or string')

  if (length > kMaxLength)
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
      'size: 0x' + kMaxLength.toString(16) + ' bytes')

  var buf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++)
        buf[i] = subject.readUInt8(i)
    } else {
      for (i = 0; i < length; i++)
        buf[i] = ((subject[i] % 256) + 256) % 256
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  if (length > 0 && length <= Buffer.poolSize)
    buf.parent = rootParent

  return buf
}

function SlowBuffer(subject, encoding, noZero) {
  if (!(this instanceof SlowBuffer))
    return new SlowBuffer(subject, encoding, noZero)

  var buf = new Buffer(subject, encoding, noZero)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b))
    throw new TypeError('Arguments must be Buffers')

  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function (list, totalLength) {
  if (!isArray(list)) throw new TypeError('Usage: Buffer.concat(list[, length])')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase)
          throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max)
      str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b)
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(byte)) throw new Error('Invalid hex string')
    buf[offset + i] = byte
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length, 2)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0

  if (length < 0 || offset < 0 || offset > this.length)
    throw new RangeError('attempt to write outside buffer bounds');

  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len;
    if (start < 0)
      start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0)
      end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start)
    end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length)
    newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0)
    throw new RangeError('offset is not uint')
  if (offset + ext > length)
    throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100))
    val += this[offset + i] * mul

  return val
}

Buffer.prototype.readUIntBE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100))
    val += this[offset + --byteLength] * mul;

  return val
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
      ((this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      this[offset + 3])
}

Buffer.prototype.readIntLE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100))
    val += this[offset + i] * mul
  mul *= 0x80

  if (val >= mul)
    val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100))
    val += this[offset + --i] * mul
  mul *= 0x80

  if (val >= mul)
    val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80))
    return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16) |
      (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
      (this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      (this[offset + 3])
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100))
    this[offset + i] = (value / mul) >>> 0 & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100))
    this[offset + i] = (value / mul) >>> 0 & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

Buffer.prototype.writeIntLE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(this,
             value,
             offset,
             byteLength,
             Math.pow(2, 8 * byteLength - 1) - 1,
             -Math.pow(2, 8 * byteLength - 1))
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100))
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(this,
             value,
             offset,
             byteLength,
             Math.pow(2, 8 * byteLength - 1) - 1,
             -Math.pow(2, 8 * byteLength - 1))
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100))
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (target_start >= target.length) target_start = target.length
  if (!target_start) target_start = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || source.length === 0) return 0

  // Fatal error conditions
  if (target_start < 0)
    throw new RangeError('targetStart out of bounds')
  if (start < 0 || start >= source.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes(string, units) {
  var codePoint, length = string.length
  var leadSurrogate = null
  units = units || Infinity
  var bytes = []
  var i = 0

  for (; i<length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {

      // last char was a lead
      if (leadSurrogate) {

        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        }

        // valid surrogate pair
        else {
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      }

      // no lead yet
      else {

        // unexpected trail
        if (codePoint > 0xDBFF) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // unpaired lead
        else if (i + 1 === length) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        else {
          leadSurrogate = codePoint
          continue
        }
      }
    }

    // valid bmp char, but last char was a lead
    else if (leadSurrogate) {
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    }
    else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      );
    }
    else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      );
    }
    else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      );
    }
    else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {

    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length, unitSize) {
  if (unitSize) length -= length % unitSize;
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":58,"ieee754":59,"is-array":60}],58:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],59:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],60:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],61:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))
},{"_process":62}],62:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;

function drainQueue() {
    if (draining) {
        return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        var i = -1;
        while (++i < len) {
            currentQueue[i]();
        }
        len = queue.length;
    }
    draining = false;
}
process.nextTick = function (fun) {
    queue.push(fun);
    if (!draining) {
        setTimeout(drainQueue, 0);
    }
};

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}]},{},[3])(3)
});