import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import kafkaAdminBoundary from './worker-runtime-kafka-boundary.cjs';

const { findKafkaAdminArtifactViolations } = kafkaAdminBoundary;

const forbiddenPackageNames = new Set([
  '@electric-sql/pglite',
  '@libsql/client',
  '@neondatabase/serverless',
  '@prisma/client',
  '@vercel/postgres',
  'better-sqlite3',
  'bookshelf',
  'drizzle-kit',
  'knex',
  'kysely',
  'libsql',
  'mariadb',
  'mikro-orm',
  'mssql',
  'mysql',
  'mysql2',
  'objection',
  'oracledb',
  'prisma',
  'sequelize',
  'sequelize-cli',
  'slonik',
  'sql.js',
  'sqlite3',
  'tedious',
  'typeorm',
]);
const forbiddenPackagePrefixes = [
  '@libsql/',
  '@mikro-orm/',
  '@prisma/',
  '@sequelize/',
];
const forbiddenDistPathFragments = [
  '/packages/config/database/',
  '/packages/config/environments/DatabaseEnvironment.',
];
const allowedRepositoryArtifactPaths = new Set([
  '/packages/repositories/chat/ChatQuickMessageTemplatesLister.repository.d.ts',
  '/packages/repositories/chat/ChatQuickMessageTemplatesLister.repository.js',
  '/packages/repositories/chat/WorkerConfigForChatViewer.repository.d.ts',
  '/packages/repositories/chat/WorkerConfigForChatViewer.repository.js',
  '/packages/repositories/planEntitlement/PlanEntitlement.repository.d.ts',
  '/packages/repositories/planEntitlement/PlanEntitlement.repository.js',
]);
const allowedRepositoryArtifactDirectories = new Set([
  '/packages/repositories/',
  '/packages/repositories/chat/',
  '/packages/repositories/planEntitlement/',
]);
const forbiddenDistModulePattern =
  /["'](?:@core\/config\/database|@core\/repositories(?:\/|["'])|better-sqlite3(?:\/|["'])|drizzle-kit(?:\/|["'])|knex(?:\/|["'])|mariadb(?:\/|["'])|mysql2?(?:\/|["'])|oracledb(?:\/|["'])|sequelize(?:\/|["'])|sqlite3(?:\/|["'])|tedious(?:\/|["'])|typeorm(?:\/|["']))/u;

function fail(message) {
  throw new Error(`[worker-database-boundary] ${message}`);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) {
      fail(
        'usage: prepare-worker-runtime.mjs --dist <dist> --node-modules <node_modules>'
      );
    }
    values.set(key, value);
  }
  return {
    dist: values.get('--dist'),
    nodeModules: values.get('--node-modules'),
  };
}

function resolveRequiredDirectory(value, label, expectedBasename) {
  if (!value) fail(`${label} was not provided`);
  const resolved = path.resolve(value);
  if (path.basename(resolved) !== expectedBasename) {
    fail(`${label} must end in "${expectedBasename}": ${resolved}`);
  }
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`${label} does not exist: ${resolved}`);
  }
  return resolved;
}

function isForbiddenPackageName(packageName) {
  return (
    forbiddenPackageNames.has(packageName) ||
    forbiddenPackagePrefixes.some((prefix) => packageName.startsWith(prefix))
  );
}

function packageName(directory) {
  const manifestPath = path.join(directory, 'package.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return typeof manifest.name === 'string' ? manifest.name : null;
  } catch {
    return null;
  }
}

function isForbiddenPnpmStoreDirectory(directory) {
  if (path.basename(path.dirname(directory)) !== '.pnpm') return false;
  const encodedName = path.basename(directory);
  return (
    /^(?:@[^+]+\+)?(?:drizzle-kit|prisma@)/u.test(encodedName) ||
    /^(?:better-sqlite3|knex|kysely|mariadb|mysql2?|sequelize|sqlite3|tedious|typeorm)@/u.test(
      encodedName
    )
  );
}

function stripForbiddenPackages(directory, removed) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const detectedPackageName = packageName(entryPath);
    const forbiddenBrokenLink =
      entry.isSymbolicLink() && isForbiddenPackageName(entry.name);
    if (
      (detectedPackageName && isForbiddenPackageName(detectedPackageName)) ||
      forbiddenBrokenLink ||
      isForbiddenPnpmStoreDirectory(entryPath)
    ) {
      removed.add(detectedPackageName ?? entry.name);
      fs.rmSync(entryPath, { force: true, recursive: true });
      continue;
    }
    if (entry.isDirectory()) {
      stripForbiddenPackages(entryPath, removed);
    }
  }
}

function collectForbiddenPackages(directory, violations) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const detectedPackageName = packageName(entryPath);
    const forbiddenBrokenLink =
      entry.isSymbolicLink() && isForbiddenPackageName(entry.name);
    if (
      (detectedPackageName && isForbiddenPackageName(detectedPackageName)) ||
      forbiddenBrokenLink ||
      isForbiddenPnpmStoreDirectory(entryPath)
    ) {
      violations.add(`${detectedPackageName ?? entry.name} at ${entryPath}`);
      continue;
    }
    if (entry.isDirectory()) {
      collectForbiddenPackages(entryPath, violations);
    }
  }
}

function inspectDist(directory, root, violations) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = `/${path
      .relative(root, entryPath)
      .split(path.sep)
      .join('/')}${entry.isDirectory() ? '/' : ''}`;
    const isRepositoryArtifact = relativePath.startsWith(
      '/packages/repositories/'
    );
    const repositoryArtifactAllowed = entry.isDirectory()
      ? allowedRepositoryArtifactDirectories.has(relativePath)
      : allowedRepositoryArtifactPaths.has(relativePath);
    if (
      (isRepositoryArtifact && !repositoryArtifactAllowed) ||
      forbiddenDistPathFragments.some((fragment) =>
        relativePath.includes(fragment)
      )
    ) {
      violations.add(`forbidden compiled artifact ${relativePath}`);
    }
    for (const violation of findKafkaAdminArtifactViolations(relativePath)) {
      violations.add(violation);
    }
    if (entry.isDirectory()) {
      inspectDist(entryPath, root, violations);
      continue;
    }
    if (!entry.isFile() || !/\.(?:cjs|d\.ts|js|mjs)$/u.test(entry.name)) {
      continue;
    }

    const source = fs.readFileSync(entryPath, 'utf8');
    if (forbiddenDistModulePattern.test(source)) {
      violations.add(`forbidden database module reference ${relativePath}`);
    }
    for (const violation of findKafkaAdminArtifactViolations(
      relativePath,
      source
    )) {
      violations.add(violation);
    }
  }
}

export function prepareWorkerRuntime(input) {
  const dist = resolveRequiredDirectory(input.dist, 'dist', 'dist');
  const nodeModules = resolveRequiredDirectory(
    input.nodeModules,
    'node_modules',
    'node_modules'
  );
  const removed = new Set();
  stripForbiddenPackages(nodeModules, removed);

  const violations = new Set();
  collectForbiddenPackages(nodeModules, violations);
  inspectDist(dist, dist, violations);
  if (violations.size > 0) {
    fail([...violations].sort().join('\n'));
  }

  return { removedPackageFamilies: removed.size };
}

function runCli() {
  const args = parseArguments(process.argv.slice(2));
  const result = prepareWorkerRuntime(args);
  console.log(
    `[worker-database-boundary] clean; removed ${result.removedPackageFamilies} forbidden package families`
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli();
}
