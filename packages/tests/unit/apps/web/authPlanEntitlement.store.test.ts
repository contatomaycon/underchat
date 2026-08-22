import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createPinia, setActivePinia } from 'pinia';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { EColor } from '@core/common/enums/EColor';

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

interface TestAuthStore {
  planIsActive: boolean;
  planProducts: string[];
  revokeIntegrationEntitlement: () => void;
}

type AuthStoreFactory = () => TestAuthStore;

const loadLocalStorageUserModule = (): Record<string, unknown> => {
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/@webcore/localStorage/user.ts'
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
    if (moduleId === '@core/common/functions/extractUserChannelIds') {
      return { normalizeUserChannels: (channels: unknown[]) => channels };
    }

    throw new Error(`Unexpected localStorage dependency: ${moduleId}`);
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

  return loadedModule.exports;
};

const loadAuthStoreFactory = (): AuthStoreFactory => {
  const localStorageUser = loadLocalStorageUserModule();
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/@webcore/stores/auth.ts'
  );
  const source = fs
    .readFileSync(filename, 'utf8')
    .replaceAll('import.meta.env.VITE_BACKEND_URL', 'undefined');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} as Record<string, unknown> };
  const i18n = {
    global: {
      locale: { value: 'pt' },
      t: (key: string) => key,
    },
  };
  const moduleRequire = (moduleId: string): unknown => {
    const modules: Record<string, unknown> = {
      pinia: jest.requireActual('pinia'),
      axios: {
        __esModule: true,
        default: { get: jest.fn(), post: jest.fn() },
        AxiosError: Error,
      },
      '@webcore/axios': {
        __esModule: true,
        default: { post: jest.fn() },
      },
      '@/plugins/i18n': { getI18n: () => i18n },
      '@core/common/enums/EColor': { EColor },
      '../localStorage/user': localStorageUser,
      './chat': { useChatStore: () => ({ updateUser: jest.fn() }) },
      '@/plugins/0.casl/ability': { updateAbilityPermissions: jest.fn() },
      '../utils/helpers': { normalizeBaseUrl: (value: string) => value },
      '@core/common/enums/EPlanProduct': { EPlanProduct },
    };

    if (!(moduleId in modules)) {
      throw new Error(`Unexpected auth store dependency: ${moduleId}`);
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

  return loadedModule.exports.useAuthStore as AuthStoreFactory;
};

const useAuthStore = loadAuthStoreFactory();

describe('web auth store Integration entitlement', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    });
    localStorage.setItem(
      'plan_products',
      JSON.stringify([
        EPlanProduct.internal_chat,
        EPlanProduct.integration,
        EPlanProduct.contact,
      ])
    );
    localStorage.setItem('plan_is_active', JSON.stringify(true));
    setActivePinia(createPinia());
  });

  it('revokes only Integration without changing the global plan status', () => {
    const authStore = useAuthStore();

    authStore.revokeIntegrationEntitlement();

    expect(authStore.planIsActive).toBe(true);
    expect(authStore.planProducts).toEqual([
      EPlanProduct.internal_chat,
      EPlanProduct.contact,
    ]);
    expect(JSON.parse(localStorage.getItem('plan_products') ?? '[]')).toEqual([
      EPlanProduct.internal_chat,
      EPlanProduct.contact,
    ]);
    expect(localStorage.getItem('plan_is_active')).toBe('true');
  });

  it('is idempotent when Integration is already absent', () => {
    localStorage.setItem(
      'plan_products',
      JSON.stringify([EPlanProduct.internal_chat, EPlanProduct.contact])
    );
    setActivePinia(createPinia());
    const authStore = useAuthStore();

    authStore.revokeIntegrationEntitlement();

    expect(authStore.planIsActive).toBe(true);
    expect(authStore.planProducts).toEqual([
      EPlanProduct.internal_chat,
      EPlanProduct.contact,
    ]);
  });
});
