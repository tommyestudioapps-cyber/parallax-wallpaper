const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const appPath = path.join(__dirname, '..', 'app', 'index.tsx');
const appSource = fs.readFileSync(appPath, 'utf8');
const hookMatch = appSource.match(
  /function useAttentionAnimation\(shadowColor: string\) \{[\s\S]*?\n\}/,
);

assert.ok(hookMatch, 'useAttentionAnimation must remain defined in app/index.tsx');

function createHookHarness(reducedMotion) {
  const timingTargets = [];
  const delays = [];
  let sharedScale;

  const hookSource = ts.transpileModule(hookMatch[0], {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const sandbox = {
    Easing: {
      out: (easing) => easing,
      back: () => (value) => value,
      in: (easing) => easing,
      quad: (value) => value,
    },
    useAnimatedStyle: (styleFactory) => styleFactory,
    useCallback: (callback) => callback,
    useReducedMotion: () => reducedMotion,
    useSharedValue: (value) => {
      sharedScale = { value };
      return sharedScale;
    },
    withDelay: (delay, animation) => {
      delays.push(delay);
      return animation;
    },
    withSequence: (...steps) => steps[0],
    withTiming: (target) => {
      timingTargets.push(target);
      return target;
    },
  };

  vm.runInNewContext(
    `${hookSource}\nglobalThis.createAttentionHook = useAttentionAnimation;`,
    sandbox,
    { filename: appPath },
  );

  return {
    ...sandbox.createAttentionHook('#123456'),
    getScale: () => sharedScale.value,
    timingTargets,
    delays,
  };
}

function assertReducedMotionBehavior() {
  const harness = createHookHarness(true);
  harness.start(250);

  assert.equal(harness.getScale(), 1, 'reduced motion must keep the shared scale at 1');
  assert.deepEqual(harness.timingTargets, [], 'reduced motion must not schedule pulse timings');

  const style = harness.buttonStyle();
  assert.equal(Math.abs(style.transform[0].translateY), 0);
  assert.equal(style.transform[1].scale, 1);
  assert.equal(style.shadowOpacity, 0.28);
  assert.equal(style.shadowRadius, 18);
  assert.equal(style.shadowOffset.height, 6);
  assert.equal(style.elevation, 6);
}

function assertNormalPulseBehavior() {
  const harness = createHookHarness(false);
  harness.start(250);

  assert.deepEqual(
    harness.timingTargets,
    [1.06, 1, 1, 1.04, 1, 1, 1.02, 1],
    'normal motion must retain the three-stage pulse and return to scale 1',
  );
  assert.equal(harness.delays.at(-1), 250, 'the requested start delay must be retained');

  const style = harness.buttonStyle();
  assert.equal(style.transform[0].translateY, (1.06 - 1) * -40);
  assert.equal(style.transform[1].scale, 1.06);
  assert.equal(style.shadowOpacity, 0.28 + (1.06 - 1) * 1.5);
  assert.equal(style.shadowRadius, 18 + (1.06 - 1) * 300);
  assert.equal(style.shadowOffset.height, 6 + (1.06 - 1) * 200);
  assert.equal(style.elevation, 6 + (1.06 - 1) * 200);
}

function assertAllConsumersUseAttentionHook() {
  const hookInstances = appSource.match(/useAttentionAnimation\(colors\.primary\)/g) ?? [];
  assert.equal(hookInstances.length, 5, 'Preview, edit, and composition should use five hook instances');

  const consumers = [
    ['Preview', 'previewAttention'],
    ['Edit crop control', 'cropAttention'],
    ['Composition middle-layer picker', 'middlePickerAttention'],
    ['Composition foreground-layer picker', 'foregroundPickerAttention'],
    ['Composition preview button', 'previewButtonAttention'],
  ];

  for (const [label, name] of consumers) {
    assert.ok(
      appSource.includes(`${name}.buttonStyle`),
      `${label} must apply the hook’s animated style`,
    );
    assert.match(
      appSource,
      new RegExp(`${name}\\.start\\s*\\(`),
      `${label} must start the hook’s attention animation`,
    );
  }
}

function evaluateAppFunction(functionName, signaturePattern) {
  const match = appSource.match(signaturePattern);
  assert.ok(match, `${functionName} must remain defined in app/index.tsx`);
  const functionSource = ts.transpileModule(match[0], {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const sandbox = {};
  vm.runInNewContext(
    `${functionSource}\nglobalThis.testedFunction = ${functionName};`,
    sandbox,
    { filename: appPath },
  );
  return sandbox.testedFunction;
}

function assertEditScrollAnimationContract() {
  const duration = evaluateAppFunction(
    'calcScrollDuration',
    /function calcScrollDuration\(distance: number\) \{[\s\S]*?\n\}/,
  );
  assert.equal(duration(0), 380, 'scroll duration must keep its 380ms minimum');
  assert.equal(duration(100), 390, 'scroll duration must retain 320 + 0.7 × distance');
  assert.equal(duration(343), 560, 'scroll duration must keep its 560ms maximum');
  assert.equal(duration(1000), 560, 'long scrolls must remain capped at 560ms');

  const easeOutCubic = evaluateAppFunction(
    'easeOutCubic',
    /function easeOutCubic\(progress: number\) \{[\s\S]*?\n\}/,
  );
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(0.5), 0.875, 'scroll must retain cubic ease-out');
  assert.equal(easeOutCubic(1), 1);

  const editEffectStart = appSource.indexOf(
    "useEffect(() => {\n    if (mode !== 'edit' || !editAttentionPending.current) return;",
  );
  const editEffectEndMarker = appSource.indexOf(
    '\n  const handleEditUserInterrupt',
    editEffectStart,
  );
  assert.ok(editEffectStart >= 0 && editEffectEndMarker > editEffectStart);
  const editEffect = appSource.slice(editEffectStart, editEffectEndMarker);
  const foregroundPathStart = editEffect.indexOf(
    'if (editScrollViewportHeight.current <= 0 || editScrollContentHeight.current <= 0) return;',
  );
  assert.ok(foregroundPathStart >= 0, 'middle and foreground must wait for scroll measurements');
  const foregroundPath = editEffect.slice(foregroundPathStart);

  assert.match(
    foregroundPath,
    /const clampedTargetY = Math\.min\(maxScrollY, Math\.max\(0, cropCardY - 24\)\)/,
    'middle and foreground must clamp the crop-card target to the reachable scroll range',
  );
  assert.match(
    foregroundPath,
    /animateScrollTo\(editScrollRef, editScrollY, editScrollFrame, clampedTargetY, \(\) => \{[\s\S]*?cropAttention\.start\(180\)/,
    'the clamped target must animate before the crop attention cue starts',
  );
  assert.match(foregroundPath, /\}, 450\);/, 'edit scroll must retain its 450ms start delay');

  const animateScrollMatch = appSource.match(
    /const animateScrollTo = useCallback\([\s\S]*?\n  \);\n\n  const edit =/,
  );
  assert.ok(animateScrollMatch, 'the shared scroll animator must remain defined');
  assert.match(
    animateScrollMatch[0],
    /calcScrollDuration\(Math\.abs\(targetY - startY\)\)/,
    'duration must use the distance to the supplied, reachable target',
  );
  assert.match(animateScrollMatch[0], /easeOutCubic\(progress\)/);
  assert.match(animateScrollMatch[0], /scrollTo\(\{ y: nextY, animated: false \}\)/);

  const interruptHandlerStart = appSource.indexOf(
    'const handleEditUserInterrupt = useCallback(() => {',
  );
  const interruptHandlerEnd = appSource.indexOf(
    '\n  }, [cropAttention.start, editingLayer]);',
    interruptHandlerStart,
  );
  assert.ok(interruptHandlerStart >= 0 && interruptHandlerEnd > interruptHandlerStart);
  const interruptHandler = appSource.slice(interruptHandlerStart, interruptHandlerEnd);
  assert.match(interruptHandler, /clearTimeout\(editStartTimeout\.current\)/);
  assert.match(interruptHandler, /cancelAnimationFrame\(editScrollFrame\.current\)/);
  assert.match(
    appSource.slice(appSource.indexOf("if (mode === 'edit') {")),
    /onTouchStart=\{handleEditUserInterrupt\}/,
    'touching the edit screen must continue to interrupt the automatic scroll',
  );
}

assertNormalPulseBehavior();
assertReducedMotionBehavior();
assertAllConsumersUseAttentionHook();
assertEditScrollAnimationContract();
console.log(
  'Attention motion validation passed: pulse behavior, scroll timing and easing, reachable edit targets, interruption, and all consumers.',
);