import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class ElasticDatabaseService {},
}));

jest.mock('@core/services/chatUser.service', () => ({
  ChatUserService: class ChatUserService {},
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import type { EPermissionsRoles } from '@core/common/enums/EPermissions';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import type { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import type { ChatUserService } from '@core/services/chatUser.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ChatSearcherUseCase } from '@core/useCases/chat/ChatSearcher.useCase';

function buildAction(actionName: EPermissionsRoles): IJwtGroupHierarchy {
  return {
    account_id: 'account-1',
    permission_role_id: 'role-1',
    role_name: 'Role',
    module_name: 'chat',
    action_name: actionName,
  };
}

function emptyElasticResult() {
  return {
    hits: {
      total: {
        value: 0,
        relation: 'eq',
      },
      hits: [],
    },
  };
}

describe('ChatSearcherUseCase', () => {
  it('limits closed chat history search to readable chats in the user sector', async () => {
    const elasticDatabaseService = {
      select: jest.fn().mockResolvedValue(emptyElasticResult()),
    } as unknown as ElasticDatabaseService;
    const chatUserService = {
      viewChatUser: jest.fn(),
    } as unknown as ChatUserService;
    const useCase = new ChatSearcherUseCase(
      elasticDatabaseService,
      chatUserService
    );

    await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: '',
        status: EChatStatus.closed,
        filter_phone: '+5561999999999',
        sort_field: 'closed_at',
        sort_order: 'desc',
      },
      'user-1',
      [buildAction(EChatPermissions.list_all_chats_in_sector)],
      ['sector-allowed'],
      []
    );

    const firstSelectCall = (elasticDatabaseService.select as jest.Mock).mock
      .calls[0];
    expect(firstSelectCall[0]).toBe(EElasticIndex.chat);

    const queryJson = JSON.stringify(firstSelectCall[1]);
    expect(queryJson).toContain('"status":"closed"');
    expect(queryJson).toContain('"sector.id":["sector-allowed"]');
    expect(queryJson).not.toContain('sector-blocked');
  });

  it('filters unread conversations in search and count queries', async () => {
    const elasticDatabaseService = {
      select: jest.fn().mockResolvedValue(emptyElasticResult()),
    } as unknown as ElasticDatabaseService;
    const chatUserService = {
      viewChatUser: jest.fn(),
    } as unknown as ChatUserService;
    const useCase = new ChatSearcherUseCase(
      elasticDatabaseService,
      chatUserService
    );

    await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: '',
        status: EChatStatus.queue,
        filter_unread_conversations: true,
        sort_field: 'summary.last_message',
        sort_order: 'desc',
      },
      'user-1',
      [buildAction(EChatPermissions.chat_group)],
      [],
      []
    );

    const selectCalls = (elasticDatabaseService.select as jest.Mock).mock.calls;
    expect(selectCalls[0][0]).toBe(EElasticIndex.chat);

    const initialQueryJson = JSON.stringify(selectCalls[0][1]);
    expect(initialQueryJson).toContain('"path":"summary"');
    expect(initialQueryJson).toContain('"summary.unread_count":{"gt":0}');

    const countQueryJson = JSON.stringify(selectCalls[1][1]);
    expect(countQueryJson).toContain('"path":"summary"');
    expect(countQueryJson).toContain('"summary.unread_count":{"gt":0}');
  });
});
