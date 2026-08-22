import 'reflect-metadata';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import type { ListAllUsersResponse } from '@core/schema/user/listAllUsers/response.schema';
import { createUserSchema } from '@core/schema/user/createUser';
import multipart from '@fastify/multipart';
import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { listPublicUsers } from '@/controllers/user/listPublicUsers';
import {
  guardPublicUserReferences,
  guardPublicUserTarget,
} from '@/middlewares/publicUserScope.middleware';
import { PublicUserScopeRepository } from '@/repositories/PublicUserScope.repository';
import { publicUserSchema } from '@/schema/user/publicUserSchema';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_USER_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const SECTOR_ID = '44444444-4444-4444-8444-444444444444';
const CHANNEL_ID = '55555555-5555-4555-8555-555555555555';

interface ProbeReplyState {
  statusCode: number | null;
  payload: unknown;
}

interface RepositoryCalls {
  users: Array<[string, string]>;
  roles: Array<[string, string]>;
  sectors: Array<[string[], string]>;
  channels: Array<[string[], string]>;
  discovery: string[];
}

interface RepositoryBehavior {
  userBelongsToAccount?: boolean;
  roleBelongsToAccount?: boolean;
  sectorsBelongToAccount?: boolean;
  channelsBelongToAccount?: boolean;
  activeUsers?: ListAllUsersResponse[];
}

interface RegisteredRepository {
  calls: RepositoryCalls;
}

function createFullAccessActions(): IJwtGroupHierarchy[] {
  return [
    {
      account_id: ACCOUNT_ID,
      permission_role_id: ROLE_ID,
      role_name: 'Integration executor',
      module_name: 'public',
      action_name: EGeneralPermissions.full_access,
    },
  ];
}

function createRequest(
  options: {
    params?: Record<string, unknown>;
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
  } = {}
): FastifyRequest {
  return {
    params: options.params ?? {},
    body: options.body ?? {},
    query: options.query ?? {},
    tokenJwtData: {
      account_id: ACCOUNT_ID,
      user_id: '66666666-6666-4666-8666-666666666666',
      session_id: 'public-api:probe',
      permission_role_id: ROLE_ID,
      actions: createFullAccessActions(),
      sectors: [],
      channels: [],
      plan_is_active: true,
      session_platform: null,
    },
    t: (key: string) => key,
    log: {
      warn: () => undefined,
      error: () => undefined,
    },
  } as unknown as FastifyRequest;
}

function createReply(): {
  reply: FastifyReply;
  state: ProbeReplyState;
} {
  const state: ProbeReplyState = {
    statusCode: null,
    payload: null,
  };
  const reply = {
    request: { id: 'public-user-scope-probe' },
    code(statusCode: number) {
      state.statusCode = statusCode;
      return reply;
    },
    send(payload: unknown) {
      state.payload = payload;
      return reply;
    },
  } as unknown as FastifyReply;

  return { reply, state };
}

function registerRepository(
  behavior: RepositoryBehavior = {}
): RegisteredRepository {
  const calls: RepositoryCalls = {
    users: [],
    roles: [],
    sectors: [],
    channels: [],
    discovery: [],
  };
  const repository = {
    async userBelongsToAccount(userId: string, accountId: string) {
      calls.users.push([userId, accountId]);
      return behavior.userBelongsToAccount ?? true;
    },
    async roleBelongsToAccount(permissionRoleId: string, accountId: string) {
      calls.roles.push([permissionRoleId, accountId]);
      return behavior.roleBelongsToAccount ?? true;
    },
    async sectorsBelongToAccount(sectorIds: string[], accountId: string) {
      calls.sectors.push([sectorIds, accountId]);
      return behavior.sectorsBelongToAccount ?? true;
    },
    async channelsBelongToAccount(channelIds: string[], accountId: string) {
      calls.channels.push([channelIds, accountId]);
      return behavior.channelsBelongToAccount ?? true;
    },
    async listActiveUsers(accountId: string) {
      calls.discovery.push(accountId);
      return behavior.activeUsers ?? [];
    },
  };

  container.reset();
  container.registerInstance(
    PublicUserScopeRepository,
    repository as unknown as PublicUserScopeRepository
  );

  return { calls };
}

async function probeTargetOutsideAccount(): Promise<{
  statusCode: number | null;
  calls: RepositoryCalls;
}> {
  const repository = registerRepository({ userBelongsToAccount: false });
  const { reply, state } = createReply();
  await guardPublicUserTarget(
    createRequest({ params: { user_id: TARGET_USER_ID } }),
    reply
  );
  return { statusCode: state.statusCode, calls: repository.calls };
}

async function probeReferences(
  behavior: RepositoryBehavior,
  body: Record<string, unknown>
): Promise<{ statusCode: number | null; calls: RepositoryCalls }> {
  const repository = registerRepository(behavior);
  const { reply, state } = createReply();
  await guardPublicUserReferences(createRequest({ body }), reply);
  return { statusCode: state.statusCode, calls: repository.calls };
}

async function probeDiscovery(): Promise<{
  statusCode: number | null;
  payload: unknown;
  calls: RepositoryCalls;
}> {
  const activeUsers: ListAllUsersResponse[] = [
    {
      user_id: TARGET_USER_ID,
      first_name: 'Active',
      last_name: 'User',
      account_id: ACCOUNT_ID,
      account_name: 'Underchat',
    },
  ];
  const repository = registerRepository({ activeUsers });
  const { reply, state } = createReply();
  await listPublicUsers(createRequest(), reply);
  return {
    statusCode: state.statusCode,
    payload: state.payload,
    calls: repository.calls,
  };
}

function createMultipartPayload(
  fields: Array<[string, string]>,
  boundary: string
): string {
  return fields
    .map(
      ([name, value]) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    )
    .join('')
    .concat(`--${boundary}--\r\n`);
}

async function probeStrictMultipartSchema(): Promise<{
  validStatusCode: number;
  accountIdStatusCode: number;
}> {
  const server = fastify({
    ajv: { customOptions: { removeAdditional: false } },
    logger: false,
  });
  await server.register(multipart, { attachFieldsToBody: true });
  server.post('/user', {
    schema: publicUserSchema(createUserSchema, {
      omitAccountIdFrom: 'body',
    }),
    handler: async (_request, reply) =>
      reply.send({ id: null, status: true, message: 'ok', data: null }),
  });
  await server.ready();

  const boundary = 'underchat-public-user-contract';
  const commonFields: Array<[string, string]> = [
    ['email', 'integration@example.com'],
    ['password', 'StrongPassword!123'],
    ['name', 'Integration'],
    ['last_name', 'Executor'],
    ['permission_role_id', ROLE_ID],
    ['sector_ids[0]', SECTOR_ID],
    ['channel_ids[0]', CHANNEL_ID],
  ];
  const headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    keyapi: 'uc_live_contract_probe',
    'x-underchat-user-id': TARGET_USER_ID,
  };
  const valid = await server.inject({
    method: 'POST',
    url: '/user',
    headers,
    payload: createMultipartPayload(commonFields, boundary),
  });
  const accountId = await server.inject({
    method: 'POST',
    url: '/user',
    headers,
    payload: createMultipartPayload(
      [...commonFields, ['account_id', ACCOUNT_ID]],
      boundary
    ),
  });

  await server.close();
  return {
    validStatusCode: valid.statusCode,
    accountIdStatusCode: accountId.statusCode,
  };
}

const result = {
  targetOutsideAccount: await probeTargetOutsideAccount(),
  protectedRole: await probeReferences(
    {},
    { permission_role_id: EPermissionRole.master }
  ),
  invalidRole: await probeReferences(
    {},
    { permission_role_id: 'invalid-role-id' }
  ),
  roleOutsideAccount: await probeReferences(
    { roleBelongsToAccount: false },
    { permission_role_id: ROLE_ID }
  ),
  invalidSector: await probeReferences({}, { sector_ids: ['invalid-sector'] }),
  sectorOutsideAccount: await probeReferences(
    { sectorsBelongToAccount: false },
    { sector_ids: [SECTOR_ID] }
  ),
  invalidChannel: await probeReferences(
    {},
    { 'channel_ids[0]': { value: 'invalid-channel' } }
  ),
  channelOutsideAccount: await probeReferences(
    { channelsBelongToAccount: false },
    { 'channel_ids[0]': { value: CHANNEL_ID } }
  ),
  discovery: await probeDiscovery(),
  strictMultipart: await probeStrictMultipartSchema(),
};

process.stdout.write(`PUBLIC_USER_SCOPE_CONTRACT:${JSON.stringify(result)}\n`);
