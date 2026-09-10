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

function assertRgbaClose(actual, expected, rgbTolerance, alphaTolerance, description) {
  if (actual.length !== expected.length) {
    throw new Error(`Transparent-edge fixture length mismatch: ${description}`);
  }
  actual.forEach((value, index) => {
    const tolerance = index === 3 ? alphaTolerance : rgbTolerance;
    if (Math.abs(value - expected[index]) > tolerance) {
      const channel = index === 3 ? 'alpha' : `channel ${index}`;
      throw new Error(
        `Transparent-edge fixture mismatch: ${description} at ${channel} `
          + `(tolerance ${tolerance}, expected ${expected[index]}, received ${value})`,
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

function sampleBilinear(texture, coordinate, premultiplied) {
  const x = coordinate[0] * texture.width - 0.5;
  const y = coordinate[1] * texture.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const clamp = (value, maximum) => Math.max(0, Math.min(maximum - 1, value));
  const texel = (column, row) => {
    const rgba = texture.texels[clamp(row, texture.height)][clamp(column, texture.width)];
    return premultiplied ? premultiply(rgba) : rgba;
  };
  const topLeft = texel(x0, y0);
  const topRight = texel(x1, y0);
  const bottomLeft = texel(x0, y1);
  const bottomRight = texel(x1, y1);
  return topLeft.map((value, channel) => {
    const top = value + (topRight[channel] - value) * tx;
    const bottom = bottomLeft[channel] + (bottomRight[channel] - bottomLeft[channel]) * tx;
    return top + (bottom - top) * ty;
  });
}

function validateTransparentEdgeFixture() {
  const fixture = transparentEdgeFixture;
  const sampledComposition = fixture.sampledComposition;
  const bilinearTolerance = fixture.bilinearTolerance;
  const channelTolerances = sampledComposition?.channelTolerances;
  const alphaTolerance = sampledComposition?.alphaTolerance;
  const canonicalTolerance = Array.isArray(channelTolerances)
    ? Math.max(...channelTolerances)
    : NaN;
  const assertCanonicalTolerance = (actual, context) => {
    if (
      !Number.isFinite(actual)
      || Math.abs(actual - canonicalTolerance) > canonicalTolerance * 1e-9
    ) {
      throw new Error(
        `Transparent-edge tolerance policy mismatch for ${context}: `
          + `channels [${channelTolerances?.join(',') || 'missing'}] `
          + `expected ${canonicalTolerance}, received ${actual}`,
      );
    }
  };
  const bilinearCorners = [
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
  ];
  if (!Number.isFinite(bilinearTolerance) || bilinearTolerance <= 0) {
    throw new Error('Transparent-edge fixture must define a positive bilinear tolerance');
  }
  assertCanonicalTolerance(bilinearTolerance, 'global bilinear sampling');
  if (
    !Number.isFinite(alphaTolerance)
    || alphaTolerance <= 0
    || Math.abs(alphaTolerance - canonicalTolerance) <= canonicalTolerance * 1e-9
  ) {
    throw new Error(
      `Transparent-edge alpha tolerance must be positive and distinct from RGB channels: `
        + `channels [${channelTolerances?.join(',') || 'missing'}] `
        + `alpha ${alphaTolerance}`,
    );
  }
  bilinearCorners.forEach((corner) => {
    const coordinate = fixture.bilinearSampleCoordinates[corner];
    if (!Array.isArray(coordinate) || coordinate.length !== 2) {
      throw new Error(`Transparent-edge fixture is missing bilinear coordinate: ${corner}`);
    }
  });
  if (!Array.isArray(fixture.bilinearAlphaCases) || fixture.bilinearAlphaCases.length < 2) {
    throw new Error('Transparent-edge fixture must define multiple bilinear alpha cases');
  }
  const alphaCaseNames = new Set();
  fixture.bilinearAlphaCases.forEach((alphaCase) => {
    if (
      !alphaCase.name
      || alphaCaseNames.has(alphaCase.name)
      || alphaCase.width < 2
      || alphaCase.height < 2
      || alphaCase.texels.length !== alphaCase.height
      || alphaCase.texels.some((row) => row.length !== alphaCase.width)
    ) {
      throw new Error(
        `Transparent-edge bilinear alpha case is invalid: ${alphaCase.name || 'unnamed'}`,
      );
    }
    alphaCaseNames.add(alphaCase.name);
    alphaCase.samples.forEach((sample) => {
      if (
        !Array.isArray(sample.coordinate)
        || sample.coordinate.length !== 2
        || !Array.isArray(sample.expectedPremultiplied)
        || sample.expectedPremultiplied.length !== 4
      ) {
        throw new Error(
          `Transparent-edge bilinear alpha sample is invalid: `
            + `${alphaCase.name} ${sample.name || 'unnamed'}`,
        );
      }
      const calculatedSample = sampleBilinear(alphaCase, sample.coordinate, true);
      const sampleDescription =
        `${alphaCase.name} ${sample.name} coordinate ${sample.coordinate.join(',')}`;
      assertRgbaClose(
        calculatedSample,
        sample.expectedPremultiplied,
        bilinearTolerance,
        alphaTolerance,
        `${sampleDescription} premultiplied reference`,
      );

      const naiveStraightAlphaSample = sampleBilinear(alphaCase, sample.coordinate, false);
      let differenceChannel = -1;
      for (let channel = 0; channel < 3; channel += 1) {
        if (
          Math.abs(naiveStraightAlphaSample[channel] - calculatedSample[channel])
            > channelTolerances[channel]
        ) {
          differenceChannel = channel;
          break;
        }
      }
      if (differenceChannel < 0) {
        throw new Error(
          `Transparent-edge alpha case is not interpolation-sensitive: `
            + `${sampleDescription} channel ${differenceChannel}`,
        );
      }
      for (let channel = 0; channel < 3; channel += 1) {
        if (calculatedSample[channel] > calculatedSample[3] + channelTolerances[channel]) {
          throw new Error(
            `Transparent-edge alpha reference halo at ${sampleDescription} channel ${channel}`,
          );
        }
      }
    });
  });
  if (
    !sampledComposition
    || !Number.isFinite(sampledComposition.tolerance)
    || sampledComposition.tolerance <= 0
    || !Array.isArray(sampledComposition.clearColor)
    || sampledComposition.clearColor.length !== 4
    || !Array.isArray(sampledComposition.layers)
    || sampledComposition.layers.length < 4
    || !Array.isArray(sampledComposition.expectedComposition)
    || sampledComposition.expectedComposition.length !== 4
  ) {
    throw new Error('Transparent-edge sampled composition fixture is invalid');
  }
  if (
    !Array.isArray(channelTolerances)
    || channelTolerances.length !== 3
    || channelTolerances.some((tolerance) => !Number.isFinite(tolerance) || tolerance <= 0)
    || new Set(channelTolerances).size !== 3
  ) {
    throw new Error(
      `Transparent-edge sampled composition must define three distinct channel tolerances: `
        + sampledComposition.name,
    );
  }
  assertCanonicalTolerance(sampledComposition.tolerance, 'sampled composition');
  const alphaCasesByName = new Map(
    fixture.bilinearAlphaCases.map((alphaCase) => [alphaCase.name, alphaCase]),
  );
  const sampledLayers = sampledComposition.layers.map((layer) => {
    const alphaCase = alphaCasesByName.get(layer.case);
    const sample = alphaCase?.samples.find((candidate) => candidate.name === layer.sample);
    if (!alphaCase || !sample) {
      throw new Error(
        `Transparent-edge sampled composition reference is missing: `
          + `${layer.name} ${layer.case} ${layer.sample}`,
      );
    }
    const sampledColor = sampleBilinear(alphaCase, sample.coordinate, true);
    assertRgbaClose(
      sampledColor,
      sample.expectedPremultiplied,
      sampledComposition.tolerance,
      alphaTolerance,
      `${sampledComposition.name} ${layer.name} ${layer.case} `
        + `${layer.sample} sampled layer`,
    );
    return { name: layer.name, color: sampledColor };
  });
  const composeSampledLayers = (
    layers,
    clearColor = sampledComposition.clearColor,
  ) => layers
    .map((layer) => layer.color)
    .reduce((destination, source) => over(source, destination), clearColor);
  const sampledLayerOrder = sampledLayers.map((layer) => layer.name).join(' -> ');
  const sampledCompositionResult = composeSampledLayers(sampledLayers);
  assertRgbaClose(
    sampledCompositionResult,
    sampledComposition.expectedComposition,
    sampledComposition.tolerance,
    alphaTolerance,
    `${sampledComposition.name} clear ${sampledComposition.clearColor.join(',')} `
      + `layers ${sampledLayerOrder}`,
  );
  const reversedSampledComposition = composeSampledLayers(sampledLayers.slice().reverse());
  if (
    reversedSampledComposition.every(
      (value, index) => Math.abs(value - sampledCompositionResult[index])
        <= sampledComposition.tolerance,
    )
  ) {
    throw new Error(
      `Transparent-edge sampled composition does not distinguish draw order: `
        + sampledComposition.name,
    );
  }
  if (
    !Array.isArray(sampledComposition.clearColorVariants)
    || sampledComposition.clearColorVariants.length < 2
  ) {
    throw new Error(
      `Transparent-edge sampled composition must define transparent and opaque clear colors: `
        + sampledComposition.name,
    );
  }
  const clearColorVariantNames = new Set();
  sampledComposition.clearColorVariants.forEach((variant) => {
    if (
      !variant.name
      || clearColorVariantNames.has(variant.name)
      || !Array.isArray(variant.clearColor)
      || variant.clearColor.length !== 4
      || !Number.isFinite(variant.tolerance)
      || variant.tolerance <= 0
      || !Array.isArray(variant.expectedComposition)
      || variant.expectedComposition.length !== 4
    ) {
      throw new Error(
        `Transparent-edge clear-color variant is invalid: `
          + `${sampledComposition.name} ${variant.name || 'unnamed'}`,
      );
    }
    assertCanonicalTolerance(
      variant.tolerance,
      `clear-color variant ${variant.name}`,
    );
    clearColorVariantNames.add(variant.name);
    const variantResult = composeSampledLayers(sampledLayers, variant.clearColor);
    assertRgbaClose(
      variantResult,
      variant.expectedComposition,
      variant.tolerance,
      alphaTolerance,
      `${sampledComposition.name} clear ${variant.name} `
        + `(${variant.clearColor.join(',')}) layers ${sampledLayerOrder}`,
    );
  });
  const transparentLayerSample = sampledComposition.transparentLayerSample;
  if (
    !transparentLayerSample
    || !transparentLayerSample.name
    || !Array.isArray(transparentLayerSample.rgba)
    || transparentLayerSample.rgba.length !== 4
    || transparentLayerSample.rgba[3] !== 0
    || !transparentLayerSample.rgba.slice(0, 3).some((channel) => channel !== 0)
  ) {
    throw new Error(
      `Transparent-edge layer sample must have alpha zero and non-zero RGB: `
        + sampledComposition.name,
    );
  }
  if (
    !Array.isArray(transparentLayerSample.positions)
    || transparentLayerSample.positions.length !== 3
  ) {
    throw new Error(
      `Transparent-edge transparent layer must define start, middle, and end positions: `
        + sampledComposition.name,
    );
  }
  const transparentPositionNames = new Set();
  transparentLayerSample.positions.forEach((position) => {
    if (
      !position.name
      || transparentPositionNames.has(position.name)
      || (position.insertBefore && position.insertAfter)
      || (!position.insertBefore && !position.insertAfter)
    ) {
      throw new Error(
        `Transparent-edge transparent layer position is invalid: `
          + `${sampledComposition.name} ${position.name || 'unnamed'}`,
      );
    }
    const referenceLayerName = position.insertBefore || position.insertAfter;
    const referenceIndex = sampledLayers.findIndex(
      (layer) => layer.name === referenceLayerName,
    );
    if (referenceIndex < 0) {
      throw new Error(
        `Transparent-edge transparent layer position is missing: `
          + `${sampledComposition.name} ${position.name} ${referenceLayerName}`,
      );
    }
    const insertionIndex = position.insertBefore ? referenceIndex : referenceIndex + 1;
    const sampledLayersWithTransparent = sampledLayers.slice();
    sampledLayersWithTransparent.splice(
      insertionIndex,
      0,
      {
        name: transparentLayerSample.name,
        color: premultiply(transparentLayerSample.rgba),
      },
    );
    const sampledLayerOrderWithTransparent = sampledLayersWithTransparent
      .map((layer) => layer.name)
      .join(' -> ');
    sampledComposition.clearColorVariants.forEach((variant) => {
      const withoutTransparent = composeSampledLayers(sampledLayers, variant.clearColor);
      const withTransparent = composeSampledLayers(
        sampledLayersWithTransparent,
        variant.clearColor,
      );
      assertRgbaClose(
        withTransparent,
        withoutTransparent,
        variant.tolerance,
        alphaTolerance,
        `${sampledComposition.name} position ${position.name} clear ${variant.name} `
          + `without vs ${transparentLayerSample.name} `
          + `layers ${sampledLayerOrderWithTransparent}`,
      );
    });
    transparentPositionNames.add(position.name);
  });
  const bilinearTransparentSample = sampledComposition.bilinearTransparentSample;
  const bilinearTransparentTexture = bilinearTransparentSample?.texture;
  if (
    !bilinearTransparentSample
    || !bilinearTransparentSample.name
    || !bilinearTransparentTexture
    || bilinearTransparentTexture.width < 2
    || bilinearTransparentTexture.height < 2
    || bilinearTransparentTexture.width === bilinearTransparentTexture.height
    || bilinearTransparentTexture.texels.length !== bilinearTransparentTexture.height
    || bilinearTransparentTexture.texels.some(
      (row) => row.length !== bilinearTransparentTexture.width,
    )
    || !Array.isArray(bilinearTransparentSample.samples)
    || bilinearTransparentSample.samples.length < 3
    || !Number.isFinite(bilinearTransparentSample.tolerance)
    || bilinearTransparentSample.tolerance <= 0
  ) {
    throw new Error(
      `Transparent-edge bilinear transparent sample is invalid: ${sampledComposition.name}`,
    );
  }
  assertCanonicalTolerance(
    bilinearTransparentSample.tolerance,
    'bilinear transparent sample',
  );
  const bilinearTransparentTexels = bilinearTransparentTexture.texels.flat();
  if (
    !bilinearTransparentTexels.every((rgba) => rgba[3] === 0)
    || !bilinearTransparentTexels.some((rgba) => rgba.slice(0, 3).some((channel) => channel !== 0))
  ) {
    throw new Error(
      `Transparent-edge bilinear sample needs alpha-zero texels with RGB residual: `
        + `${sampledComposition.name} ${bilinearTransparentSample.name}`,
    );
  }
  const bilinearTransparentSamples = bilinearTransparentSample.samples.map((sample) => {
    if (
      !sample.name
      || !Array.isArray(sample.coordinate)
      || sample.coordinate.length !== 2
      || !Array.isArray(sample.expectedPremultiplied)
      || sample.expectedPremultiplied.length !== 4
    ) {
      throw new Error(
        `Transparent-edge bilinear sample point is invalid: `
          + `${bilinearTransparentSample.name} ${sample.name || 'unnamed'}`,
      );
    }
    const bilinearSampleDescription =
      `${sampledComposition.name} ${bilinearTransparentSample.name} ${sample.name} `
        + `coordinate ${sample.coordinate.join(',')}`;
    const premultipliedBilinearColor = sampleBilinear(
      bilinearTransparentTexture,
      sample.coordinate,
      true,
    );
    assertRgbaClose(
      premultipliedBilinearColor,
      sample.expectedPremultiplied,
      bilinearTransparentSample.tolerance,
      alphaTolerance,
      `${bilinearSampleDescription} premultiplied sample`,
    );
    const straightBilinearColor = sampleBilinear(
      bilinearTransparentTexture,
      sample.coordinate,
      false,
    );
    let straightDifferenceChannel = -1;
    for (let channel = 0; channel < 3; channel += 1) {
      if (
        Math.abs(straightBilinearColor[channel] - premultipliedBilinearColor[channel])
          > bilinearTransparentSample.tolerance
      ) {
        straightDifferenceChannel = channel;
        break;
      }
    }
    if (straightDifferenceChannel < 0) {
      throw new Error(
        `Transparent-edge bilinear sample does not expose RGB residual: `
          + `${bilinearSampleDescription} channel ${straightDifferenceChannel}`,
      );
    }
    return {
      ...sample,
      description: bilinearSampleDescription,
      color: premultipliedBilinearColor,
    };
  });
  const isolatedChannelSamples = bilinearTransparentSamples.filter(
    (sample) => sample.isolatedChannel !== undefined,
  );
  if (
    isolatedChannelSamples.length < 3
    || new Set(isolatedChannelSamples.map((sample) => sample.isolatedChannel)).size !== 3
  ) {
    throw new Error(
      `Transparent-edge bilinear samples must cover isolated red, green, and blue residuals: `
        + `${sampledComposition.name}`,
    );
  }
  isolatedChannelSamples.forEach((sample) => {
    if (
      !Number.isInteger(sample.isolatedChannel)
      || sample.isolatedChannel < 0
      || sample.isolatedChannel > 2
    ) {
      throw new Error(
        `Transparent-edge isolated channel is invalid: `
          + `${sample.description} channel ${sample.isolatedChannel}`,
      );
    }
    const straightColor = sampleBilinear(
      bilinearTransparentTexture,
      sample.coordinate,
      false,
    );
    if (straightColor[sample.isolatedChannel] <= bilinearTransparentSample.tolerance) {
      throw new Error(
        `Transparent-edge isolated RGB residual is missing: `
          + `${sample.description} channel ${sample.isolatedChannel}`,
      );
    }
    for (let channel = 0; channel < 3; channel += 1) {
      if (
        channel !== sample.isolatedChannel
        && Math.abs(straightColor[channel]) > bilinearTransparentSample.tolerance
      ) {
        throw new Error(
          `Transparent-edge isolated RGB residual leaked: `
            + `${sample.description} channel ${channel}`,
        );
      }
    }
  });
  transparentLayerSample.positions.forEach((position) => {
    const referenceLayerName = position.insertBefore || position.insertAfter;
    const referenceIndex = sampledLayers.findIndex(
      (layer) => layer.name === referenceLayerName,
    );
    const insertionIndex = position.insertBefore ? referenceIndex : referenceIndex + 1;
    bilinearTransparentSamples.forEach((sample) => {
      const sampledLayersWithBilinearTransparent = sampledLayers.slice();
      sampledLayersWithBilinearTransparent.splice(
        insertionIndex,
        0,
        {
          name: `${bilinearTransparentSample.name}-${sample.name}`,
          color: sample.color,
        },
      );
      const sampledLayerOrderWithBilinearTransparent = sampledLayersWithBilinearTransparent
        .map((layer) => layer.name)
        .join(' -> ');
      sampledComposition.clearColorVariants.forEach((variant) => {
        const withoutSample = composeSampledLayers(sampledLayers, variant.clearColor);
        const withSample = composeSampledLayers(
          sampledLayersWithBilinearTransparent,
          variant.clearColor,
        );
        assertRgbaClose(
          withSample,
          withoutSample,
          variant.tolerance,
          alphaTolerance,
          `${sample.description} position ${position.name} clear ${variant.name} `
            + `before vs after composition layers ${sampledLayerOrderWithBilinearTransparent}`,
        );
      });
    });
  });
  if (
    !Array.isArray(sampledComposition.toleranceBoundarySamples)
    || sampledComposition.toleranceBoundarySamples.length < 6
  ) {
    throw new Error(
      `Transparent-edge tolerance boundary must cover below/above red, green, and blue: `
        + sampledComposition.name,
    );
  }
  const toleranceBoundaryChannels = new Set();
  sampledComposition.toleranceBoundarySamples.forEach((boundary) => {
    const boundaryTexture = boundary.texture;
    if (
      !boundary.name
      || !['below', 'above'].includes(boundary.threshold)
      || !Number.isInteger(boundary.channel)
      || boundary.channel < 0
      || boundary.channel > 2
      || !Array.isArray(boundary.coordinate)
      || boundary.coordinate.length !== 2
      || !boundaryTexture
      || boundaryTexture.width < 2
      || boundaryTexture.height < 2
      || boundaryTexture.texels.length !== boundaryTexture.height
      || boundaryTexture.texels.some((row) => row.length !== boundaryTexture.width)
      || !Array.isArray(boundary.expectedPremultiplied)
      || boundary.expectedPremultiplied.length !== 4
    ) {
      throw new Error(
        `Transparent-edge tolerance boundary is invalid: `
          + `${sampledComposition.name} ${boundary.name || 'unnamed'}`,
      );
    }
    const boundaryTexels = boundaryTexture.texels.flat();
    if (!boundaryTexels.every((rgba) => rgba[3] === 0)) {
      throw new Error(
        `Transparent-edge tolerance boundary must use alpha-zero texels: `
          + `${sampledComposition.name} ${boundary.name}`,
      );
    }
    const premultipliedBoundaryColor = sampleBilinear(
      boundaryTexture,
      boundary.coordinate,
      true,
    );
    const straightBoundaryColor = sampleBilinear(
      boundaryTexture,
      boundary.coordinate,
      false,
    );
    const channelTolerance = channelTolerances[boundary.channel];
    const boundaryDescription =
      `${sampledComposition.name} ${boundary.name} coordinate ${boundary.coordinate.join(',')}`;
    assertRgbaClose(
      premultipliedBoundaryColor,
      boundary.expectedPremultiplied,
      channelTolerance,
      alphaTolerance,
      `${boundaryDescription} premultiplied sample`,
    );
    const expectedDistance = channelTolerance * 0.1;
    if (
      Math.abs(
        Math.abs(straightBoundaryColor[boundary.channel] - channelTolerance)
          - expectedDistance,
      ) > bilinearTransparentSample.tolerance * 0.25
    ) {
      throw new Error(
        `Transparent-edge tolerance boundary is not close to the threshold: `
          + `${boundaryDescription} channel ${boundary.channel}`,
      );
    }
    toleranceBoundaryChannels.add(boundary.channel);
    transparentLayerSample.positions.forEach((position) => {
      const referenceLayerName = position.insertBefore || position.insertAfter;
      const referenceIndex = sampledLayers.findIndex(
        (layer) => layer.name === referenceLayerName,
      );
      const insertionIndex = position.insertBefore ? referenceIndex : referenceIndex + 1;
      sampledComposition.clearColorVariants.forEach((variant) => {
        const passesThreshold =
          boundary.threshold === 'below'
            ? straightBoundaryColor[boundary.channel] <= channelTolerance
            : straightBoundaryColor[boundary.channel] > channelTolerance;
        if (!passesThreshold) {
          throw new Error(
            `Transparent-edge tolerance classification failed: ${boundaryDescription} `
              + `position ${position.name} clear ${variant.name} `
              + `channel ${boundary.channel}`,
          );
        }
        const sampledLayersWithBoundary = sampledLayers.slice();
        sampledLayersWithBoundary.splice(
          insertionIndex,
          0,
          {
            name: boundary.name,
            color: premultipliedBoundaryColor,
          },
        );
        const withoutBoundary = composeSampledLayers(sampledLayers, variant.clearColor);
        const withBoundary = composeSampledLayers(
          sampledLayersWithBoundary,
          variant.clearColor,
        );
        assertRgbaClose(
          withBoundary,
          withoutBoundary,
          variant.tolerance,
          alphaTolerance,
          `${boundaryDescription} position ${position.name} clear ${variant.name} `
            + `before vs after composition channel ${boundary.channel}`,
        );
      });
    });
  });
  if (toleranceBoundaryChannels.size !== 3) {
    throw new Error(
      `Transparent-edge tolerance boundary must cover all RGB channels: `
        + sampledComposition.name,
    );
  }
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
  assertRgbaClose(
    composition,
    fixture.expectedComposition,
    canonicalTolerance,
    alphaTolerance,
    'Background -> Middle -> Foreground premultiplied composition',
  );

  const reversedComposition = fixture.layers
    .slice()
    .reverse()
    .map((layer) => layer.center)
    .reduce((destination, source) => over(source, destination));
  if (
    reversedComposition.every(
      (value, index) => Math.abs(value - fixture.expectedComposition[index])
        <= (index === 3 ? alphaTolerance : channelTolerances[index]),
    )
  ) {
    throw new Error('Transparent-edge fixture does not distinguish draw order');
  }

  fixture.layers.forEach((layer) => {
    const expectedEdge = premultiply(layer.transparentEdgeSource);
    if (layer.transparentEdgeSource[3] !== 0) {
      throw new Error(`Transparent-edge fixture edge must be transparent: ${layer.name}`);
    }
    assertRgbaClose(
      expectedEdge,
      [0, 0, 0, 0],
      canonicalTolerance,
      alphaTolerance,
      `${layer.name} premultiplied transparent edge`,
    );

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
    assertRgbaClose(
      leftSample,
      expectedEdge,
      canonicalTolerance,
      alphaTolerance,
      `${layer.name} GL_CLAMP_TO_EDGE left sample`,
    );
    assertRgbaClose(
      rightSample,
      layer.edgeInterior,
      canonicalTolerance,
      alphaTolerance,
      `${layer.name} GL_CLAMP_TO_EDGE right sample`,
    );

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

    const texture = layer.texture;
    if (
      !texture
      || texture.width !== 4
      || texture.height !== 4
      || texture.texels.length !== texture.height
      || texture.texels.some((row) => row.length !== texture.width)
    ) {
      throw new Error(
        `Transparent-edge fixture must define a 4x4 texture grid: ${layer.name}`,
      );
    }

    const cornerTexels = {
      'top-left': texture.texels[0][0],
      'top-right': texture.texels[0][texture.width - 1],
      'bottom-left': texture.texels[texture.height - 1][0],
      'bottom-right': texture.texels[texture.height - 1][texture.width - 1],
    };
    bilinearCorners.forEach((corner) => {
      if (cornerTexels[corner][3] !== 0) {
        throw new Error(
          `Transparent-edge fixture corner must be transparent: ${layer.name} ${corner}`,
        );
      }

      const coordinate = fixture.bilinearSampleCoordinates[corner];
      const expectedSample = sampleBilinear(texture, coordinate, true);
      const naiveStraightAlphaSample = sampleBilinear(texture, coordinate, false);
      assertRgbaClose(
        expectedSample,
        sampleBilinear(texture, coordinate, true),
        canonicalTolerance,
        alphaTolerance,
        `${layer.name} ${corner} premultiplied bilinear sample`,
      );
      if (
        naiveStraightAlphaSample.every(
          (value, index) => Math.abs(value - expectedSample[index])
            <= (index === 3 ? alphaTolerance : channelTolerances[index]),
        )
      ) {
        throw new Error(
          `Transparent-edge fixture is not halo-sensitive: ${layer.name} ${corner}`,
        );
      }
      for (let channel = 0; channel < 3; channel += 1) {
        if (expectedSample[channel] > expectedSample[3] + channelTolerances[channel]) {
          throw new Error(
            `Transparent-edge bilinear halo at ${layer.name} ${corner} channel ${channel}`,
          );
        }
      }
    });

    if (layer.gradientEdge) {
      const gradient = layer.gradientEdge;
      if (
        gradient.width !== 4
        || gradient.height !== 2
        || gradient.texels.length !== gradient.height
        || gradient.texels.some((row) => row.length !== gradient.width)
      ) {
        throw new Error(
          `Transparent-edge gradient must be 4x2: ${layer.name}`,
        );
      }
      const gradientAlphaValues = gradient.texels[0].map((rgba) => rgba[3]);
      if (new Set(gradientAlphaValues).size < 3) {
        throw new Error(
          `Transparent-edge gradient needs gradual alpha values: ${layer.name} top edge`,
        );
      }

      Object.entries(gradient.sampleCoordinates).forEach(([sampleName, coordinate]) => {
        if (!Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error(
            `Transparent-edge gradient coordinate is invalid: ${layer.name} ${sampleName}`,
          );
        }
        const expectedSample = sampleBilinear(gradient, coordinate, true);
        const naiveStraightAlphaSample = sampleBilinear(gradient, coordinate, false);
        assertRgbaClose(
          expectedSample,
          sampleBilinear(gradient, coordinate, true),
          canonicalTolerance,
          alphaTolerance,
          `${layer.name} ${sampleName} coordinate ${coordinate.join(',')} gradient sample`,
        );
        if (
          naiveStraightAlphaSample.every(
            (value, index) => Math.abs(value - expectedSample[index])
              <= (index === 3 ? alphaTolerance : channelTolerances[index]),
          )
        ) {
          throw new Error(
            `Transparent-edge gradient is not halo-sensitive: `
              + `${layer.name} ${sampleName} coordinate ${coordinate.join(',')}`,
          );
        }
        for (let channel = 0; channel < 3; channel += 1) {
          if (expectedSample[channel] > expectedSample[3] + channelTolerances[channel]) {
            throw new Error(
              `Transparent-edge gradient halo at ${layer.name} ${sampleName} `
                + `coordinate ${coordinate.join(',')} channel ${channel}`,
            );
          }
        }
      });
    }

    if (layer.extremeAlphaEdge) {
      const extreme = layer.extremeAlphaEdge;
      const extremeTolerance = extreme.tolerance;
      if (
        extreme.width !== 2
        || extreme.height !== 2
        || extreme.texels.length !== extreme.height
        || extreme.texels.some((row) => row.length !== extreme.width)
        || !Number.isFinite(extremeTolerance)
        || extremeTolerance <= 0
      ) {
        throw new Error(
          `Transparent-edge extreme-alpha fixture is invalid: ${layer.name}`,
        );
      }

      const extremeTexels = extreme.texels.flat();
      const nearZeroTexels = extremeTexels.filter(
        (rgba) => rgba[3] > 0 && rgba[3] <= 0.00001,
      );
      const hasExtremeRgb = nearZeroTexels.some(
        (rgba) => rgba.slice(0, 3).some((channel) => channel === 1),
      );
      if (nearZeroTexels.length === 0 || !hasExtremeRgb) {
        throw new Error(
          `Transparent-edge extreme-alpha fixture needs near-zero alpha and RGB extremes: ${layer.name}`,
        );
      }

      Object.entries(extreme.sampleCoordinates).forEach(([sampleName, coordinate]) => {
        if (!Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error(
            `Transparent-edge extreme-alpha coordinate is invalid: `
              + `${layer.name} ${sampleName}`,
          );
        }
        const expectedSample = sampleBilinear(extreme, coordinate, true);
        const naiveStraightAlphaSample = sampleBilinear(extreme, coordinate, false);
        assertRgbaClose(
          expectedSample,
          sampleBilinear(extreme, coordinate, true),
          canonicalTolerance,
          alphaTolerance,
          `${layer.name} ${sampleName} coordinate ${coordinate.join(',')} extreme-alpha sample`,
        );

        let naiveDifferenceChannel = -1;
        for (let channel = 0; channel < 3; channel += 1) {
          if (
            Math.abs(naiveStraightAlphaSample[channel] - expectedSample[channel])
              > channelTolerances[channel]
          ) {
            naiveDifferenceChannel = channel;
            break;
          }
        }
        if (naiveDifferenceChannel < 0) {
          throw new Error(
            `Transparent-edge extreme-alpha fixture is not halo-sensitive: `
              + `${layer.name} ${sampleName} coordinate ${coordinate.join(',')} `
              + `channel ${naiveDifferenceChannel}`,
          );
        }

        for (let channel = 0; channel < 3; channel += 1) {
          if (expectedSample[channel] > expectedSample[3] + channelTolerances[channel]) {
            throw new Error(
              `Transparent-edge extreme-alpha halo at ${layer.name} ${sampleName} `
                + `coordinate ${coordinate.join(',')} channel ${channel}`,
            );
          }
        }
      });
    }
  });

  const transparentStack = fixture.layers
    .map((layer) => premultiply(layer.transparentEdgeSource))
    .reduce((destination, source) => over(source, destination), fixture.clearColor);
  assertRgbaClose(
    transparentStack,
    fixture.clearColor,
    canonicalTolerance,
    alphaTolerance,
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
