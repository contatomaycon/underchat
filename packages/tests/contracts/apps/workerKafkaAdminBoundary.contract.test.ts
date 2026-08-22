import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { recoverKafkaTopicForProduce as recoverWorkerKafkaTopicForProduce } from '@core/common/functions/workerKafkaTopicRecoveryPolicy';

interface TypeScriptWorkerBoundary {
  entry: string;
  name: string;
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

interface BoundaryAudit {
  sources: string[];
  violations: string[];
}

const workspaceRoot = process.cwd();
const typeScriptWorkers: TypeScriptWorkerBoundary[] = [
  {
    entry: 'apps/worker_baileys/src/index.ts',
    name: 'worker_baileys',
    tsconfig: 'apps/worker_baileys/tsconfig.json',
  },
  {
    entry: 'apps/worker_wwebjs/src/index.ts',
    name: 'worker_wwebjs',
    tsconfig: 'apps/worker_wwebjs/tsconfig.json',
  },
];
const forbiddenWorkspaceModules = new Set([
  'packages/common/functions/ensureKafkaTopic.ts',
  'packages/common/functions/kafkaAdminConfig.ts',
  'packages/common/functions/kafkaTopicRecoveryPolicy.ts',
  'packages/common/functions/serviceApiKafkaCutoverBarrier.ts',
  'packages/services/kafka.service.ts',
  'packages/services/workerKafkaTopicAdmin.service.ts',
  'packages/services/workerKafkaTopicLifecycle.service.ts',
]);
const forbiddenKafkaAdminIdentifiers = new Set([
  'AdminClient',
  'KafkaAdminLike',
  'KafkaService',
  'WorkerKafkaTopicAdminService',
  'WorkerKafkaTopicLifecycleService',
  'buildNodeKafkaAdminConfig',
  'buildRdKafkaAdminConfig',
  'createAdminClient',
  'createKafkaAdmin',
  'ensureAuthorizedWorkerKafkaTopic',
  'ensureKafkaTopic',
]);
const forbiddenKafkaAdminMemberCalls = new Set([
  'admin',
  'alterConfigs',
  'createPartitions',
  'createTopics',
  'deleteGroups',
  'deleteTopics',
  'incrementalAlterConfigs',
]);
const forbiddenGoAdminPatterns: ReadonlyArray<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: 'Kafka admin-only package import',
    pattern:
      /"(?:github\.com\/twmb\/franz-go\/pkg\/kadm|github\.com\/confluentinc\/confluent-kafka-go\/kafka\/admin)"/u,
  },
  {
    label: 'Kafka admin client',
    pattern: /\b(?:AdminClient|NewAdminClient|NewClusterAdmin)\b/u,
  },
  {
    label: 'Kafka controller discovery',
    pattern: /\.\s*Controller\s*\(/u,
  },
  {
    label: 'Kafka administrative mutation',
    pattern:
      /\.\s*(?:AlterConfigs|CreatePartitions|CreateTopics|DeleteGroups|DeleteTopics|IncrementalAlterConfigs)\s*\(/u,
  },
];

function normalizedRelativePath(filePath: string): string {
  return path.relative(workspaceRoot, filePath).replaceAll(path.sep, '/');
}

function isWorkspaceSource(filePath: string): boolean {
  const relativePath = path.relative(workspaceRoot, filePath);
  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath) &&
    !relativePath.includes(`${path.sep}node_modules${path.sep}`) &&
    !filePath.endsWith('.d.ts')
  );
}

function importDeclarationIsRuntime(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name || !clause.namedBindings) return true;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportDeclarationIsRuntime(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) {
    return true;
  }
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function dynamicModuleSpecifier(node: ts.CallExpression): string | null {
  const firstArgument = node.arguments[0];
  if (!firstArgument || !ts.isStringLiteralLike(firstArgument)) return null;
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire =
    ts.isIdentifier(node.expression) && node.expression.text === 'require';
  return isDynamicImport || isRequire ? firstArgument.text : null;
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
      const specifier = dynamicModuleSpecifier(node);
      if (specifier) {
        references.push({ node, runtime: true, specifier });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
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

function sourceLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
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

function forbiddenIdentifierViolation(
  sourceFile: ts.SourceFile
): string | null {
  let violation: string | null = null;
  const visit = (node: ts.Node): void => {
    if (violation) return;
    if (
      ts.isIdentifier(node) &&
      forbiddenKafkaAdminIdentifiers.has(node.text)
    ) {
      violation = `Kafka admin symbol "${node.text}" at line ${sourceLine(
        sourceFile,
        node
      )}`;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violation;
}

function forbiddenMemberCallViolation(
  sourceFile: ts.SourceFile
): string | null {
  let violation: string | null = null;
  const visit = (node: ts.Node): void => {
    if (violation) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      forbiddenKafkaAdminMemberCalls.has(node.expression.name.text)
    ) {
      violation = `Kafka admin method "${node.expression.name.text}" at line ${sourceLine(
        sourceFile,
        node
      )}`;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violation;
}

function inspectTypeScriptSource(
  currentFile: string,
  sourceFile: ts.SourceFile,
  predecessors: ReadonlyMap<string, ImportPredecessor>
): string[] {
  const relativePath = normalizedRelativePath(currentFile);
  const chain = formatImportChain(currentFile, predecessors);
  const violations: string[] = [];
  if (forbiddenWorkspaceModules.has(relativePath)) {
    violations.push(`forbidden Kafka admin module\n  ${chain}`);
  }
  const identifierViolation = forbiddenIdentifierViolation(sourceFile);
  if (identifierViolation) {
    violations.push(`${identifierViolation}\n  ${chain}`);
  }
  const memberViolation = forbiddenMemberCallViolation(sourceFile);
  if (memberViolation) {
    violations.push(`${memberViolation}\n  ${chain}`);
  }
  return violations;
}

function enqueueRuntimeReferences(input: {
  cache: ts.ModuleResolutionCache;
  compilerOptions: ts.CompilerOptions;
  currentFile: string;
  host: ts.ModuleResolutionHost;
  predecessors: Map<string, ImportPredecessor>;
  queue: string[];
  references: readonly ModuleReference[];
}): void {
  for (const reference of input.references) {
    if (!reference.runtime) continue;
    const resolved = ts.resolveModuleName(
      reference.specifier,
      input.currentFile,
      input.compilerOptions,
      input.host,
      input.cache
    ).resolvedModule?.resolvedFileName;
    if (!resolved) continue;
    const resolvedPath = path.resolve(resolved);
    if (!isWorkspaceSource(resolvedPath)) continue;
    if (!input.predecessors.has(resolvedPath)) {
      input.predecessors.set(resolvedPath, {
        importer: input.currentFile,
        specifier: reference.specifier,
      });
    }
    input.queue.push(resolvedPath);
  }
}

function auditTypeScriptWorker(
  worker: TypeScriptWorkerBoundary
): BoundaryAudit {
  const tsconfigPath = path.resolve(workspaceRoot, worker.tsconfig);
  const compilerOptions = parseWorkerTsconfig(tsconfigPath).options;
  const host = ts.createCompilerHost(compilerOptions);
  const cache = ts.createModuleResolutionCache(
    workspaceRoot,
    (fileName) => fileName,
    compilerOptions
  );
  const queue = [path.resolve(workspaceRoot, worker.entry)];
  const predecessors = new Map<string, ImportPredecessor>();
  const visited = new Set<string>();
  const violations = new Set<string>();

  while (queue.length > 0) {
    const currentFile = queue.shift();
    if (
      !currentFile ||
      visited.has(currentFile) ||
      !isWorkspaceSource(currentFile)
    ) {
      continue;
    }
    visited.add(currentFile);
    const sourceFile = ts.createSourceFile(
      currentFile,
      fs.readFileSync(currentFile, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    inspectTypeScriptSource(currentFile, sourceFile, predecessors).forEach(
      (violation) => violations.add(`[${worker.name}] ${violation}`)
    );
    enqueueRuntimeReferences({
      cache,
      compilerOptions,
      currentFile,
      host,
      predecessors,
      queue,
      references: collectModuleReferences(sourceFile),
    });
  }

  return {
    sources: [...visited].map(normalizedRelativePath).sort(),
    violations: [...violations].sort(),
  };
}

function listProductionGoFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listProductionGoFiles(filePath);
    if (
      !entry.isFile() ||
      !entry.name.endsWith('.go') ||
      entry.name.endsWith('_test.go')
    ) {
      return [];
    }
    return [filePath];
  });
}

function firstPatternLine(source: string, pattern: RegExp): number {
  const match = pattern.exec(source);
  if (!match || match.index === undefined) return 0;
  return source.slice(0, match.index).split('\n').length;
}

function inspectGoSource(filePath: string, source: string): string[] {
  return forbiddenGoAdminPatterns.flatMap((forbidden) => {
    const line = firstPatternLine(source, forbidden.pattern);
    return line === 0
      ? []
      : [
          `[worker_whatsmeow] ${forbidden.label}\n  ${normalizedRelativePath(
            filePath
          )}:${line}`,
        ];
  });
}

function auditWhatsmeowWorker(): BoundaryAudit {
  const workerRoot = path.resolve(workspaceRoot, 'apps/worker_whatsmeow');
  const sources = [
    ...listProductionGoFiles(path.join(workerRoot, 'cmd', 'worker')),
    ...listProductionGoFiles(path.join(workerRoot, 'internal', 'app')),
  ];
  const violations = sources.flatMap((filePath) =>
    inspectGoSource(filePath, fs.readFileSync(filePath, 'utf8'))
  );
  return {
    sources: sources.map(normalizedRelativePath).sort(),
    violations: violations.sort(),
  };
}

describe('worker Kafka administrative boundary', () => {
  it.each(typeScriptWorkers)(
    '$name runtime graph contains no Kafka administrative capability',
    (worker) => {
      const audit = auditTypeScriptWorker(worker);

      expect(audit.sources.length).toBeGreaterThan(100);
      expect(audit.sources).toContain(
        'packages/services/kafkaServiceQueue.service.ts'
      );
      expect(audit.sources).not.toContain(
        'packages/services/kafkaBaileysQueue.service.ts'
      );
      expect(audit.violations).toEqual([]);
    }
  );

  it('worker_whatsmeow sources contain no Kafka administrative capability', () => {
    const audit = auditWhatsmeowWorker();

    expect(audit.sources.length).toBeGreaterThan(20);
    expect(audit.sources).toContain(
      'apps/worker_whatsmeow/internal/app/kafka.go'
    );
    expect(audit.violations).toEqual([]);
  });

  it('detects TypeScript Kafka admin symbols and mutation calls', () => {
    const filePath = path.resolve(
      workspaceRoot,
      'apps/worker_baileys/src/fixture.ts'
    );
    const sourceFile = ts.createSourceFile(
      filePath,
      'const service = new KafkaService(); service.createTopics([]);',
      ts.ScriptTarget.Latest,
      true
    );

    expect(inspectTypeScriptSource(filePath, sourceFile, new Map())).toEqual([
      expect.stringContaining('Kafka admin symbol "KafkaService"'),
      expect.stringContaining('Kafka admin method "createTopics"'),
    ]);
  });

  it('detects Whatsmeow Kafka administrative mutations', () => {
    const violations = inspectGoSource(
      path.resolve(
        workspaceRoot,
        'apps/worker_whatsmeow/internal/app/fixture.go'
      ),
      'package app\nfunc mutate(conn *Conn) { conn.DeleteTopics("worker") }\n'
    );

    expect(violations).toEqual([
      expect.stringContaining('Kafka administrative mutation'),
    ]);
  });

  it('keeps transient worker producer recovery retryable without administration', async () => {
    await expect(
      recoverWorkerKafkaTopicForProduce({} as never, 'update.message')
    ).resolves.toBeUndefined();
  });
});
