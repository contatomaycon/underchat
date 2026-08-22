import 'reflect-metadata';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import { authenticateKeyApi } from '@core/middlewares/keyapi.middleware';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';
import { ApiKeyViewerUseCase } from '@core/useCases/api/ApiKeyViewer.useCase';
import { container } from 'tsyringe';

const accountId = '01900000-0000-7000-8000-000000000201';

const createRequest = () => ({
  id: 'request-1',
  module: ERouteModule.public,
  params: { keyapi: 'webhook-key' },
  raw: { url: '/v1/webhook/webhook-key' },
  routeOptions: { url: '/v1/webhook/:keyapi' },
  log: { error: jest.fn() },
  server: {
    Redis: {
      get: jest.fn(async () =>
        JSON.stringify([
          {
            account_id: accountId,
            api_key_id: '01900000-0000-7000-8000-000000000202',
            api_key: 'webhook-key',
            name: 'Webhook',
          },
        ])
      ),
      set: jest.fn(async () => 'OK'),
    },
  },
  t: jest.fn((key: string) => key),
});

const createReply = () => {
  const code = jest.fn();
  const send = jest.fn();
  const reply: {
    request: { id: string };
    code: jest.Mock;
    send: jest.Mock;
  } = {
    request: { id: 'request-1' },
    code: jest.fn(),
    send,
  };
  reply.code.mockImplementation((status: number) => {
    code(status);
    return reply;
  });
  return { reply, code, send };
};

describe('keyapi Integration entitlement middleware', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns structured 402 and leaves the request context unset', async () => {
    const assertEntitled = jest.fn(async () => {
      throw new PlanEntitlementDeniedError({
        accountId,
        planProductId: EPlanProduct.integration,
        allowed: false,
        revision: '2',
      });
    });
    jest.spyOn(container, 'resolve').mockImplementation((token: unknown) => {
      if (token === PlanEntitlementService) return { assertEntitled } as never;
      throw new Error(`Unexpected dependency: ${String(token)}`);
    });
    const request = createRequest();
    const { reply, code, send } = createReply();

    await authenticateKeyApi(request as never, reply as never);

    expect(code).toHaveBeenCalledWith(402);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          reason: 'integration_plan_required',
          plan_product_id: EPlanProduct.integration,
        },
      })
    );
    expect(request).not.toHaveProperty('tokenKeyData');
    expect(request).not.toHaveProperty('integrationEntitlementRevision');
    expect(request).not.toHaveProperty('integrationEntitlementSource');
  });

  it('returns structured 503 on a technical verifier failure', async () => {
    jest.spyOn(container, 'resolve').mockImplementation((token: unknown) => {
      if (token === PlanEntitlementService) {
        return {
          assertEntitled: jest.fn(async () => {
            throw new PlanEntitlementUnavailableError('database unavailable');
          }),
        } as never;
      }
      throw new Error(`Unexpected dependency: ${String(token)}`);
    });
    const request = createRequest();
    const { reply, code, send } = createReply();

    await authenticateKeyApi(request as never, reply as never);

    expect(code).toHaveBeenCalledWith(503);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          reason: 'plan_entitlement_unavailable',
          plan_product_id: EPlanProduct.integration,
        },
      })
    );
  });

  it('stores the admitted revision for downstream preflights', async () => {
    jest.spyOn(container, 'resolve').mockImplementation((token: unknown) => {
      if (token === PlanEntitlementService) {
        return {
          assertEntitled: jest.fn(async () => ({
            revision: '11',
            source: 'addon',
          })),
        } as never;
      }
      throw new Error(`Unexpected dependency: ${String(token)}`);
    });
    const request = createRequest();
    const { reply, code } = createReply();

    await authenticateKeyApi(request as never, reply as never);

    expect(code).not.toHaveBeenCalled();
    expect(request).toMatchObject({
      tokenKeyData: { account_id: accountId },
      integrationEntitlementRevision: '11',
      integrationEntitlementSource: 'addon',
    });
  });

  it('falls back to the authoritative key lookup when Redis is unavailable', async () => {
    const request = createRequest();
    request.server.Redis.get = jest.fn(async () => {
      throw new Error('redis offline');
    });
    request.server.Redis.set = jest.fn(async () => {
      throw new Error('redis offline');
    });
    const execute = jest.fn(async () => [
      {
        account_id: accountId,
        api_key_id: '01900000-0000-7000-8000-000000000202',
        api_key: 'webhook-key',
        name: 'Webhook',
      },
    ]);
    const assertEntitled = jest.fn(async () => ({
      revision: '12',
      source: 'plan' as const,
    }));
    jest.spyOn(container, 'resolve').mockImplementation((token: unknown) => {
      if (token === ApiKeyViewerUseCase) return { execute } as never;
      if (token === PlanEntitlementService) return { assertEntitled } as never;
      throw new Error(`Unexpected dependency: ${String(token)}`);
    });
    const { reply, code } = createReply();

    await authenticateKeyApi(request as never, reply as never);

    expect(code).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(assertEntitled).toHaveBeenCalledWith(
      accountId,
      EPlanProduct.integration
    );
    expect(request).toMatchObject({
      tokenKeyData: { account_id: accountId },
      integrationEntitlementRevision: '12',
      integrationEntitlementSource: 'plan',
    });
  });

  it('fails closed with structured 503 when Redis and key lookup are unavailable', async () => {
    const request = createRequest();
    request.server.Redis.get = jest.fn(async () => {
      throw new Error('redis offline');
    });
    jest.spyOn(container, 'resolve').mockImplementation((token: unknown) => {
      if (token === ApiKeyViewerUseCase) {
        return {
          execute: jest.fn(async () => {
            throw new Error('primary offline');
          }),
        } as never;
      }
      throw new Error(`Unexpected dependency: ${String(token)}`);
    });
    const { reply, code, send } = createReply();

    await authenticateKeyApi(request as never, reply as never);

    expect(code).toHaveBeenCalledWith(503);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          reason: 'plan_entitlement_unavailable',
          plan_product_id: EPlanProduct.integration,
        },
      })
    );
    expect(request).not.toHaveProperty('tokenKeyData');
  });
});
