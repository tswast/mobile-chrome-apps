/**
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
 */

var fs = require('fs');
var path = require('path');

var ccaManifestLogic = require('cca-manifest-logic');
var et = require('elementtree');
var Q = require('q');

var utils = require('./utils');


// Returns a promise.
module.exports = exports = function postPrepareCommand(opts) {
  var hasAndroid = fs.existsSync(path.join('platforms', 'android'));
  var hasIos = fs.existsSync(path.join('platforms', 'ios'));

  if (!fs.existsSync('platforms')) {
    return Q.reject('No platforms directory found. Please run script from the root of your project.');
  }

  var p = Q();
  if (hasAndroid) {
    p = p.then(function() { return postPrepareInternal('android'); });
  }
  if (hasIos) {
    p = p.then(function() { return postPrepareInternal('ios'); });
  }
  return p;
};

function injectCsp(htmlPath, cspTag) {
  var html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace(/<meta.*Content-Security.*>/, cspTag);
  fs.writeFileSync(htmlPath, html);
}

// Internal function called potentially multiple times to cover all platforms.
function postPrepareInternal(platform) {
  var root = utils.assetDirForPlatform(platform);

  /* Android asset packager ignores, by default, directories beginning with
     underscores. This can be fixed with an update to the project.properties
     file, but only when compiling with ant. There is a bug outstanding to
     fix this behaviour in Eclipse/ADT as well.

     References:
       https://code.google.com/p/android/issues/detail?id=5343
       https://code.google.com/p/android/issues/detail?id=41237
   */
  var badPath = path.join(utils.assetDirForPlatform(platform), '_locales');
  var betterPath = path.join(utils.assetDirForPlatform(platform), 'CCA_locales');
  var promise = Q();
  if (fs.existsSync(badPath)) {
    console.log('## Pre-processing _locales for ' + platform);
    fs.renameSync(badPath, betterPath);
    promise = Q.ninvoke(fs, 'readdir', betterPath)
    .then(function(files) {
      for (var i=0; i<files.length; i++) {
        var fullName = path.join(betterPath, files[i]);
        var adjustedFilename= files[i].replace('-', '_').toLowerCase();
        if (files[i] !== adjustedFilename) {
          var stats = fs.statSync(fullName);
          if (stats.isDirectory()) {
            fs.renameSync(fullName, path.join(betterPath, adjustedFilename));
          }
        }
      }
    });
  }

  return promise.then(function() {
    return require('./get-manifest')('www', platform);
  }).then(function(manifest) {
    // Write merged manifest.json
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 4));
    // Write CSP tag
    var cspContent = ccaManifestLogic.analyseManifest.createCspString(manifest, platform);
    var cspTag = '<meta http-equiv="Content-Security-Policy" content="' + cspContent + '">';
    injectCsp(path.join(root, 'plugins', 'org.chromium.bootstrap', 'chromeapp.html'), cspTag);
    injectCsp(path.join(root, 'plugins', 'org.chromium.bootstrap', 'chromebgpage.html'), cspTag);

    if (platform === 'android' && manifest) {
      // Write manifest.short_name as launcher_name in Android strings.xml
      if (manifest.short_name) {
        var stringsPath = path.join('platforms', 'android', 'res', 'values', 'strings.xml');
        var strings = et.parse(fs.readFileSync(stringsPath, 'utf-8'));
        strings.find('./string/[@name="launcher_name"]').text = manifest.short_name;
        fs.writeFileSync(stringsPath, strings.write({indent: 4}), 'utf-8');
      }

      // Update Android Theme to Translucent
      var androidManifestPath = path.join('platforms', 'android', 'AndroidManifest.xml');
      var androidManifest = et.parse(fs.readFileSync(androidManifestPath, 'utf-8'));
      var theme = manifest.androidTheme || "@android:style/Theme.Translucent";
      androidManifest.find('./application/activity').attrib["android:theme"] = theme;
      fs.writeFileSync(androidManifestPath, androidManifest.write({indent: 4}), 'utf-8');
    }
  });
}
