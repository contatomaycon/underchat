const fs = require('fs');

function checkKeyConsistency(baseFilePath, comparisonFilePath) {
  const baseFilePathIdentity = baseFilePath.split('/').slice(-2).join('/');
  const comparisonFilePathIdentity = comparisonFilePath
    .split('/')
    .slice(-2)
    .join('/');

  const baseFileContent = JSON.parse(fs.readFileSync(baseFilePath, 'utf8'));
  const comparisonFileContent = JSON.parse(
    fs.readFileSync(comparisonFilePath, 'utf8')
  );

  const baseKeys = new Set(Object.keys(baseFileContent));
  const comparisonKeys = new Set(Object.keys(comparisonFileContent));

  let missingKeys = [];
  baseKeys.forEach((key) => {
    if (!comparisonKeys.has(key)) {
      missingKeys.push(key);
    }
  });

  if (missingKeys.length > 0) {
    console.error(
      `Missing keys in ${comparisonFilePathIdentity}: ${missingKeys.join(', ')}`
    );

    process.exit(1);
  } else {
    console.log(
      `All keys in ${baseFilePathIdentity} are present in ${comparisonFilePathIdentity}.`
    );
  }
}

const englishJson = 'packages/core/plugins/i18next/locales/en/translation.json';
const portugueseJson =
  'packages/core/plugins/i18next/locales/pt/translation.json';

checkKeyConsistency(englishJson, portugueseJson);
checkKeyConsistency(portugueseJson, englishJson);
