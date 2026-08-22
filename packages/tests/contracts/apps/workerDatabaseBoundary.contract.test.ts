import 'reflect-metadata';

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { container } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';

interface WorkerSourceBoundary {
  dist: string;
  dockerfile: string;
  name: string;
  entry: string;
  tsconfig: string;
}

interface ModuleReference {
  node: ts.Node;
  runtime: boolean;
  specifier: string;
}

interface ImportPredecessor {
  importer: string;
  specifier: string;
}

const workspaceRoot = process.cwd();
const workerRuntimePreparationSource = fs.readFileSync(
  path.resolve(workspaceRoot, 'scripts/prepare-worker-runtime.mjs'),
  'utf8'
);
const workerSourceBoundaries: WorkerSourceBoundary[] = [
  {
    dist: 'apps/worker_baileys/dist',
    dockerfile: 'apps/worker_baileys/Dockerfile',
    name: 'worker_baileys',
    entry: 'apps/worker_baileys/src/index.ts',
    tsconfig: 'apps/worker_baileys/tsconfig.json',
  },
  {
    dist: 'apps/worker_wwebjs/dist',
    dockerfile: 'apps/worker_wwebjs/Dockerfile',
    name: 'worker_wwebjs',
    entry: 'apps/worker_wwebjs/src/index.ts',
    tsconfig: 'apps/worker_wwebjs/tsconfig.json',
  },
];
const databaseTokens = new Set(['DatabaseRo', 'DatabaseRw']);
const workerRepositoryAllowlist = new Set([
  'packages/repositories/chat/ChatQuickMessageTemplatesLister.repository.ts',
  'packages/repositories/chat/WorkerConfigForChatViewer.repository.ts',
  'packages/repositories/planEntitlement/PlanEntitlement.repository.ts',
]);
const workerDatabaseTokenAllowlist = new Set([
  'packages/plugins/workerDatabase/index.ts',
  'packages/repositories/chat/ChatQuickMessageTemplatesLister.repository.ts',
  'packages/repositories/chat/WorkerConfigForChatViewer.repository.ts',
  'packages/repositories/planEntitlement/PlanEntitlement.repository.ts',
  'packages/services/outboundWebhookEvent.service.ts',
]);
const postgresEnvironmentPattern =
  /\b(?:DATABASE_URL|PGDATABASE|PGHOST|PGPASSWORD|PGPORT|PGUSER|WORKER_DB_(?:PASSWORD|USER)|DB_(?:(?:PRIVATE|PUBLIC)_)?(?:ATLAS|DATABASE_URL|HOST_(?:RO|RW)|PORT_(?:RO|RW))|DB_(?:ATLAS|DATABASE|DATABASE_URL|HOST_(?:RO|RW)|PASSWORD|POOL_(?:ACQUIRE_TIMEOUT|IDLE_TIMEOUT|MAX|MIN)|PORT_(?:RO|RW)|SSLMODE|USER))\b/u;
const dockerDaemonCapabilityPattern =
  /(?:\/var\/run\/docker\.sock|\bDOCKER_HOST\b)/u;

function normalizedRelativePath(filePath: string): string {
  return path.relative(workspaceRoot, filePath).replaceAll(path.sep, '/');
}

function isWorkspaceFile(filePath: string): boolean {
  const relativePath = path.relative(workspaceRoot, filePath);
  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath) &&
    !relativePath.includes(`${path.sep}node_modules${path.sep}`)
  );
}

function isWorkspaceSource(filePath: string): boolean {
  return isWorkspaceFile(filePath) && !filePath.endsWith('.d.ts');
}

function importDeclarationIsRuntime(node: ts.ImportDeclaration): boolean {
  const importClause = node.importClause;
  if (!importClause) return true;
  if (importClause.isTypeOnly) return false;
  if (importClause.name) return true;
  if (!importClause.namedBindings) return true;
  if (ts.isNamespaceImport(importClause.namedBindings)) return true;
  return importClause.namedBindings.elements.some(
    (element) => !element.isTypeOnly
  );
}

function exportDeclarationIsRuntime(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) {
    return true;
  }
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function callExpressionModuleSpecifier(node: ts.CallExpression): string | null {
  const argument = node.arguments[0];
  if (!argument || !ts.isStringLiteralLike(argument)) return null;
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire =
    ts.isIdentifier(node.expression) && node.expression.text === 'require';
  return isDynamicImport || isRequire ? argument.text : null;
}

function collectModuleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
        node,
        runtime: importDeclarationIsRuntime(node),
        specifier: node.moduleSpecifier.text,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
        node,
        runtime: exportDeclarationIsRuntime(node),
        specifier: node.moduleSpecifier.text,
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      references.push({
        node,
        runtime: !node.isTypeOnly,
        specifier: node.moduleReference.expression.text,
      });
    } else if (ts.isCallExpression(node)) {
      const specifier = callExpressionModuleSpecifier(node);
      if (specifier) {
        references.push({ node, runtime: true, specifier });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function isForbiddenLocalPath(filePath: string): boolean {
  const relativePath = normalizedRelativePath(filePath);
  return (
    (relativePath.startsWith('packages/repositories/') &&
      !workerRepositoryAllowlist.has(relativePath)) ||
    relativePath.startsWith('packages/config/database/') ||
    relativePath === 'packages/config/environments/DatabaseEnvironment.ts' ||
    relativePath === 'packages/config/environments/index.ts'
  );
}

function forbiddenSpecifierReason(specifier: string): string | null {
  if (
    specifier === '@core/repositories' ||
    specifier.startsWith('@core/repositories/')
  ) {
    const relativePath = specifier
      .replace(/^@core\//u, 'packages/')
      .replace(/\.repository$/u, '.repository.ts');
    if (workerRepositoryAllowlist.has(relativePath)) {
      return null;
    }
    return `repository import "${specifier}"`;
  }
  if (
    specifier === '@core/config/database' ||
    specifier.startsWith('@core/config/database/')
  ) {
    return `database connector import "${specifier}"`;
  }
  if (specifier === 'dockerode' || specifier.startsWith('dockerode/')) {
    return `Docker daemon client import "${specifier}"`;
  }
  return null;
}

function firstDatabaseToken(
  sourceFile: ts.SourceFile
): { line: number; token: string } | null {
  let match: { line: number; token: string } | null = null;
  const visit = (node: ts.Node): void => {
    if (match) return;
    const token =
      ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : null;
    if (token && databaseTokens.has(token)) {
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile)
      );
      match = { line: position.line + 1, token };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return match;
}

function firstPostgresEnvironment(
  sourceFile: ts.SourceFile
): { line: number; name: string } | null {
  const match = postgresEnvironmentPattern.exec(sourceFile.getFullText());
  if (!match || match.index === undefined) return null;
  const position = sourceFile.getLineAndCharacterOfPosition(match.index);
  return { line: position.line + 1, name: match[0] };
}

function firstDockerDaemonCapability(
  sourceFile: ts.SourceFile
): { line: number; name: string } | null {
  const match = dockerDaemonCapabilityPattern.exec(sourceFile.getFullText());
  if (!match || match.index === undefined) return null;
  const position = sourceFile.getLineAndCharacterOfPosition(match.index);
  return { line: position.line + 1, name: match[0] };
}

function formatImportChain(
  target: string,
  predecessors: ReadonlyMap<string, ImportPredecessor>
): string {
  const chain = [normalizedRelativePath(target)];
  const visited = new Set<string>([target]);
  let current = target;
  while (predecessors.has(current)) {
    const predecessor = predecessors.get(current);
    if (!predecessor || visited.has(predecessor.importer)) break;
    chain.push(normalizedRelativePath(predecessor.importer));
    visited.add(predecessor.importer);
    current = predecessor.importer;
  }
  return chain.reverse().join(' -> ');
}

function parseWorkerTsconfig(tsconfigPath: string): ts.ParsedCommandLine {
  const configResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configResult.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(configResult.error.messageText, '\n')
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    configResult.config,
    ts.sys,
    path.dirname(tsconfigPath)
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, '\n')
        )
        .join('\n')
    );
  }
  return parsed;
}

function parseWorkerCompilerOptions(tsconfigPath: string): ts.CompilerOptions {
  return parseWorkerTsconfig(tsconfigPath).options;
}

function sourceLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function addViolation(
  violations: Set<string>,
  worker: WorkerSourceBoundary,
  chain: string,
  reason: string
): void {
  violations.add(`[${worker.name}] ${reason}\n  ${chain}`);
}

function inspectModuleReferences(
  worker: WorkerSourceBoundary,
  sourceFile: ts.SourceFile,
  currentFile: string,
  references: readonly ModuleReference[],
  violations: Set<string>
): void {
  for (const reference of references) {
    const reason = forbiddenSpecifierReason(reference.specifier);
    if (!reason) continue;
    addViolation(
      violations,
      worker,
      `${normalizedRelativePath(currentFile)}:${sourceLine(
        sourceFile,
        reference.node
      )} -> ${reference.specifier}`,
      reason
    );
  }
}

function resolveRuntimeReferences(
  references: readonly ModuleReference[],
  currentFile: string,
  compilerOptions: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
  cache: ts.ModuleResolutionCache,
  queue: string[],
  predecessors: Map<string, ImportPredecessor>
): void {
  for (const reference of references) {
    if (!reference.runtime || forbiddenSpecifierReason(reference.specifier)) {
      continue;
    }
    const resolved = ts.resolveModuleName(
      reference.specifier,
      currentFile,
      compilerOptions,
      host,
      cache
    ).resolvedModule?.resolvedFileName;
    if (!resolved) continue;
    const resolvedPath = path.resolve(resolved);
    if (!isWorkspaceSource(resolvedPath)) continue;
    if (!predecessors.has(resolvedPath)) {
      predecessors.set(resolvedPath, {
        importer: currentFile,
        specifier: reference.specifier,
      });
    }
    queue.push(resolvedPath);
  }
}

function findWorkerDatabaseBoundaryViolations(
  worker: WorkerSourceBoundary
): string[] {
  const tsconfigPath = path.resolve(workspaceRoot, worker.tsconfig);
  const compilerOptions = parseWorkerCompilerOptions(tsconfigPath);
  const host = ts.createCompilerHost(compilerOptions);
  const cache = ts.createModuleResolutionCache(
    workspaceRoot,
    (fileName) => fileName,
    compilerOptions
  );
  const entry = path.resolve(workspaceRoot, worker.entry);
  const queue = [entry];
  const visited = new Set<string>();
  const predecessors = new Map<string, ImportPredecessor>();
  const violations = new Set<string>();

  while (queue.length > 0) {
    const currentFile = queue.shift();
    if (!currentFile || visited.has(currentFile)) continue;
    visited.add(currentFile);
    const chain = formatImportChain(currentFile, predecessors);
    if (isForbiddenLocalPath(currentFile)) {
      addViolation(
        violations,
        worker,
        chain,
        `forbidden persistence module "${normalizedRelativePath(currentFile)}"`
      );
      continue;
    }
    const source = fs.readFileSync(currentFile, 'utf8');
    const sourceFile = ts.createSourceFile(
      currentFile,
      source,
      ts.ScriptTarget.Latest,
      true
    );
    const databaseToken = workerDatabaseTokenAllowlist.has(
      normalizedRelativePath(currentFile)
    )
      ? null
      : firstDatabaseToken(sourceFile);
    if (databaseToken) {
      addViolation(
        violations,
        worker,
        `${chain}:${databaseToken.line}`,
        `database token "${databaseToken.token}"`
      );
    }
    const postgresEnvironment = firstPostgresEnvironment(sourceFile);
    if (postgresEnvironment) {
      addViolation(
        violations,
        worker,
        `${chain}:${postgresEnvironment.line}`,
        `PostgreSQL environment "${postgresEnvironment.name}"`
      );
    }
    const dockerDaemonCapability = firstDockerDaemonCapability(sourceFile);
    if (dockerDaemonCapability) {
      addViolation(
        violations,
        worker,
        `${chain}:${dockerDaemonCapability.line}`,
        `Docker daemon capability "${dockerDaemonCapability.name}"`
      );
    }
    const references = collectModuleReferences(sourceFile);
    inspectModuleReferences(
      worker,
      sourceFile,
      currentFile,
      references,
      violations
    );
    resolveRuntimeReferences(
      references,
      currentFile,
      compilerOptions,
      host,
      cache,
      queue,
      predecessors
    );
  }

  return [...violations].sort();
}

function findWorkerProgramBoundaryViolations(
  worker: WorkerSourceBoundary
): string[] {
  const tsconfigPath = path.resolve(workspaceRoot, worker.tsconfig);
  const parsed = parseWorkerTsconfig(tsconfigPath);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  const violations = new Set<string>();

  for (const sourceFile of program.getSourceFiles()) {
    if (!isWorkspaceFile(sourceFile.fileName)) continue;
    const relativePath = normalizedRelativePath(sourceFile.fileName);
    if (isForbiddenLocalPath(sourceFile.fileName)) {
      addViolation(
        violations,
        worker,
        relativePath,
        `forbidden persistence module "${relativePath}"`
      );
    }
    const databaseToken = workerDatabaseTokenAllowlist.has(relativePath)
      ? null
      : firstDatabaseToken(sourceFile);
    if (databaseToken) {
      addViolation(
        violations,
        worker,
        `${relativePath}:${databaseToken.line}`,
        `database token "${databaseToken.token}"`
      );
    }
    const postgresEnvironment = firstPostgresEnvironment(sourceFile);
    if (postgresEnvironment) {
      addViolation(
        violations,
        worker,
        `${relativePath}:${postgresEnvironment.line}`,
        `PostgreSQL environment "${postgresEnvironment.name}"`
      );
    }
    const dockerDaemonCapability = firstDockerDaemonCapability(sourceFile);
    if (dockerDaemonCapability) {
      addViolation(
        violations,
        worker,
        `${relativePath}:${dockerDaemonCapability.line}`,
        `Docker daemon capability "${dockerDaemonCapability.name}"`
      );
    }
    inspectModuleReferences(
      worker,
      sourceFile,
      sourceFile.fileName,
      collectModuleReferences(sourceFile),
      violations
    );
  }

  return [...violations].sort();
}

function explicitTsconfigSources(relativeTsconfigPath: string): string[] {
  const tsconfigPath = path.resolve(workspaceRoot, relativeTsconfigPath);
  const result = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (result.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(result.error.messageText, '\n')
    );
  }
  const config = result.config as {
    files?: unknown[];
    include?: unknown[];
  };
  return [...(config.files ?? []), ...(config.include ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replaceAll('\\', '/'));
}

function listProductionGoFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listProductionGoFiles(filePath);
    if (!entry.isFile() || !entry.name.endsWith('.go')) return [];
    return entry.name.endsWith('_test.go') ? [] : [filePath];
  });
}

const whatsmeowForbiddenPatterns: ReadonlyArray<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: 'UnderChat PostgreSQL endpoint environment',
    pattern:
      /\bDB_(?:(?:PUBLIC|PRIVATE)_)?(?:HOST_(?:RO|RW)|PORT_(?:RO|RW)|DATABASE_URL|ATLAS)\b/u,
  },
  {
    label: 'UnderChat PostgreSQL credential environment',
    pattern: /\bDB_(?:USER|PASSWORD|DATABASE)\b/u,
  },
  {
    label: 'PostgreSQL process environment',
    pattern: /\b(?:DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)\b/u,
  },
  {
    label: 'PostgreSQL connection URL',
    pattern: /\bpostgres(?:ql)?:\/\//iu,
  },
  {
    label: 'non-PostgreSQL remote SQL/ORM driver',
    pattern:
      /github\.com\/go-sql-driver\/mysql|gorm\.io\/|go\.mongodb\.org\/mongo-driver/u,
  },
  {
    label: 'UnderChat repository layer',
    pattern: /(?:@core|packages)\/repositories\//u,
  },
  {
    label: 'Docker daemon socket or environment',
    pattern: /(?:\/var\/run\/docker\.sock|\bDOCKER_HOST\b)/u,
  },
  {
    label: 'Docker daemon client',
    pattern: /github\.com\/docker\/docker\/client/u,
  },
];

function firstPatternLine(source: string, pattern: RegExp): number {
  const match = pattern.exec(source);
  if (!match || match.index === undefined) return 0;
  return source.slice(0, match.index).split('\n').length;
}

function findWhatsmeowDatabaseBoundaryViolations(): string[] {
  const root = path.resolve(workspaceRoot, 'apps/worker_whatsmeow');
  const files = [
    path.join(root, 'go.mod'),
    ...listProductionGoFiles(path.join(root, 'cmd', 'worker')),
    ...listProductionGoFiles(path.join(root, 'internal', 'app')),
  ];
  const violations: string[] = [];
  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const forbidden of whatsmeowForbiddenPatterns) {
      const line = firstPatternLine(source, forbidden.pattern);
      if (line === 0) continue;
      violations.push(
        `[worker_whatsmeow] ${forbidden.label}\n  ${normalizedRelativePath(
          filePath
        )}:${line}`
      );
    }
  }
  return violations.sort();
}

describe('worker database architecture boundary', () => {
  it.each(workerSourceBoundaries)(
    '$name runtime graph permits only the direct chat persistence allowlist',
    (worker) => {
      const violations = findWorkerDatabaseBoundaryViolations(worker);
      expect(violations).toEqual([]);
    }
  );

  it('keeps the compiled repository allowlist identical to the source boundary', () => {
    for (const repositorySource of workerRepositoryAllowlist) {
      const compiledBase = `/${repositorySource
        .replace(/\.ts$/u, '')
        .replace(/^packages\//u, 'packages/')}`;
      expect(workerRuntimePreparationSource).toContain(`${compiledBase}.js`);
      expect(workerRuntimePreparationSource).toContain(`${compiledBase}.d.ts`);
    }
    expect(workerRuntimePreparationSource).toContain(
      "relativePath.startsWith(\n      '/packages/repositories/'"
    );
    expect(workerRuntimePreparationSource).toContain(
      'isRepositoryArtifact && !repositoryArtifactAllowed'
    );
  });

  it.each(workerSourceBoundaries)(
    '$name complete TypeScript program stays inside the direct persistence allowlist',
    (worker) => {
      const violations = findWorkerProgramBoundaryViolations(worker);
      expect(violations).toEqual([]);
    }
  );

  it.each(workerSourceBoundaries)(
    '$name tsconfig excludes the Balance-only gRPC server',
    (worker) => {
      const sources = explicitTsconfigSources(worker.tsconfig);
      expect(sources).toContain(
        '../../packages/plugins/proto/workerConnectionGrpcServer.ts'
      );
      expect(sources).not.toContain(
        '../../packages/plugins/proto/workerGrpcServer.ts'
      );
    }
  );

  it.each(workerSourceBoundaries)(
    '$name Docker build strips migration/control-plane database packages and asserts its compiled artifact',
    (worker) => {
      const dockerfile = fs.readFileSync(
        path.resolve(workspaceRoot, worker.dockerfile),
        'utf8'
      );
      const boundaryCommand = 'RUN node scripts/prepare-worker-runtime.mjs';
      const commandPosition = dockerfile.indexOf(boundaryCommand);
      const runtimeStagePosition = dockerfile.indexOf(
        '\nFROM ',
        commandPosition
      );

      expect(commandPosition).toBeGreaterThan(-1);
      expect(dockerfile.slice(commandPosition, runtimeStagePosition)).toContain(
        `--dist ${worker.dist}`
      );
      expect(dockerfile.slice(commandPosition, runtimeStagePosition)).toContain(
        '--node-modules node_modules'
      );
      expect(runtimeStagePosition).toBeGreaterThan(commandPosition);
    }
  );

  it('Whatsmeow allows lib/pq but no control-plane database environment or repository dependency', () => {
    expect(findWhatsmeowDatabaseBoundaryViolations()).toEqual([]);
  });

  it('resolves the global Kafka catalog without database registrations', () => {
    const child = container.createChildContainer();

    expect(child.isRegistered('DatabaseRo')).toBe(false);
    expect(child.isRegistered('DatabaseRw')).toBe(false);
    expect(child.resolve(KafkaServiceQueueService)).toBeInstanceOf(
      KafkaServiceQueueService
    );
    expect(child.isRegistered('DatabaseRo')).toBe(false);
    expect(child.isRegistered('DatabaseRw')).toBe(false);
  });
});
