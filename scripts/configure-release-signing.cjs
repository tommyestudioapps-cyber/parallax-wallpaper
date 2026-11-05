const fs = require('fs');
const path = require('path');

const buildGradlePath = path.resolve(__dirname, '../artifacts/parallax-wallpaper/android/app/build.gradle');

if (!fs.existsSync(buildGradlePath)) {
  console.log('build.gradle nao encontrado em:', buildGradlePath);
  process.exit(1);
}

let content = fs.readFileSync(buildGradlePath, 'utf8');

// 1. Inserir signingConfigs.release caso nao exista
const debugSigningMarker = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;

const releaseSigningBlock = `${debugSigningMarker}
        release {
            storeFile file('release.keystore')
            storePassword 'tommy123456'
            keyAlias 'parallaxkey'
            keyPassword 'tommy123456'
        }`;

if (content.includes(debugSigningMarker) && !content.includes('parallaxkey')) {
  content = content.replace(debugSigningMarker, releaseSigningBlock);
}

// 2. Garantir que o bloco buildTypes { release { ... } } use signingConfig signingConfigs.release
const buildTypesPos = content.indexOf('buildTypes {');
if (buildTypesPos !== -1) {
  const buildTypesBlock = content.slice(buildTypesPos);
  const releaseBuildTypePos = buildTypesBlock.indexOf('release {');
  if (releaseBuildTypePos !== -1) {
    const targetSig = 'signingConfig signingConfigs.debug';
    const sigPosInRelease = buildTypesBlock.indexOf(targetSig, releaseBuildTypePos);
    if (sigPosInRelease !== -1) {
      const globalSigPos = buildTypesPos + sigPosInRelease;
      content = content.slice(0, globalSigPos) + 'signingConfig signingConfigs.release' + content.slice(globalSigPos + targetSig.length);
    }
  }
}

// 3. Garantir que o bloco debug volte a usar signingConfigs.debug caso tenha sido alterado
content = content.replace(
  /buildTypes\s*\{\s*debug\s*\{\s*signingConfig\s+signingConfigs\.release/g,
  'buildTypes {\n        debug {\n            signingConfig signingConfigs.debug'
);

fs.writeFileSync(buildGradlePath, content, 'utf8');

// Verificação de segurança
const verified = fs.readFileSync(buildGradlePath, 'utf8');
const checkBt = verified.slice(verified.indexOf('buildTypes {'));
const checkRelease = checkBt.slice(checkBt.indexOf('release {'));
console.log('build.gradle atualizado com sucesso!');
console.log('Verificacao do release signingConfig:', checkRelease.slice(0, 200));
