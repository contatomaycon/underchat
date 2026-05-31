import 'reflect-metadata';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import type { ChatUserService } from '@core/services/chatUser.service';
import type { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { ChatListerUseCase } from './ChatLister.useCase';

jest.mock('@core/services/chatUser.service', () => ({
  ChatUserService: class ChatUserService {},
}));

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class ElasticDatabaseService {},
}));

type QueryRecord = Record<string, unknown>;

function buildAction(actionName: EPermissionsRoles): IJwtGroupHierarchy {
  return {
    account_id: 'account-1',
    permission_role_id: 'role-1',
    role_name: 'Role',
    module_name: 'chat',
    action_name: actionName,
  };
}

function queryContainsSectorTerm(query: unknown, sectorId: string): boolean {
  if (Array.isArray(query)) {
    return query.some((item) => queryContainsSectorTerm(item, sectorId));
  }

  if (!query || typeof query !== 'object') {
    return false;
  }

  const record = query as Record<string, unknown>;
  const termQuery = record.term;

  if (termQuery && typeof termQuery === 'object') {
    const sectorTerm = (termQuery as Record<string, unknown>)['sector.id'];
    if (sectorTerm === sectorId) {
      return true;
    }
  }

  return Object.values(record).some((value) =>
    queryContainsSectorTerm(value, sectorId)
  );
}

function buildUseCase(capturedQueries: QueryRecord[]): ChatListerUseCase {
  const emptyElasticResult = {
    hits: {
      total: {
        value: 0,
        relation: 'eq',
      },
      hits: [],
    },
  };

  const elasticDatabaseService = {
    select: jest.fn(async (_index: string, query: QueryRecord) => {
      capturedQueries.push(query);
      return emptyElasticResult;
    }),
  } as unknown as ElasticDatabaseService;

  const chatUserService = {
    viewChatUser: jest.fn(async () => null),
  } as unknown as ChatUserService;

  return new ChatListerUseCase(elasticDatabaseService, chatUserService);
}

describe('ChatListerUseCase', () => {
  it('applies filter_sector_id for users with list_all_chats_in_sector permission', async () => {
    const capturedQueries: QueryRecord[] = [];
    const useCase = buildUseCase(capturedQueries);

    await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        status: EChatStatus.in_chat,
        filter_sector_id: 'sector-1',
      },
      'user-1',
      [
        buildAction(EChatPermissions.chat_access),
        buildAction(EChatPermissions.list_all_chats_in_sector),
      ],
      ['sector-1'],
      []
    );

    expect(capturedQueries.length).toBeGreaterThan(0);
    expect(queryContainsSectorTerm(capturedQueries[0], 'sector-1')).toBe(true);
  });

  it('does not apply explicit sector term without sector/list-all permissions', async () => {
    const capturedQueries: QueryRecord[] = [];
    const useCase = buildUseCase(capturedQueries);

    await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        status: EChatStatus.in_chat,
        filter_sector_id: 'sector-1',
      },
      'user-1',
      [buildAction(EChatPermissions.chat_access)],
      [],
      []
    );

    expect(capturedQueries.length).toBeGreaterThan(0);
    expect(queryContainsSectorTerm(capturedQueries[0], 'sector-1')).toBe(false);
  });
});
