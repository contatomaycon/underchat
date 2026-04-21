import fs from 'node:fs';
import path from 'node:path';

const THRESHOLD = 90;
const rootDir = process.cwd();
const coverageFile = path.join(rootDir, 'coverage', 'coverage-final.json');
const targetDirs = [
  path.join(rootDir, 'packages', 'repositories'),
  path.join(rootDir, 'packages', 'services'),
];

function walkTsFiles(dir) {
  const output = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      output.push(...walkTsFiles(absPath));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      output.push(absPath);
    }
  }

  return output;
}

function percent(covered, total) {
  if (total === 0) {
    return 100;
  }
  return (covered / total) * 100;
}

function calculateLineCoverage(entry) {
  const lines = new Map();
  for (const [statementId, statementInfo] of Object.entries(
    entry.statementMap
  )) {
    const line = statementInfo.start.line;
    const hits = entry.s[statementId] ?? 0;
    const current = lines.get(line) ?? 0;
    lines.set(line, Math.max(current, hits));
  }

  const total = lines.size;
  let covered = 0;
  for (const hits of lines.values()) {
    if (hits > 0) {
      covered += 1;
    }
  }

  return percent(covered, total);
}

function calculateFunctionCoverage(entry) {
  const functionHits = Object.values(entry.f);
  const total = functionHits.length;
  const covered = functionHits.filter((hit) => hit > 0).length;
  return percent(covered, total);
}

function calculateBranchCoverage(entry) {
  const branchHits = Object.values(entry.b).flat();
  const total = branchHits.length;
  const covered = branchHits.filter((hit) => hit > 0).length;
  return percent(covered, total);
}

function normalizeKey(key) {
  return key.replaceAll('\\', '/');
}

if (!fs.existsSync(coverageFile)) {
  console.error('coverage-final.json not found. Run tests with --coverage.');
  process.exit(1);
}

const rawCoverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
const coverageMap = new Map(
  Object.entries(rawCoverage).map(([key, value]) => [normalizeKey(key), value])
);

const targetFiles = targetDirs.flatMap((dir) => walkTsFiles(dir));
const failures = [];

for (const filePath of targetFiles) {
  const normalized = normalizeKey(filePath);
  const entry = coverageMap.get(normalized);

  if (!entry) {
    failures.push({
      file: path.relative(rootDir, filePath),
      lines: 0,
      functions: 0,
      branches: 0,
      reason: 'missing coverage entry',
    });
    continue;
  }

  const lines = calculateLineCoverage(entry);
  const functions = calculateFunctionCoverage(entry);
  const branches = calculateBranchCoverage(entry);

  if (lines < THRESHOLD || functions < THRESHOLD || branches < THRESHOLD) {
    failures.push({
      file: path.relative(rootDir, filePath),
      lines,
      functions,
      branches,
      reason: 'below threshold',
    });
  }
}

if (failures.length > 0) {
  console.error(
    `Per-file coverage check failed for ${failures.length} file(s). Threshold: ${THRESHOLD}% for lines/functions/branches.`
  );
  const MAX_FAILURE_LINES = 200;
  for (const failure of failures.slice(0, MAX_FAILURE_LINES)) {
    console.error(
      `${failure.file} | lines=${failure.lines.toFixed(2)}% | functions=${failure.functions.toFixed(2)}% | branches=${failure.branches.toFixed(2)}% | ${failure.reason}`
    );
  }
  if (failures.length > MAX_FAILURE_LINES) {
    console.error(
      `...and ${failures.length - MAX_FAILURE_LINES} more file(s) below threshold.`
    );
  }
  process.exit(1);
}

console.log(
  `Per-file coverage check passed for ${targetFiles.length} file(s) with threshold ${THRESHOLD}%.`
);
