import 'reflect-metadata';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EContactPermissions } from '@core/common/enums/EPermissions/contact';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import {
  authenticatePublicApiAccountToken,
  authenticatePublicApiToken,
} from '@core/middlewares/publicApiToken.middleware';
import { PublicApiTokenService } from '@core/services/publicApiToken.service';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';
import { PlanEntitlementDeniedError } from '@core/common/exceptions/PlanEntitlementError';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { UserService } from '@core/services/user.service';
import { ApiJwtViewerUseCase } from '@core/useCases/api/ApiJwtViewer.useCase';
import { container } from 'tsyringe';

const publicApiToken = `uc_live_${'a'.repeat(43)}`;
const accountId = '01900000-0000-7000-8000-000000000001';
const actorUserId = '01900000-0000-7000-8000-000000000002';
const executorUserId = '01900000-0000-7000-8000-000000000003';
const tokenRecord = {
  public_api_token_id: '01900000-0000-7000-8000-000000000004',
  account_id: accountId,
  actor_user_id: actorUserId,
  actor_user_name: 'Ada Lovelace',
  token_hash: 'a'.repeat(64),
  token_encrypted: 'encrypted-token',
  token_preview: 'uc_live_...aaaaaaaa',
  created_at: '2026-07-10T12:00:00.000Z',
  updated_at: '2026-07-10T12:00:00.000Z',
  rotated_at: null,
  last_used_at: null,
  revoked_at: null,
  plan_is_active: true,
};
const permittedAction: IJwtGroupHierarchy = {
  account_id: tokenRecord.account_id,
  permission_role_id: 'role-1',
  role_name: 'Atendente',
  module_name: 'manager/chat',
  action_name: EChatPermissions.chat_access,
};

interface AuthenticationDependencies {
  tokenService: {
    findActiveByValue: jest.Mock;
    touchLastUsed: jest.Mock;
  };
  apiJwtViewer: {
    execute: jest.Mock;
  };
  userService: {
    listUserSectors: jest.Mock;
    listUserChannelsWithNames: jest.Mock;
  };
  entitlementService: {
    assertEntitled: jest.Mock;
  };
}

function createDependencies(): AuthenticationDependencies {
  return {
    tokenService: {
      findActiveByValue: jest.fn(async () => tokenRecord),
      touchLastUsed: jest.fn(async () => undefined),
    },
    apiJwtViewer: {
      execute: jest.fn(async () => ({
        actions: [permittedAction],
        plan_is_active: true,
      })),
    },
    userService: {
      listUserSectors: jest.fn(async () => ['sector-1']),
      listUserChannelsWithNames: jest.fn(async () => [
        { id: 'channel-1', name: 'WhatsApp' },
      ]),
    },
    entitlementService: {
      assertEntitled: jest.fn(async () => ({
        accountId,
        planProductId: EPlanProduct.integration,
        allowed: true,
        revision: '1',
        validUntil: '2026-08-10T12:00:00.000Z',
        planIsActive: true,
        source: 'plan',
      })),
    },
  };
}

function createRequest(
  keyapi: string | null = publicApiToken,
  executor: string | null = executorUserId
) {
  const headers: Record<string, string> = {};
  if (keyapi !== null) headers.keyapi = keyapi;
  if (executor !== null) headers['x-underchat-user-id'] = executor;

  return {
    headers,
    log: {
      error: jest.fn(),
      warn: jest.fn(),
    },
    method: 'GET',
    raw: { url: '/v1/chat' },
    routeOptions: { url: '/v1/chat' },
    server: {
      Redis: {
        eval: jest.fn(async () => [1, 60]),
      },
    },
    t: jest.fn((key: string) => key),
    url: '/v1/chat',
  };
}

function createReply() {
  const send = jest.fn();
  const code = jest.fn(() => ({ send }));

  return {
    reply: {
      code,
      header: jest.fn(),
      request: { id: 'request-1' },
    },
    code,
    send,
  };
}

function mockContainer(
  dependencies: AuthenticationDependencies
): jest.SpyInstance {
  return jest.spyOn(container, 'resolve').mockImplementation(((
    dependency: unknown
  ) => {
    if (dependency === PublicApiTokenService) {
      return dependencies.tokenService;
    }
    if (dependency === ApiJwtViewerUseCase) {
      return dependencies.apiJwtViewer;
    }
    if (dependency === UserService) {
      return dependencies.userService;
    }
    if (dependency === PlanEntitlementService) {
      return dependencies.entitlementService;
    }

    throw new Error(`Unexpected dependency: ${String(dependency)}`);
  }) as never);
}

describe('authenticatePublicApiToken contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 401 when the keyapi header is missing', async () => {
    const dependencies = createDependencies();
    const resolveSpy = mockContainer(dependencies);
    const request = createRequest(null);
    const { reply, code } = createReply();

    await authenticatePublicApiToken(request as never, reply as never, [
      EChatPermissions.chat_access,
    ]);

    expect(code).toHaveBeenCalledWith(401);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('returns 400 after entitlement but before rate/last-used when the executor is invalid', async () => {
    const dependencies = createDependencies();
    mockContainer(dependencies);
    const missingExecutorRequest = createRequest(publicApiToken, null);
    const invalidExecutorRequest = createRequest(publicApiToken, 'not-a-uuid');
    const firstReply = createReply();
    const secondReply = createReply();

    await authenticatePublicApiToken(
      missingExecutorRequest as never,
      firstReply.reply as never
    );
    await authenticatePublicApiToken(
      invalidExecutorRequest as never,
      secondReply.reply as never
    );

    expect(firstReply.code).toHaveBeenCalledWith(400);
    expect(secondReply.code).toHaveBeenCalledWith(400);
    expect(dependencies.tokenService.findActiveByValue).toHaveBeenCalledTimes(
      2
    );
    expect(
      dependencies.entitlementService.assertEntitled
    ).toHaveBeenCalledTimes(2);
    expect(missingExecutorRequest.server.Redis.eval).not.toHaveBeenCalled();
    expect(invalidExecutorRequest.server.Redis.eval).not.toHaveBeenCalled();
    expect(dependencies.tokenService.touchLastUsed).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid, revoked or rotated token', async () => {
    const dependencies = createDependencies();
    dependencies.tokenService.findActiveByValue.mockResolvedValue(null);
    mockContainer(dependencies);
    const request = createRequest('invalid-or-revoked-token');
    const { reply, code } = createReply();

    await authenticatePublicApiToken(request as never, reply as never, [
      EChatPermissions.chat_access,
    ]);

    expect(dependencies.tokenService.findActiveByValue).toHaveBeenCalledWith(
      'invalid-or-revoked-token'
    );
    expect(code).toHaveBeenCalledWith(401);
    expect(dependencies.apiJwtViewer.execute).not.toHaveBeenCalled();
  });

  it('returns 402 from the authoritative entitlement when the plan expired', async () => {
    const dependencies = createDependencies();
    dependencies.tokenService.findActiveByValue.mockResolvedValue({
      ...tokenRecord,
      plan_is_active: false,
    });
    dependencies.entitlementService.assertEntitled.mockRejectedValue(
      new PlanEntitlementDeniedError({
        accountId,
        planProductId: EPlanProduct.integration,
        allowed: false,
        revision: '2',
      })
    );
    mockContainer(dependencies);
    const request = createRequest();
    const { reply, code } = createReply();

    await authenticatePublicApiToken(request as never, reply as never, [
      EChatPermissions.chat_access,
    ]);

    expect(code).toHaveBeenCalledWith(402);
    expect(dependencies.apiJwtViewer.execute).not.toHaveBeenCalled();
    expect(dependencies.userService.listUserSectors).not.toHaveBeenCalled();
  });

  it('returns 402 before rate limiting or last-used updates when Integration is not entitled', async () => {
    const dependencies = createDependencies();
    dependencies.entitlementService.assertEntitled.mockRejectedValue(
      new PlanEntitlementDeniedError({
        accountId,
        planProductId: EPlanProduct.integration,
        allowed: false,
        revision: '2',
      })
    );
    mockContainer(dependencies);
    const request = createRequest();
    const { reply, code, send } = createReply();

    await authenticatePublicApiToken(request as never, reply as never, [
      EChatPermissions.chat_access,
    ]);

    expect(code).toHaveBeenCalledWith(402);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          reason: 'integration_plan_required',
          plan_product_id: EPlanProduct.integration,
        },
      })
    );
    expect(request.server.Redis.eval).not.toHaveBeenCalled();
    expect(dependencies.tokenService.touchLastUsed).not.toHaveBeenCalled();
    expect(dependencies.apiJwtViewer.execute).not.toHaveBeenCalled();
  });

  it('returns 403 when the required permission was removed', async () => {
    const dependencies = createDependencies();
    dependencies.apiJwtViewer.execute.mockResolvedValue({
      actions: [
        {
          ...permittedAction,
          action_name: EChatPermissions.chat_group,
        },
      ],
      plan_is_active: true,
    });
    mockContainer(dependencies);
    const request = createRequest();
    const { reply, code } = createReply();

    await authenticatePublicApiToken(request as never, reply as never, [
      EChatPermissions.chat_access,
    ]);

    expect(code).toHaveBeenCalledWith(403);
    expect(dependencies.userService.listUserSectors).not.toHaveBeenCalled();
  });

  it('returns 403 when the selected executor is inactive or outside the token account', async () => {
    const dependencies = createDependencies();
    dependencies.apiJwtViewer.execute.mockResolvedValue({
      actions: [],
      plan_is_active: true,
    });
    mockContainer(dependencies);
    const request = createRequest();
    const { reply, code } = createReply();

    await authenticatePublicApiToken(request as never, reply as never, [
      EChatPermissions.chat_access,
    ]);

    expect(code).toHaveBeenCalledWith(403);
    expect(
      dependencies.userService.listUserChannelsWithNames
    ).not.toHaveBeenCalled();
  });

  it('rehydrates the explicit executor independently from the token creator', async () => {
    const dependencies = createDependencies();
    const resolveSpy = mockContainer(dependencies);
    const request = createRequest();
    const { reply, code } = createReply();

    await authenticatePublicApiToken(request as never, reply as never, [
      EChatPermissions.chat_access,
    ]);

    expect(code).not.toHaveBeenCalled();
    expect(dependencies.apiJwtViewer.execute).toHaveBeenCalledWith({
      accountId: tokenRecord.account_id,
      module: 'manager',
      routeModule: 'manager/chat',
      userId: executorUserId,
    });
    expect(dependencies.userService.listUserSectors).toHaveBeenCalledWith(
      tokenRecord.account_id,
      executorUserId
    );
    expect(
      dependencies.userService.listUserChannelsWithNames
    ).toHaveBeenCalledWith(tokenRecord.account_id, executorUserId);
    expect(request).toMatchObject({
      publicApiTokenData: {
        account_id: tokenRecord.account_id,
        actor_user_id: tokenRecord.actor_user_id,
        executor_user_id: executorUserId,
        token_hash: tokenRecord.token_hash,
        token_id: tokenRecord.public_api_token_id,
      },
      tokenJwtData: {
        account_id: tokenRecord.account_id,
        actions: [permittedAction],
        channels: [{ id: 'channel-1', name: 'WhatsApp' }],
        permission_role_id: permittedAction.permission_role_id,
        plan_is_active: true,
        sectors: ['sector-1'],
        session_id: `public-api:${tokenRecord.public_api_token_id}:${executorUserId}`,
        session_platform: null,
        user_id: executorUserId,
      },
    });
    expect(dependencies.tokenService.touchLastUsed).toHaveBeenCalledWith(
      tokenRecord.public_api_token_id
    );
    expect(resolveSpy).toHaveBeenCalledTimes(4);
  });

  it('supports account-only discovery without selecting an executor', async () => {
    const dependencies = createDependencies();
    mockContainer(dependencies);
    const request = createRequest(publicApiToken, null);
    const { reply, code } = createReply();

    await authenticatePublicApiAccountToken(request as never, reply as never);

    expect(code).not.toHaveBeenCalled();
    expect(dependencies.apiJwtViewer.execute).not.toHaveBeenCalled();
    expect(request).toMatchObject({
      publicApiAuthenticationCompleted: true,
      publicApiTokenData: {
        account_id: accountId,
        actor_user_id: actorUserId,
        executor_user_id: null,
      },
      tokenJwtData: {
        account_id: accountId,
        user_id: '',
        actions: [],
        plan_is_active: true,
      },
    });
  });

  it('requires every permission group and authenticates/rate-limits only once', async () => {
    const dependencies = createDependencies();
    const phoneAction: IJwtGroupHierarchy = {
      ...permittedAction,
      action_name: EContactPermissions.contact_view_phone,
    };
    dependencies.apiJwtViewer.execute.mockResolvedValue({
      actions: [permittedAction, phoneAction],
      plan_is_active: true,
    });
    mockContainer(dependencies);
    const request = createRequest();
    const { reply, code } = createReply();
    const permissionGroups = [
      [EChatPermissions.chat_access],
      [EContactPermissions.contact_view_phone],
    ];

    await authenticatePublicApiToken(
      request as never,
      reply as never,
      permissionGroups
    );
    await authenticatePublicApiToken(
      request as never,
      reply as never,
      permissionGroups
    );

    expect(code).not.toHaveBeenCalled();
    expect(dependencies.tokenService.findActiveByValue).toHaveBeenCalledTimes(
      1
    );
    expect(dependencies.apiJwtViewer.execute).toHaveBeenCalledTimes(1);
    expect(request.server.Redis.eval).toHaveBeenCalledTimes(1);
  });

  it('denies a composed requirement when one permission group is missing', async () => {
    const dependencies = createDependencies();
    mockContainer(dependencies);
    const request = createRequest();
    const { reply, code } = createReply();

    await authenticatePublicApiToken(request as never, reply as never, [
      [EChatPermissions.chat_access],
      [EContactPermissions.contact_view_phone],
    ]);

    expect(code).toHaveBeenCalledWith(403);
  });
});
