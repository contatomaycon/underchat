import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  classifyWorkerContainerEnvironmentKey,
  isInheritedWorkerEnvironmentKeyAllowed,
  WORKER_INTENTIONALLY_DENIED_ENV_KEYS,
} from '@core/common/functions/workerContainerEnvironmentPolicy';

interface TypeScriptWorkerBoundary {
  entry: string;
  name: string;
  tsconfig: string;
}

interface ModuleReference {
  runtime: boolean;
  specifier: string;
}

interface DynamicEnvironmentReader {
  argumentIndexes: Set<number>;
  name: string;
}

type RuntimeFunctionLike =
  | ts.ArrowFunction
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.MethodDeclaration;

const workspaceRoot = process.cwd();
const environmentKeyPattern = /^[A-Z][A-Z0-9_]+$/u;
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
const goEnvironmentReaderNames = [
  'envBoolDefault',
  'envDefault',
  'envDurationDefault',
  'envFloatDefault',
  'envIntDefault',
  'envMillisDurationDefault',
  'envScopedIntDefault',
  'firstEnv',
  'Getenv',
  'LookupEnv',
  'scopedEnvDefault',
] as const;

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

function collectModuleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
        runtime: importDeclarationIsRuntime(node),
        specifier: node.moduleSpecifier.text,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
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
        runtime: !node.isTypeOnly,
        specifier: node.moduleReference.expression.text,
      });
    } else if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      references.push({
        runtime: true,
        specifier: node.arguments[0].text,
      });
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

function collectWorkerRuntimeSources(
  worker: TypeScriptWorkerBoundary
): ts.SourceFile[] {
  const tsconfigPath = path.resolve(workspaceRoot, worker.tsconfig);
  const compilerOptions = parseWorkerTsconfig(tsconfigPath).options;
  const host = ts.createCompilerHost(compilerOptions);
  const cache = ts.createModuleResolutionCache(
    workspaceRoot,
    (fileName) => fileName,
    compilerOptions
  );
  const queue = [path.resolve(workspaceRoot, worker.entry)];
  const visited = new Set<string>();
  const sources: ts.SourceFile[] = [];

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
    sources.push(sourceFile);

    for (const reference of collectModuleReferences(sourceFile)) {
      if (!reference.runtime) continue;
      const resolved = ts.resolveModuleName(
        reference.specifier,
        currentFile,
        compilerOptions,
        host,
        cache
      ).resolvedModule?.resolvedFileName;
      if (resolved && isWorkspaceSource(path.resolve(resolved))) {
        queue.push(path.resolve(resolved));
      }
    }
  }

  return sources;
}

function collectLocalStringConstants(
  sourceFile: ts.SourceFile
): ReadonlyMap<string, string> {
  const constants = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      constants.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return constants;
}

function isProcessEnvironmentExpression(
  node: ts.Expression
): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    node.name.text === 'env'
  );
}

function directEnvironmentKey(
  node: ts.Node,
  constants: ReadonlyMap<string, string>
): string | null {
  if (
    ts.isPropertyAccessExpression(node) &&
    isProcessEnvironmentExpression(node.expression)
  ) {
    return node.name.text;
  }
  if (
    !ts.isElementAccessExpression(node) ||
    !isProcessEnvironmentExpression(node.expression)
  ) {
    return null;
  }

  const argument = node.argumentExpression;
  if (argument && ts.isStringLiteralLike(argument)) return argument.text;
  if (argument && ts.isIdentifier(argument)) {
    return constants.get(argument.text) ?? null;
  }
  return null;
}

function isRuntimeFunctionLike(node: ts.Node): node is RuntimeFunctionLike {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

function functionLikeName(node: RuntimeFunctionLike): string | null {
  if (
    (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }
  return null;
}

function loopVariableParameterIndexes(
  node: RuntimeFunctionLike,
  parameters: ReadonlyMap<string, number>
): ReadonlyMap<string, number> {
  const indexes = new Map<string, number>();
  const visit = (child: ts.Node): void => {
    if (
      ts.isForOfStatement(child) &&
      ts.isVariableDeclarationList(child.initializer) &&
      ts.isIdentifier(child.expression)
    ) {
      const parameterIndex = parameters.get(child.expression.text);
      const declaration = child.initializer.declarations[0];
      if (
        parameterIndex !== undefined &&
        declaration &&
        ts.isIdentifier(declaration.name)
      ) {
        indexes.set(declaration.name.text, parameterIndex);
      }
    }
    ts.forEachChild(child, visit);
  };
  if (node.body) visit(node.body);
  return indexes;
}

function dynamicReaderArgumentIndexes(node: RuntimeFunctionLike): Set<number> {
  const parameters = new Map<string, number>();
  node.parameters.forEach((parameter, index) => {
    if (ts.isIdentifier(parameter.name)) {
      parameters.set(parameter.name.text, index);
    }
  });
  const loopIndexes = loopVariableParameterIndexes(node, parameters);
  const argumentIndexes = new Set<number>();
  const visit = (child: ts.Node): void => {
    if (
      ts.isElementAccessExpression(child) &&
      isProcessEnvironmentExpression(child.expression) &&
      child.argumentExpression &&
      ts.isIdentifier(child.argumentExpression)
    ) {
      const argumentName = child.argumentExpression.text;
      const index =
        parameters.get(argumentName) ?? loopIndexes.get(argumentName);
      if (index !== undefined) argumentIndexes.add(index);
    }
    ts.forEachChild(child, visit);
  };
  if (node.body) visit(node.body);
  return argumentIndexes;
}

function collectDynamicEnvironmentReaders(
  sourceFiles: readonly ts.SourceFile[]
): ReadonlyMap<string, DynamicEnvironmentReader> {
  const readers = new Map<string, DynamicEnvironmentReader>();
  for (const sourceFile of sourceFiles) {
    const visit = (node: ts.Node): void => {
      if (isRuntimeFunctionLike(node)) {
        const name = functionLikeName(node);
        const argumentIndexes = dynamicReaderArgumentIndexes(node);
        if (name && argumentIndexes.size > 0) {
          const existing = readers.get(name);
          const combined = existing?.argumentIndexes ?? new Set<number>();
          argumentIndexes.forEach((index) => combined.add(index));
          readers.set(name, { argumentIndexes: combined, name });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return readers;
}

function callExpressionName(node: ts.CallExpression): string | null {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }
  return null;
}

function addLiteralEnvironmentKeys(
  expression: ts.Expression | undefined,
  keys: Set<string>
): void {
  if (!expression) return;
  if (
    ts.isStringLiteralLike(expression) &&
    environmentKeyPattern.test(expression.text)
  ) {
    keys.add(expression.text);
    return;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    expression.elements.forEach((element) =>
      addLiteralEnvironmentKeys(element as ts.Expression, keys)
    );
  }
}

function addScopedEnvironmentKeys(
  node: ts.CallExpression,
  keys: Set<string>
): void {
  if (callExpressionName(node) !== 'resolveScopedEnvValue') return;
  for (const argument of node.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) continue;
    for (const property of argument.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isStringLiteralLike(property.initializer) &&
        environmentKeyPattern.test(property.initializer.text)
      ) {
        keys.add(property.initializer.text);
      }
    }
  }
}

function collectTypeScriptEnvironmentKeys(
  sourceFiles: readonly ts.SourceFile[]
): Set<string> {
  const keys = new Set<string>();
  const readers = collectDynamicEnvironmentReaders(sourceFiles);
  for (const sourceFile of sourceFiles) {
    const constants = collectLocalStringConstants(sourceFile);
    const visit = (node: ts.Node): void => {
      const directKey = directEnvironmentKey(node, constants);
      if (directKey) keys.add(directKey);
      if (ts.isCallExpression(node)) {
        addScopedEnvironmentKeys(node, keys);
        const reader = readers.get(callExpressionName(node) ?? '');
        reader?.argumentIndexes.forEach((index) =>
          addLiteralEnvironmentKeys(node.arguments[index], keys)
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return keys;
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

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function collectGoCallEnvironmentKeys(
  source: string,
  readerName: string,
  keys: Set<string>
): void {
  const callPattern = new RegExp(
    `(?:os\\.)?${regexEscape(readerName)}\\s*\\(([\\s\\S]*?)\\)`,
    'gu'
  );
  for (const call of source.matchAll(callPattern)) {
    const argumentsSource = call[1] ?? '';
    for (const literal of argumentsSource.matchAll(/"([A-Z][A-Z0-9_]+)"/gu)) {
      if (literal[1]) keys.add(literal[1]);
    }
  }
}

function collectWhatsmeowEnvironmentKeys(): Set<string> {
  const roots = [
    path.resolve(workspaceRoot, 'apps/worker_whatsmeow/cmd/worker'),
    path.resolve(workspaceRoot, 'apps/worker_whatsmeow/internal/app'),
  ];
  const keys = new Set<string>();
  for (const filePath of roots.flatMap(listProductionGoFiles)) {
    const source = fs.readFileSync(filePath, 'utf8');
    goEnvironmentReaderNames.forEach((readerName) =>
      collectGoCallEnvironmentKeys(source, readerName, keys)
    );
  }
  return keys;
}

function unclassifiedEnvironmentKeys(keys: ReadonlySet<string>): string[] {
  return [...keys]
    .filter((key) => classifyWorkerContainerEnvironmentKey(key) === null)
    .sort();
}

describe('worker container environment policy', () => {
  it.each(typeScriptWorkers)(
    '$name runtime graph has an explicit policy for every environment key',
    (worker) => {
      const sources = collectWorkerRuntimeSources(worker);
      const keys = collectTypeScriptEnvironmentKeys(sources);

      expect(keys.size).toBeGreaterThan(100);
      expect(keys.has('NODE_ENV')).toBe(true);
      expect(keys.has('BALANCER_GRPC_RUNTIME_FENCE_TOKEN')).toBe(true);
      expect(keys.has('KAFKA_PUBLIC_BROKER')).toBe(true);
      expect(keys.has('KAFKA_PROVISIONER_OPERATIONS_ENABLED')).toBe(true);
      expect(keys.has('SERVICE_API_KAFKA_CUTOVER_POLL_MS')).toBe(false);
      expect(unclassifiedEnvironmentKeys(keys)).toEqual([]);
    }
  );

  it('worker_whatsmeow production Go sources have an explicit policy for every environment key', () => {
    const keys = collectWhatsmeowEnvironmentKeys();

    expect(keys.size).toBeGreaterThan(80);
    expect(keys.has('NODE_ENV')).toBe(false);
    expect(keys.has('BALANCER_GRPC_RUNTIME_FENCE_TOKEN')).toBe(false);
    expect(keys.has('DB_CACHE_PRIVATE_PORT')).toBe(true);
    expect(keys.has('WORKER_OUTBOUND_FAILURE_RECONNECT_COOLDOWN')).toBe(true);
    expect(keys.has('WORKER_TYPING_MAX_ORPHANS')).toBe(true);
    expect(unclassifiedEnvironmentKeys(keys)).toEqual([]);
  });

  it('does not accidentally inherit source-only or control-plane keys', () => {
    for (const key of WORKER_INTENTIONALLY_DENIED_ENV_KEYS) {
      expect(isInheritedWorkerEnvironmentKeyAllowed(key)).toBe(false);
      expect(classifyWorkerContainerEnvironmentKey(key)).toBe(
        'intentionally_denied'
      );
    }
    expect(
      isInheritedWorkerEnvironmentKeyAllowed('DB_PRIVATE_DATABASE_URL')
    ).toBe(false);
    expect(
      isInheritedWorkerEnvironmentKeyAllowed('KAFKA_PROVISIONER_PASSWORD')
    ).toBe(false);
    for (const key of [
      'NATS_CONNECTION_NAME',
      'NATS_PASSWORD',
      'NATS_PUBLIC_URL',
      'NATS_TLS',
      'NATS_URL',
      'NATS_USER',
    ]) {
      expect(isInheritedWorkerEnvironmentKeyAllowed(key)).toBe(true);
      expect(classifyWorkerContainerEnvironmentKey(key)).toBe('inherited');
    }
    expect(isInheritedWorkerEnvironmentKeyAllowed('NATS_CREDS_BASE64')).toBe(
      false
    );
    expect(classifyWorkerContainerEnvironmentKey('NATS_CREDS_BASE64')).toBe(
      'intentionally_denied'
    );
    expect(isInheritedWorkerEnvironmentKeyAllowed('NATS_TOKEN')).toBe(false);
    expect(classifyWorkerContainerEnvironmentKey('NATS_TOKEN')).toBe(
      'intentionally_denied'
    );
    expect(isInheritedWorkerEnvironmentKeyAllowed('NATS_PRIVATE_URL')).toBe(
      false
    );
    expect(classifyWorkerContainerEnvironmentKey('NATS_PRIVATE_URL')).toBe(
      'intentionally_denied'
    );
    expect(
      isInheritedWorkerEnvironmentKeyAllowed('WORKER_COMMAND_TRANSPORT')
    ).toBe(false);
    expect(
      classifyWorkerContainerEnvironmentKey('WORKER_COMMAND_TRANSPORT')
    ).toBeNull();
    for (const key of [
      'PROXY_PROTOCOL',
      'PROXY_HOST',
      'PROXY_PORT',
      'PROXY_USERNAME',
      'PROXY_PASSWORD',
    ]) {
      expect(isInheritedWorkerEnvironmentKeyAllowed(key)).toBe(false);
      expect(classifyWorkerContainerEnvironmentKey(key)).toBe('override');
    }
    for (const alias of [
      'PROXY_ADDRESS',
      'PROXY_AUTH',
      'PROXY_PASS',
      'PROXY_SERVER',
      'PROXY_URI',
      'PROXY_URL',
      'PROXY_USER',
    ]) {
      expect(isInheritedWorkerEnvironmentKeyAllowed(alias)).toBe(false);
      expect(classifyWorkerContainerEnvironmentKey(alias)).toBe(
        'intentionally_denied'
      );
    }
    expect(
      isInheritedWorkerEnvironmentKeyAllowed('PROXY_CONNECT_TIMEOUT_MS')
    ).toBe(true);
    expect(
      classifyWorkerContainerEnvironmentKey('PROXY_CONNECT_TIMEOUT_MS')
    ).toBe('inherited');
    for (const workerRuntimeTimeout of [
      'CRITICAL_REDIS_OPERATION_TIMEOUT_MS',
      'MEDIA_DOWNLOAD_MAX_BYTES',
      'MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS',
      'MESSAGE_SEND_PRE_PROVIDER_TIMEOUT_MS',
      'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS',
      'WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS',
      'WORKER_NODE_SHUTDOWN_TIMEOUT_MS',
      'WORKER_PROVIDER_SEND_MAX_IN_FLIGHT',
      'WORKER_SELF_MONITOR_READINESS_TIMEOUT_MS',
      'WORKER_SEND_PROVIDER_RESERVE_MS',
      'WORKER_TYPING_MAX_ORPHANS',
    ]) {
      expect(isInheritedWorkerEnvironmentKeyAllowed(workerRuntimeTimeout)).toBe(
        true
      );
      expect(classifyWorkerContainerEnvironmentKey(workerRuntimeTimeout)).toBe(
        'inherited'
      );
    }
  });
});
