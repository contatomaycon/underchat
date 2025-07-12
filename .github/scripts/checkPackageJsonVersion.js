const fs = require('fs');
const path = require('path');

function checkPackageJsonVersion(patch) {
  const packageJsonPath = path.join(patch, 'package.json');

  try {
    const data = fs.readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(data);

    if (packageJson.version) {
      return packageJson.version;
    }

    return null;
  } catch (error) {
    console.error('Erro ao ler o package.json:', error);

    return null;
  }
}

function updatePackageJsonVersion(patchUpdate, newVersion) {
  const packageJsonPathUpdate = path.join(patchUpdate, 'package.json');

  try {
    const data = fs.readFileSync(packageJsonPathUpdate, 'utf8');
    const packageJson = JSON.parse(data);

    packageJson.version = newVersion;

    fs.writeFileSync(
      packageJsonPathUpdate,
      JSON.stringify(packageJson, null, 2),
      'utf8'
    );

    console.log(`Versão atualizada com sucesso para ${newVersion}`);
  } catch (error) {
    console.error('Erro ao atualizar o package.json:', error);
  }
}

const patch = process.argv[2];
const version = checkPackageJsonVersion(patch);

if (version) {
  const patchUpdate = process.argv[3];

  updatePackageJsonVersion(patchUpdate, version);
}
