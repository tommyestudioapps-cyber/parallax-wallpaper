const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const androidRoot = path.join(projectRoot, 'android');
const localPropertiesPath = path.join(androidRoot, 'local.properties');

function fail(messages) {
  console.error('\nAndroid preflight failed:');
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}

function parseLocalSdkDir() {
  if (!fs.existsSync(localPropertiesPath)) return null;

  const line = fs
    .readFileSync(localPropertiesPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => /^\s*sdk\.dir\s*=/.test(value));
  if (!line) return null;

  const value = line.replace(/^\s*sdk\.dir\s*=\s*/, '').trim();
  return value.replace(/\\:/g, ':').replace(/\\\\/g, '\\');
}

function resolveSdk() {
  const localSdk = parseLocalSdkDir();
  if (localSdk) {
    if (!fs.existsSync(localSdk) || !fs.statSync(localSdk).isDirectory()) {
      fail([
        `android/local.properties points to a missing SDK directory: ${localSdk}`,
        'Update sdk.dir to an installed Android SDK or remove local.properties and set ANDROID_HOME/ANDROID_SDK_ROOT.',
      ]);
    }
    return { path: localSdk, source: 'android/local.properties' };
  }

  const environmentSdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (environmentSdk && fs.existsSync(environmentSdk) && fs.statSync(environmentSdk).isDirectory()) {
    return { path: environmentSdk, source: 'ANDROID_SDK_ROOT/ANDROID_HOME' };
  }

  fail([
    'No valid Android SDK was found.',
    'Set ANDROID_SDK_ROOT or ANDROID_HOME to an installed SDK, or configure android/local.properties.',
  ]);
}

function resolveAdb(sdkPath) {
  const sdkAdb = path.join(sdkPath, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  if (fs.existsSync(sdkAdb)) return sdkAdb;

  const result = spawnSync('adb', ['version'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (!result.error && result.status === 0) return 'adb';

  fail([
    `adb was not found in ${path.join(sdkPath, 'platform-tools')} or on PATH.`,
    'Install Android platform-tools and make adb available before running the Android command.',
  ]);
}

function connectedDevices(adb) {
  const result = spawnSync(adb, ['devices', '-l'], {
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error || result.status !== 0) {
    fail([
      `adb could not list devices${result.error ? `: ${result.error.message}` : '.'}`,
      'Start adb and connect an authorized Android device or emulator.',
    ]);
  }

  return result.stdout
    .split(/\r?\n/)
    .filter((line) => /^\S+\s+device(?:\s|$)/.test(line));
}

const sdk = resolveSdk();
const adb = resolveAdb(sdk.path);
const devices = connectedDevices(adb);
if (devices.length === 0) {
  fail([
    'No authorized Android device or emulator is connected.',
    'Start an emulator or connect a device, enable USB debugging, authorize it, and retry.',
  ]);
}

console.log('Android preflight passed');
console.log(`SDK: ${sdk.path} (${sdk.source})`);
console.log(`adb: ${adb}`);
console.log(`Connected devices: ${devices.length}`);