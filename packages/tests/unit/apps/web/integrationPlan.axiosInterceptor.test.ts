import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

type ResponseRejected = (error: Error) => Promise<unknown>;
type ResponseFulfilled = (response: unknown) => Promise<unknown>;

const loadResponseInterceptors = (dependencies: {
  authStore: {
    planIsActive: boolean;
    updatePlanStatus: jest.Mock;
    revokeIntegrationEntitlement: jest.Mock;
  };
  router: {
    currentRoute: {
      value: {
        name: string;
        matched: Array<{ meta: Record<string, unknown> }>;
      };
    };
    replace: jest.Mock;
    resolve: jest.Mock;
  };
}): {
  fulfilled: ResponseFulfilled;
  rejected: ResponseRejected;
} => {
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/@webcore/axios.ts'
  );
  const source = fs
    .readFileSync(filename, 'utf8')
    .replaceAll(
      'import.meta.env.VITE_BACKEND_URL',
      JSON.stringify('http://backend.test')
    );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  let responseFulfilled: ResponseFulfilled | undefined;
  let responseRejected: ResponseRejected | undefined;
  const axiosInstance = Object.assign(jest.fn(), {
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn(
          (fulfilled: ResponseFulfilled, rejected: ResponseRejected): void => {
            responseFulfilled = fulfilled;
            responseRejected = rejected;
          }
        ),
      },
    },
  });
  const loadedModule = { exports: {} as Record<string, unknown> };
  const moduleRequire = (moduleId: string): unknown => {
    const modules: Record<string, unknown> = {
      axios: {
        __esModule: true,
        default: {
          create: jest.fn(() => axiosInstance),
          post: jest.fn(),
        },
      },
      './localStorage/user': {
        getToken: jest.fn(() => 'token'),
        persistPlanStatus: jest.fn(),
        removeUserData: jest.fn(),
        setPermissions: jest.fn(),
        setPlanProducts: jest.fn(),
        setToken: jest.fn(),
      },
      './utils/sessionTeardown': {
        teardownClientSession: jest.fn(async () => undefined),
      },
      '@/plugins/1.router': { router: dependencies.router },
      '@/plugins/i18n': {
        getI18n: () => ({
          global: {
            locale: { value: 'pt' },
            t: (key: string) => key,
          },
        }),
      },
      './utils/helpers': { normalizeBaseUrl: (value: string) => value },
      '@/plugins/0.casl/ability': { updateAbilityPermissions: jest.fn() },
      '@core/common/enums/EPlanProduct': { EPlanProduct },
      '@webcore/stores/auth': { useAuthStore: () => dependencies.authStore },
    };

    if (!(moduleId in modules)) {
      throw new Error(`Unexpected axios dependency: ${moduleId}`);
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

  if (!responseFulfilled || !responseRejected) {
    throw new Error('axios response interceptors were not registered');
  }

  return {
    fulfilled: responseFulfilled,
    rejected: responseRejected,
  };
};

describe('Integration plan axios interceptor', () => {
  it.each([
    { current: false, header: 'true', expected: true },
    { current: true, header: 'false', expected: false },
  ])(
    'updates the plan status from a regular API response ($header)',
    async ({ current, header, expected }) => {
      const authStore = {
        planIsActive: current,
        updatePlanStatus: jest.fn(),
        revokeIntegrationEntitlement: jest.fn(),
      };
      const router = {
        currentRoute: { value: { name: 'root', matched: [] } },
        resolve: jest.fn(() => ({ href: '/not-authorized' })),
        replace: jest.fn(),
      };
      const { fulfilled } = loadResponseInterceptors({ authStore, router });
      const response = {
        headers: {
          get: jest.fn((name: string) =>
            name === 'x-plan-active' ? header : null
          ),
        },
      };

      await expect(fulfilled(response)).resolves.toBe(response);

      expect(authStore.updatePlanStatus).toHaveBeenCalledWith(expected);
      expect(authStore.revokeIntegrationEntitlement).not.toHaveBeenCalled();
    }
  );

  it('revokes Integration and redirects an open Integration route on 402', async () => {
    const authStore = {
      planIsActive: true,
      updatePlanStatus: jest.fn(),
      revokeIntegrationEntitlement: jest.fn(),
    };
    const currentRoute = {
      value: {
        name: 'integration',
        matched: [
          {
            meta: { requiredPlanProducts: [EPlanProduct.integration] },
          },
        ],
      },
    };
    const router = {
      currentRoute,
      resolve: jest.fn(() => ({ href: '/not-authorized' })),
      replace: jest.fn(async () => {
        currentRoute.value = {
          name: 'not-authorized',
          matched: [],
        };
      }),
    };
    const locationReplace = jest.fn();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { replace: locationReplace },
    });
    const { rejected: rejectResponse } = loadResponseInterceptors({
      authStore,
      router,
    });
    const error = Object.assign(new Error('payment required'), {
      config: {},
      response: {
        status: 402,
        data: {
          status: false,
          data: {
            reason: 'integration_plan_required',
            plan_product_id: EPlanProduct.integration,
          },
        },
      },
    });

    await expect(rejectResponse(error)).rejects.toBe(error);

    expect(authStore.revokeIntegrationEntitlement).toHaveBeenCalledTimes(1);
    expect(authStore.updatePlanStatus).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith({ name: 'not-authorized' });
    expect(locationReplace).not.toHaveBeenCalled();
  });
});
