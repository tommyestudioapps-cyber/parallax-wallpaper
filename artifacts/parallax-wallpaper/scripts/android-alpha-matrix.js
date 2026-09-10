'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const localPropertiesPath = path.join(projectRoot, 'android', 'local.properties');
const packageName = 'com.parallaxwallpaper.app';
const wallpaperComponent = process.env.ANDROID_ALPHA_MATRIX_COMPONENT
  || `${packageName}/.ParallaxWallpaperService`;
const timeoutMs = Number(process.env.ANDROID_ALPHA_MATRIX_TIMEOUT_MS || 30000);
const pollMs = 500;

function fail(message) {
  console.error(`Android alpha GPU matrix failed: ${message}`);
  process.exit(1);
}

function run(adb, args, timeout = 15000) {
  const result = spawnSync(adb, args, {
    encoding: 'utf8',
    timeout,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

function parseSdkDir() {
  if (!fs.existsSync(localPropertiesPath)) return null;
  const line = fs
    .readFileSync(localPropertiesPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => /^\s*sdk\.dir\s*=/.test(value));
  if (!line) return null;
  return line
    .replace(/^\s*sdk\.dir\s*=\s*/, '')
    .trim()
    .replace(/\\:/g, ':')
    .replace(/\\\\/g, '\\');
}

function resolveAdb() {
  const candidates = [];
  if (process.env.ADB) candidates.push(process.env.ADB);
  const sdkDir = parseSdkDir() || process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (sdkDir) {
    candidates.push(path.join(
      sdkDir,
      'platform-tools',
      process.platform === 'win32' ? 'adb.exe' : 'adb',
    ));
  }
  candidates.push('adb');

  for (const candidate of candidates) {
    if (candidate !== 'adb' && !fs.existsSync(candidate)) continue;
    const result = run(candidate, ['version']);
    if (result.status === 0) return candidate;
  }
  fail('adb is unavailable; set ADB or install Android platform-tools');
}

function listDevices(adb) {
  const result = run(adb, ['devices', '-l']);
  if (result.status !== 0) {
    fail(`adb could not list devices: ${result.stderr.trim() || 'unknown error'}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => /^\S+\s+device(?:\s|$)/.test(line))
    .map((line) => ({
      serial: line.trim().split(/\s+/)[0],
      descriptor: line.trim(),
    }));
}

function parseProperties(output) {
  const properties = {};
  output.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\[([^\]]+)\]: \[([^\]]*)\]$/);
    if (match) properties[match[1]] = match[2];
  });
  return properties;
}

function readDeviceProfile(adb, serial) {
  const propertiesResult = run(adb, ['-s', serial, 'shell', 'getprop']);
  if (propertiesResult.status !== 0) {
    fail(`could not read properties from ${serial}: ${propertiesResult.stderr.trim()}`);
  }
  const properties = parseProperties(propertiesResult.stdout);
  const surfaceResult = run(adb, ['-s', serial, 'shell', 'dumpsys', 'SurfaceFlinger']);
  const rendererLine = surfaceResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^(GLES|EGL|OpenGL|Renderer|RenderEngine)\b/i.test(line))
    || '';
  const gpuParts = [
    properties['ro.hardware.egl'],
    properties['ro.hardware'],
    properties['ro.board.platform'],
    properties['ro.gfx.driver.0'],
    rendererLine,
  ].filter(Boolean);
  if (gpuParts.length === 0) {
    fail(`GPU/EGL identity is unavailable on ${serial}`);
  }
  return {
    serial,
    manufacturer: properties['ro.product.manufacturer'] || 'unknown',
    model: properties['ro.product.model'] || 'unknown',
    api: properties['ro.build.version.sdk'] || 'unknown',
    gpuKey: gpuParts.join('|'),
    gpuLabel: rendererLine || gpuParts.slice(0, 3).join(' / '),
  };
}

function sleep(milliseconds) {
  const sharedBuffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sharedBuffer), 0, 0, milliseconds);
}

function captureAlphaValidation(adb, profile) {
  const clearResult = run(adb, ['-s', profile.serial, 'logcat', '-c']);
  if (clearResult.status !== 0) {
    return {
      status: 'FAILED',
      error: `could not clear Logcat: ${clearResult.stderr.trim() || 'unknown error'}`,
      failureLines: [],
    };
  }

  const setWallpaperResult = run(adb, [
    '-s',
    profile.serial,
    'shell',
    'cmd',
    'wallpaper',
    'set-live-wallpaper',
    '--user',
    '0',
    wallpaperComponent,
  ]);
  if (setWallpaperResult.status !== 0) {
    return {
      status: 'FAILED',
      error: `could not activate ${wallpaperComponent}: `
        + `${setWallpaperResult.stderr.trim() || setWallpaperResult.stdout.trim()}`,
      failureLines: [],
    };
  }

  const deadline = Date.now() + timeoutMs;
  let log = '';
  while (Date.now() < deadline) {
    const logcatResult = run(adb, [
      '-s',
      profile.serial,
      'logcat',
      '-d',
      '-v',
      'brief',
      '-s',
      'ParallaxWallpaper:I',
      '*:S',
    ]);
    log = logcatResult.stdout;
    const hasPassed = log.includes('PARALLAX_GL_ALPHA_PRECISION_VALIDATION PASSED');
    const failureLines = log
      .split(/\r?\n/)
      .filter((line) => line.includes('PARALLAX_GL_ALPHA_PRECISION_FAILED'));
    if (hasPassed || failureLines.length > 0) {
      return {
        status: failureLines.length > 0 ? 'FAILED' : 'PASSED',
        error: null,
        failureLines,
      };
    }
    sleep(pollMs);
  }

  return {
    status: 'FAILED',
    error: `timed out after ${timeoutMs}ms waiting for PARALLAX_GL_ALPHA_PRECISION_VALIDATION`,
    failureLines: log
      .split(/\r?\n/)
      .filter((line) => line.includes('PARALLAX_GL_ALPHA_PRECISION_')),
  };
}

const adb = resolveAdb();
const availableDevices = listDevices(adb);
const requestedSerials = (process.env.ANDROID_ALPHA_MATRIX_SERIALS || '')
  .split(',')
  .map((serial) => serial.trim())
  .filter(Boolean);
const selectedDevices = requestedSerials.length === 0
  ? availableDevices
  : availableDevices.filter((device) => requestedSerials.includes(device.serial));

if (selectedDevices.length < 2) {
  fail(
    `at least two authorized devices or emulators are required; `
      + `found ${selectedDevices.length}`,
  );
}

const profiles = selectedDevices.map((device) => readDeviceProfile(adb, device.serial));
const distinctGpuKeys = new Set(profiles.map((profile) => profile.gpuKey));
if (distinctGpuKeys.size < 2) {
  fail(
    `at least two distinct GPU/EGL implementations are required; `
      + `found ${distinctGpuKeys.size}`,
  );
}

console.log(`Alpha GPU matrix: ${profiles.length} targets, ${distinctGpuKeys.size} GPU/EGL implementations`);
const results = profiles.map((profile) => {
  console.log(
    `device=${profile.serial} manufacturer=${profile.manufacturer} `
      + `model=${profile.model} api=${profile.api} gpu=${profile.gpuLabel}`,
  );
  const result = captureAlphaValidation(adb, profile);
  console.log(`device=${profile.serial} alphaValidation=${result.status}`);
  result.failureLines.forEach((line) => console.log(`device=${profile.serial} log=${line}`));
  if (result.error) console.error(`device=${profile.serial} error=${result.error}`);
  return { ...profile, ...result };
});

if (results.some((result) => result.status !== 'PASSED')) {
  process.exitCode = 1;
} else {
  console.log('Alpha GPU matrix passed with no unexpected alpha divergences');
}