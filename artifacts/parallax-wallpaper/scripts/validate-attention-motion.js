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

assertNormalPulseBehavior();
assertReducedMotionBehavior();
assertAllConsumersUseAttentionHook();
console.log('Attention motion validation passed: normal pulse, reduced-motion reset, and all five consumers.');