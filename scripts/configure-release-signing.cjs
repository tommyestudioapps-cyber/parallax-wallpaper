const fs = require('fs');
const path = require('path');

const buildGradlePath = path.resolve(__dirname, '../artifacts/parallax-wallpaper/android/app/build.gradle');

if (!fs.existsSync(buildGradlePath)) {
  console.log('build.gradle nao encontrado em:', buildGradlePath);
  process.exit(1);
}

let content = fs.readFileSync(buildGradlePath, 'utf8');

const debugBlock = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;

const releaseBlock = `${debugBlock}
        release {
            storeFile file('release.keystore')
            storePassword 'tommy123456'
            keyAlias 'parallaxkey'
            keyPassword 'tommy123456'
        }`;

if (content.includes(debugBlock) && !content.includes('parallaxkey')) {
  content = content.replace(debugBlock, releaseBlock);
}

const releaseBuildTypePos = content.indexOf('release {');
if (releaseBuildTypePos !== -1) {
  const targetSig = 'signingConfig signingConfigs.debug';
  const sigPos = content.indexOf(targetSig, releaseBuildTypePos);
  if (sigPos !== -1) {
    content = content.slice(0, sigPos) + 'signingConfig signingConfigs.release' + content.slice(sigPos + targetSig.length);
  }
}

fs.writeFileSync(buildGradlePath, content, 'utf8');
console.log('build.gradle atualizado com sucesso com chave de release oficial!');
