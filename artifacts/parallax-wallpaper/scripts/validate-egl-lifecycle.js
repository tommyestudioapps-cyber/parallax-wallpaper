const fs = require('fs');
const path = require('path');

const transparentEdgeFixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'transparent-edge-composition.json'),
    'utf8',
  ),
);
const javaRoot = path.resolve(
  __dirname,
  '..',
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'parallaxwallpaper',
  'app',
);
const controller = fs.readFileSync(
  path.join(javaRoot, 'ParallaxEglController.java'),
  'utf8',
);

const wallpaperService = fs.readFileSync(
  path.join(javaRoot, 'ParallaxWallpaperService.java'),
  'utf8',
);
const eglThread = fs.readFileSync(path.join(javaRoot, 'ParallaxEglThread.java'), 'utf8');
const textureManager = fs.readFileSync(
  path.join(javaRoot, 'ParallaxTextureManager.java'),
  'utf8',
);
const glRenderer = fs.readFileSync(path.join(javaRoot, 'ParallaxGlRenderer.java'), 'utf8');

function assertContains(source, pattern, description) {
  if (!pattern.test(source)) {
    throw new Error(`Missing EGL lifecycle guarantee: ${description}`);
  }
}

function assertOrder(source, patterns, description) {
  let previousIndex = -1;
  for (const pattern of patterns) {
    const index = source.search(pattern);
    if (index < 0 || index <= previousIndex) {
      throw new Error(`Invalid EGL cleanup order: ${description}`);
    }
    previousIndex = index;
  }
}

function methodBody(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start + signature.length);
  if (start < 0 || end < 0) {
    throw new Error(`Missing method boundaries for lifecycle check: ${signature}`);
  }
  return source.slice(start, end);
}

function assertClose(actual, expected, description, epsilon = 1e-6) {
  if (actual.length !== expected.length) {
    throw new Error(`Transparent-edge fixture length mismatch: ${description}`);
  }
  actual.forEach((value, index) => {
    if (Math.abs(value - expected[index]) > epsilon) {
      throw new Error(
        `Transparent-edge fixture mismatch: ${description} `
          + `at channel ${index} (expected ${expected[index]}, received ${value})`,
      );
    }
  });
}

function premultiply(rgba) {
  return [rgba[0] * rgba[3], rgba[1] * rgba[3], rgba[2] * rgba[3], rgba[3]];
}

function over(source, destination) {
  const inverseAlpha = 1 - source[3];
  return [
    source[0] + destination[0] * inverseAlpha,
    source[1] + destination[1] * inverseAlpha,
    source[2] + destination[2] * inverseAlpha,
    source[3] + destination[3] * inverseAlpha,
  ];
}

function sampleClamped(edge, interior, coordinate) {
  if (coordinate < 0) return edge;
  if (coordinate > 1) return interior;
  return coordinate < 0.5 ? edge : interior;
}

function sampleRepeated(edge, interior, coordinate) {
  if (coordinate < 0) return interior;
  if (coordinate > 1) return edge;
  return coordinate < 0.5 ? edge : interior;
}

function validateTransparentEdgeFixture() {
  const fixture = transparentEdgeFixture;
  const expectedLayerNames = ['background', 'middle', 'foreground'];
  const layerNames = fixture.layers.map((layer) => layer.name);
  if (JSON.stringify(layerNames) !== JSON.stringify(expectedLayerNames)) {
    throw new Error(
      `Transparent-edge fixture must use Background -> Middle -> Foreground order; `
        + `received ${layerNames.join(' -> ')}`,
    );
  }

  const composition = fixture.layers
    .map((layer) => layer.center)
    .reduce((destination, source) => over(source, destination));
  assertClose(
    composition,
    fixture.expectedComposition,
    'Background -> Middle -> Foreground premultiplied composition',
  );

  const reversedComposition = fixture.layers
    .slice()
    .reverse()
    .map((layer) => layer.center)
    .reduce((destination, source) => over(source, destination));
  if (
    reversedComposition.every(
      (value, index) => Math.abs(value - fixture.expectedComposition[index]) <= 1e-6,
    )
  ) {
    throw new Error('Transparent-edge fixture does not distinguish draw order');
  }

  fixture.layers.forEach((layer) => {
    const expectedEdge = premultiply(layer.transparentEdgeSource);
    if (layer.transparentEdgeSource[3] !== 0) {
      throw new Error(`Transparent-edge fixture edge must be transparent: ${layer.name}`);
    }
    assertClose(expectedEdge, [0, 0, 0, 0], `${layer.name} premultiplied transparent edge`);

    const leftSample = sampleClamped(
      expectedEdge,
      layer.edgeInterior,
      fixture.outsideTextureCoordinates[0],
    );
    const rightSample = sampleClamped(
      expectedEdge,
      layer.edgeInterior,
      fixture.outsideTextureCoordinates[1],
    );
    assertClose(leftSample, expectedEdge, `${layer.name} GL_CLAMP_TO_EDGE left sample`);
    assertClose(rightSample, layer.edgeInterior, `${layer.name} GL_CLAMP_TO_EDGE right sample`);

    const repeatedLeftSample = sampleRepeated(
      expectedEdge,
      layer.edgeInterior,
      fixture.outsideTextureCoordinates[0],
    );
    if (
      repeatedLeftSample.every(
        (value, index) => Math.abs(value - leftSample[index]) <= 1e-6,
      )
    ) {
      throw new Error(`Transparent-edge fixture does not distinguish clamping: ${layer.name}`);
    }
  });

  const transparentStack = fixture.layers
    .map((layer) => premultiply(layer.transparentEdgeSource))
    .reduce((destination, source) => over(source, destination), fixture.clearColor);
  assertClose(
    transparentStack,
    fixture.clearColor,
    'transparent edge preserves the clear color without a black halo',
  );
}

for (const state of ['STOPPED', 'STARTING', 'RUNNING', 'STOPPING']) {
  assertContains(controller, new RegExp(`\\b${state}\\b`), `FSM state ${state}`);
}

assertContains(
  wallpaperService,
  /USE_OPENGL_RENDERER\s*=\s*(?:true|false)/,
  'OpenGL renderer can be selected without changing the Canvas default',
);
assertContains(controller, /state = State\.STOPPING/, 'surface transitions request STOPPING');
assertContains(controller, /thread\.requestStop\(\)/, 'stopping is asynchronous');
assertContains(controller, /state == State\.STOPPING/, 'restart is gated by STOPPING');
assertContains(controller, /threadHadEglReady && state == State\.STOPPING/, 'restart requires a completed EGL thread');
assertContains(controller, /state != State\.STOPPED/, 'new threads only start from STOPPED');
assertContains(controller, /isSurfaceValid\(requestedSurface\)/, 'surface validity is checked before start');
assertContains(controller, /released = true/, 'release marks the controller as released');
assertContains(controller, /volatile ParallaxSensorState sensorState/, 'sensor snapshots are retained safely');
assertContains(controller, /thread\.updateSensorState\(nextState\)/, 'sensor snapshots reach the EGL thread');

if (/Thread\.join|Thread\.sleep|sleep\s*\(/.test(controller)) {
  throw new Error('EGL controller must not block callbacks with join or sleep');
}

assertContains(
  eglThread,
  /boolean swapSucceeded = EGL14\.eglSwapBuffers/,
  'swap result is captured for timing and failure handling',
);
assertContains(eglThread, /running = false/, 'swap failure stops the loop');
assertContains(eglThread, /new ParallaxGlRenderer/, 'EGL thread owns the GL renderer');
assertContains(eglThread, /initializeGlRenderer\(\)/, 'GL renderer initializes after EGL');
assertContains(eglThread, /volatile ParallaxSensorState sensorState/, 'EGL thread reads a volatile sensor snapshot');
assertContains(eglThread, /glRenderer\.updateSensorState\(snapshot\.getX\(\), snapshot\.getY\(\)\)/, 'latest sensor values reach the GL renderer');
assertContains(eglThread, /glRenderer\.renderFrame\(\)/, 'EGL loop delegates frame rendering');
assertContains(eglThread, /glRenderer\.release\(\)/, 'GL resources release before EGL teardown');
assertContains(eglThread, /private long totalGlFrames/, 'GPU frame count is tracked');
assertContains(eglThread, /private long accumulatedDrawTimeNs/, 'GPU frame time is accumulated');
assertContains(eglThread, /private double maxFrameTimeMs/, 'maximum GPU frame time is tracked');
assertContains(eglThread, /private long droppedGlFrames/, 'GPU dropped frames are tracked');
assertContains(eglThread, /private long vsyncMisses/, 'VSync misses are tracked');
assertContains(eglThread, /System\.nanoTime\(\)/, 'GPU timing uses monotonic nanoseconds');
assertContains(eglThread, /METRICS_FRAME_WINDOW = 60L/, 'GPU metrics use a 60-frame window');
assertContains(eglThread, /METRICS_TIME_WINDOW_NS = 5_000_000_000L/, 'GPU metrics use a five-second window');
assertContains(eglThread, /PARALLAX_GPU_METRICS/, 'GPU metrics are logged with the comparison tag');
assertContains(eglThread, /averageFps=/, 'GPU metrics include average FPS');
assertContains(eglThread, /averageRenderMs=/, 'GPU metrics include average render time');
assertContains(eglThread, /maxRenderMs=/, 'GPU metrics include maximum render time');
assertContains(eglThread, /swapStatus=/, 'GPU metrics include swap status');
assertContains(eglThread, /lastSwapMs=/, 'GPU metrics include swap timing');
assertContains(eglThread, /recordGlFrame\(frameDurationNs, swapDurationNs, swapSucceeded\)/, 'frame metrics are recorded after swap completion');
assertOrder(
  methodBody(eglThread, 'public void run()', 'private EGLDisplay currentDisplay'),
  [/initializeEgl\(\)/, /listener\.onEglReady\(this\)/],
  'the controller is notified only after EGL initialization',
);
assertOrder(
  methodBody(eglThread, 'public void run()', 'private EGLDisplay currentDisplay'),
  [/cleanupEgl\(/, /listener\.onEglThreadTerminated\(this\)/],
  'the controller is notified only after native cleanup',
);
assertOrder(
  methodBody(eglThread, 'private boolean initializeEgl()', 'private void cleanupEgl'),
  [/eglSwapInterval\(/, /PARALLAX_EGL_READY/],
  'EGL READY is logged after VSync configuration',
);
assertOrder(
  methodBody(eglThread, 'private void cleanupEgl(', '\n  }\n}'),
  [
    /eglMakeCurrent\(/,
    /eglDestroySurface\(/,
    /eglDestroyContext\(/,
    /eglTerminate\(/,
    /PARALLAX_EGL_TERMINATED/,
  ],
  'make current is released before surface, context, and display teardown',
);
assertOrder(
  methodBody(controller, 'public void onEglReady(ParallaxEglThread thread)', 'public void onEglThreadTerminated'),
  [/state = State\.RUNNING/, /PARALLAX_EGL_CONTROLLER_RUNNING/],
  'RUNNING is logged after the controller enters RUNNING',
);
assertOrder(
  methodBody(controller, 'public void onEglThreadTerminated(ParallaxEglThread thread)', 'private void updateRequestedSurface'),
  [/PARALLAX_EGL_CONTROLLER_STOPPED/, /startIfPossible\(\)/],
  'STOPPED is logged before a pending thread can start',
);
assertOrder(
  methodBody(controller, 'private void startIfPossible()', 'private boolean isSurfaceValid'),
  [/PARALLAX_EGL_CONTROLLER_STARTING/, /eglThread\.start\(\)/],
  'STARTING is logged before the EGL thread starts',
);

assertContains(textureManager, /private final int\[\] mTextureIds = new int\[LAYER_COUNT\]/, 'three texture IDs are retained');
assertContains(textureManager, /LAYER_NAMES = \{"background", "middle", "foreground"\}/, 'all three layer names are loaded');
assertContains(textureManager, /GLES20\.glGenTextures\(1, mTextureIds, index\)/, 'each layer receives its own texture ID');
assertContains(textureManager, /public int\[\] loadTextures/, 'multi-texture loading is exposed');
assertContains(textureManager, /GLUtils\.texImage2D/, 'bitmaps upload through GLUtils');
assertContains(textureManager, /GLES20\.GL_LINEAR/, 'linear texture filtering is configured');
assertContains(
  textureManager,
  /GLES20\.glTexParameteri\(\s*GLES20\.GL_TEXTURE_2D,\s*GLES20\.GL_TEXTURE_WRAP_S,\s*GLES20\.GL_CLAMP_TO_EDGE\s*\)/s,
  'horizontal texture coordinates clamp to the edge',
);
assertContains(
  textureManager,
  /GLES20\.glTexParameteri\(\s*GLES20\.GL_TEXTURE_2D,\s*GLES20\.GL_TEXTURE_WRAP_T,\s*GLES20\.GL_CLAMP_TO_EDGE\s*\)/s,
  'vertical texture coordinates clamp to the edge',
);
assertContains(textureManager, /public void releaseTextures\(\)/, 'all textures have a release method');
assertContains(textureManager, /GLES20\.glDeleteTextures\(1, mTextureIds, index\)/, 'all texture IDs are deleted');
assertContains(textureManager, /if \(texturesLoaded\) return mTextureIds/, 'texture upload is guarded per context');
assertContains(textureManager, /BitmapFactory\.decode/, 'background bitmap loading is isolated from the frame loop');

assertContains(glRenderer, /glCreateShader/, 'vertex and fragment shaders are compiled');
assertContains(glRenderer, /glGenBuffers/, 'fullscreen quad uses a VBO');
assertContains(glRenderer, /glBufferData/, 'quad data uploads once to the VBO');
assertContains(glRenderer, /glDrawArrays/, 'fullscreen quad is rendered');
assertContains(glRenderer, /texture2D/, 'fragment shader samples the texture');
assertContains(glRenderer, /uniform mat4 u_MVPMatrix/, 'vertex shader accepts an MVP matrix');
assertContains(
  glRenderer,
  /gl_Position = u_MVPMatrix \* displacedPosition/,
  'vertex shader applies the MVP matrix after sensor displacement',
);
assertContains(glRenderer, /Matrix\.orthoM/, 'projection matrix is initialized');
assertContains(glRenderer, /Matrix\.scaleM/, 'layer aspect scale is calculated');
assertContains(glRenderer, /glUniformMatrix4fv/, 'MVP matrix is sent before drawing');
assertContains(glRenderer, /private final float\[\] mMVPMatrix = new float\[16\]/, 'MVP matrix is reused');
assertContains(textureManager, /mTextureWidths/, 'decoded texture widths are retained');
assertContains(textureManager, /mTextureHeights/, 'decoded texture heights are retained');
assertContains(textureManager, /mDepthFactors/, 'layer depth factors are retained');
assertContains(textureManager, /parallaxMultiplier/, 'layer depth factors come from composition');
assertContains(glRenderer, /fitScale = Math\.max/, 'fit scale matches Canvas cover behavior');
assertContains(glRenderer, /uniform vec2 u_Offset/, 'vertex shader accepts sensor offset');
assertContains(glRenderer, /uniform float u_DepthFactor/, 'vertex shader accepts layer depth');
assertContains(glRenderer, /u_Offset \* u_DepthFactor/, 'vertex shader displaces by depth');
assertContains(glRenderer, /glUniform2f\(offsetLocation, motionX, motionY\)/, 'sensor offset is sent per layer');
assertContains(glRenderer, /glUniform1f\(depthFactorLocation, textureManager\.getDepthFactor\(index\)\)/, 'layer depth is sent per layer');
assertContains(glRenderer, /public void updateSensorState\(float sensorMotionX, float sensorMotionY\)/, 'GL renderer receives sensor values without objects');
assertContains(glRenderer, /GLES20\.glEnable\(GLES20\.GL_BLEND\)/, 'alpha blending is enabled');
assertContains(
  glRenderer,
  /GLES20\.glBlendFunc\(GLES20\.GL_ONE, GLES20\.GL_ONE_MINUS_SRC_ALPHA\)/,
  'premultiplied alpha blending is configured',
);
assertContains(
  glRenderer,
  /gl_FragColor = texture2D\(u_Texture, v_TexCoord\)/,
  'sampled RGB and alpha reach the fragment output',
);
const glFrameBody = methodBody(glRenderer, 'public void renderFrame()', 'public void release()');
assertOrder(
  glFrameBody,
  [/glClear\(/, /for \(int index = 0/, /glBindTexture\(/, /glDrawArrays\(/],
  'layers render back-to-front after clearing',
);
if (/BitmapFactory|new\s+/.test(glFrameBody)) {
  throw new Error('GL renderFrame must not decode bitmaps or allocate objects');
}

validateTransparentEdgeFixture();
console.log('EGL lifecycle static regression checks passed');
console.log('Transparent-edge composition fixture passed');
