import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const testFilePattern = /\.(test|spec)\.[cm]?[jt]sx?$/;
const ignoredDirectories = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  'bin',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);
const allowedPrefixes = ['packages/tests/', 'apps/mobile/'];

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function collectTestFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...collectTestFiles(absolutePath));
      }
      continue;
    }

    if (entry.isFile() && testFilePattern.test(entry.name)) {
      files.push(toPosixPath(path.relative(rootDir, absolutePath)));
    }
  }

  return files;
}

const misplacedFiles = collectTestFiles(rootDir).filter(
  (filePath) => !allowedPrefixes.some((prefix) => filePath.startsWith(prefix))
);

if (misplacedFiles.length > 0) {
  console.error(
    [
      'Test files outside packages/tests are only allowed under apps/mobile:',
      ...misplacedFiles.map((filePath) => `- ${filePath}`),
    ].join('\n')
  );
  process.exit(1);
}
