var path = require('path');
var fs = require('fs-extra');
var spawn = require('child_process').spawn;
var Promise = require('bluebird');
var debug = require('debug')('test:couch-registry');
var agent = require('superagent-promise');

var couchDir = path.resolve(__dirname, '..', 'couch');

// the port is hard-coded in ../couch/config.ini
var port = 15984;

// localhost is for admin access
var couchAdminUrl = 'http://localhost:' + port;
var couchUser = 'admin';
var couchPassword = 'admin';

// 127.0.0.1 is mapped to /registry/_design/app/_rewrite
var registryUrl = 'http://127.0.0.1:' + port;

exports.userCredentials = couchUser + ':' + couchPassword;

// app.js can be downloaded here:
//   https://skimdb.npmjs.com/registry/_design/app
// See also https://github.com/npm/npm-www/blob/master/dev/initCouchDocs.js
var couchAppCode = fs.readFileSync(path.join(couchDir, 'app.js'), 'utf-8');

var couchProcess;

exports.start = function() {
  fs.removeSync(path.resolve(couchDir, 'data'));
  fs.removeSync(path.resolve(couchDir, 'couchdb.log'));
  return startCouch()
    .then(configure);
};

function startCouch() {
  return new Promise(function startCouch(resolve, reject) {
    var args = ['-a', path.resolve(couchDir, 'config.ini')];
    debug('Starting couchdb %j', args);
    couchProcess = spawn(
      'couchdb',
      args,
      {
        cwd: couchDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    couchProcess.stdout.on('data', function(data) {
      debug('[out] %s', data);
      if (/Apache CouchDB has started on/.test(data)) {
        resolve();
      }
    });
    couchProcess.stderr.on('data', function(data) {
      debug('[err] %s', data);
    });
    couchProcess.on('close', function(code) {
      debug('exited with', code);
      if (code > 0) {
        throw new Error('couchdb died with ' + code);
      }
    });
    process.on('exit', function() {
      try {
        couchProcess.kill('SIGKILL');
      } catch(err) {
        debug('kill failed', err);
      }
    });
    debug('child spawned');
  });
}

function configure() {
  debug('configuring');
  return uploadRegistryApp()
    .then(function() {
      debug('Registry URL is %s', registryUrl);
      return registryUrl;
    });
}

function uploadRegistryApp() {
  var databaseUrl = couchAdminUrl + '/registry';

  return dropDatabase().then(createDatabase).then(upload);

  function dropDatabase() {

    return agent
      .del(databaseUrl)
      .auth(couchUser, couchPassword)
      .end()
      .then(function(res) {
        if (!res.ok && !res.notFound)
          throw new Error('Cannot drop the registry database: ' + res.error);
      });
  }

  function createDatabase() {
    return agent
      .put(databaseUrl)
      .auth(couchUser, couchPassword)
      .end()
      .then(throwOnHttpError);
  }

  function upload() {
    return agent
      .put(databaseUrl + '/_design/app?new_edits=false')
      .auth(couchUser, couchPassword)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .send(couchAppCode)
      .end()
      .then(throwOnHttpError);
  }
}

function throwOnHttpError(res) {
  if (!res.ok)
    throw new Error('Cannot create the registry database: ' + res.error);
}
