import fs from 'node:fs';
import path from 'node:path';

const THRESHOLD = 100;
const rootDir = process.cwd();
const coverageFile = path.join(rootDir, 'coverage', 'coverage-final.json');
const useCasesDir = path.join(rootDir, 'packages', 'useCases');

function normalizeKey(key) {
  return key.replaceAll('\\', '/');
}

function walkUseCaseFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const output = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      output.push(...walkUseCaseFiles(absPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.useCase.ts')) {
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

function collectLineStats(entry) {
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

  return { covered, total };
}

function collectFunctionStats(entry) {
  const functionHits = Object.values(entry.f);
  const total = functionHits.length;
  const covered = functionHits.filter((hit) => hit > 0).length;
  return { covered, total };
}

function collectBranchStats(entry) {
  const branchHits = Object.values(entry.b).flat();
  const total = branchHits.length;
  const covered = branchHits.filter((hit) => hit > 0).length;
  return { covered, total };
}

if (!fs.existsSync(coverageFile)) {
  console.error('coverage-final.json not found. Run tests with --coverage.');
  process.exit(1);
}

const allUseCaseFiles = walkUseCaseFiles(useCasesDir);
const rawCoverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
const coverageMap = new Map(
  Object.entries(rawCoverage).map(([key, value]) => [normalizeKey(key), value])
);

const missingEntries = [];
const totals = {
  lines: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
  branches: { covered: 0, total: 0 },
};

for (const filePath of allUseCaseFiles) {
  const normalizedPath = normalizeKey(filePath);
  const entry = coverageMap.get(normalizedPath);

  if (!entry) {
    missingEntries.push(path.relative(rootDir, filePath));
    continue;
  }

  const lineStats = collectLineStats(entry);
  const functionStats = collectFunctionStats(entry);
  const branchStats = collectBranchStats(entry);

  totals.lines.covered += lineStats.covered;
  totals.lines.total += lineStats.total;
  totals.functions.covered += functionStats.covered;
  totals.functions.total += functionStats.total;
  totals.branches.covered += branchStats.covered;
  totals.branches.total += branchStats.total;
}

if (missingEntries.length > 0) {
  console.error(
    `UseCase global coverage check failed: ${missingEntries.length} file(s) missing coverage entry.`
  );
  const MAX_LINES = 200;
  for (const file of missingEntries.slice(0, MAX_LINES)) {
    console.error(`${file} | missing coverage entry`);
  }
  if (missingEntries.length > MAX_LINES) {
    console.error(`...and ${missingEntries.length - MAX_LINES} more file(s).`);
  }
  process.exit(1);
}

const lineCoverage = percent(totals.lines.covered, totals.lines.total);
const functionCoverage = percent(
  totals.functions.covered,
  totals.functions.total
);
const branchCoverage = percent(totals.branches.covered, totals.branches.total);

if (
  lineCoverage < THRESHOLD ||
  functionCoverage < THRESHOLD ||
  branchCoverage < THRESHOLD
) {
  console.error(
    `UseCase global coverage check failed. Required ${THRESHOLD}% for lines/functions/branches.`
  );
  console.error(
    `lines=${lineCoverage.toFixed(2)}% | functions=${functionCoverage.toFixed(2)}% | branches=${branchCoverage.toFixed(2)}%`
  );
  process.exit(1);
}

console.log(
  `UseCase global coverage check passed for ${allUseCaseFiles.length} files with 100% lines/functions/branches.`
);
