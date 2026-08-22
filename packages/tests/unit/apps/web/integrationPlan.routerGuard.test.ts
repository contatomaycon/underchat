import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

const mockIsLoggedIn = jest.fn<boolean, []>();
const mockCanNavigate = jest.fn<boolean, [unknown]>();
const mockAuthStore = {
  planIsActive: true,
  planProducts: [] as string[],
};

type NavigationGuard = (to: {
  meta: Record<string, unknown>;
  matched: Array<{ meta: Record<string, unknown> }>;
  name: string;
  query: Record<string, unknown>;
  fullPath: string;
  path: string;
}) => Promise<unknown>;

type SetupGuards = (router: {
  beforeEach: (guard: NavigationGuard) => void;
}) => void;

const loadSetupGuards = (): SetupGuards => {
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/plugins/1.router/guards.ts'
  );
  const source = fs.readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} as Record<string, unknown> };
  const moduleRequire = (moduleId: string): unknown => {
    const modules: Record<string, unknown> = {
      '@layouts/plugins/casl': { canNavigate: mockCanNavigate },
      '@/@webcore/localStorage/user': { isLoggedIn: mockIsLoggedIn },
      '@/@webcore/stores/auth': { useAuthStore: () => mockAuthStore },
      '@core/common/enums/EPlanProduct': { EPlanProduct },
    };

    if (!(moduleId in modules)) {
      throw new Error(`Unexpected router guard dependency: ${moduleId}`);
    }

    return modules[moduleId];
  };
  const evaluateModule = new Function(
    'require',
    'module',
    'exports',
    transpiled
  ) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loadedModule,
    exports: Record<string, unknown>
  ) => void;
  evaluateModule(moduleRequire, loadedModule, loadedModule.exports);

  return loadedModule.exports.setupGuards as SetupGuards;
};

const setupGuards = loadSetupGuards();

const integrationRoute = () => ({
  meta: {},
  matched: [
    {
      meta: { requiredPlanProducts: [EPlanProduct.integration] },
    },
  ],
  name: 'integration',
  query: {},
  fullPath: '/integration',
  path: '/integration',
});

const registerGuard = (): NavigationGuard => {
  let guard: NavigationGuard | undefined;
  setupGuards({
    beforeEach: jest.fn((registeredGuard: NavigationGuard) => {
      guard = registeredGuard;
    }),
  } as never);

  if (!guard) {
    throw new Error('navigation guard was not registered');
  }

  return guard;
};

describe('Integration plan route guard', () => {
  beforeEach(() => {
    mockIsLoggedIn.mockReturnValue(true);
    mockCanNavigate.mockReturnValue(true);
    mockAuthStore.planIsActive = true;
    mockAuthStore.planProducts = [];
  });

  it('allows the Integration route from the session plan products', async () => {
    mockAuthStore.planProducts = [EPlanProduct.integration];
    const guard = registerGuard();

    await expect(guard(integrationRoute())).resolves.toBeUndefined();

    expect(mockCanNavigate).toHaveBeenCalledTimes(1);
  });

  it('redirects when Integration is absent from the session plan products', async () => {
    const guard = registerGuard();

    await expect(guard(integrationRoute())).resolves.toEqual({
      name: 'not-authorized',
    });

    expect(mockCanNavigate).not.toHaveBeenCalled();
  });
});
