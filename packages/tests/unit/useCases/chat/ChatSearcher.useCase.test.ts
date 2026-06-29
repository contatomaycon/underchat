import 'reflect-metadata';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { MY_CHATS_STATUS } from '@core/schema/chat/listChats/request.schema';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import type { ChatUserService } from '@core/services/chatUser.service';
import type { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { ChatSearcherUseCase } from '@core/useCases/chat/ChatSearcher.useCase';

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

function buildChat(overrides: Partial<ListChatsResult> = {}): ListChatsResult {
  return {
    chat_id: 'chat-1',
    summary: null,
    account: { id: 'account-1', name: 'Account' },
    worker: { id: 'worker-1', name: 'WhatsApp' },
    sector: null,
    user: null,
    secondary_users: [],
    contact: {
      id: 'contact-1',
      name: 'Marilda',
      phone: '5511999999999',
      phone_ddi: '55',
      photo: null,
    },
    photo: null,
    name: 'Marilda',
    phone: '5511999999999',
    status: EChatStatus.in_chat,
    date: '2026-04-20T12:00:00.000Z',
    label: [],
    ...overrides,
  };
}

function isRecord(value: unknown): value is QueryRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined || value === null ? [] : [value];
}

function normalizeField(field: string): string {
  return field
    .split('.')
    .filter((item) => item !== 'keyword')
    .join('.');
}

function getFieldValues(source: unknown, field: string): unknown[] {
  const parts = normalizeField(field).split('.');
  let currentValues: unknown[] = [source];

  for (const part of parts) {
    currentValues = currentValues.flatMap((value) => {
      if (Array.isArray(value)) {
        return value.flatMap((item) => getFieldValues(item, part));
      }

      if (!isRecord(value)) {
        return [];
      }

      return [value[part]];
    });
  }

  return currentValues.filter(
    (value) => value !== undefined && value !== null && value !== ''
  );
}

function matchTerm(doc: ListChatsResult, term: QueryRecord): boolean {
  return Object.entries(term).every(([field, expected]) =>
    getFieldValues(doc, field).some((value) => value === expected)
  );
}

function matchTerms(doc: ListChatsResult, terms: QueryRecord): boolean {
  return Object.entries(terms).every(([field, expected]) => {
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    return getFieldValues(doc, field).some((value) =>
      expectedValues.includes(value)
    );
  });
}

function matchExists(doc: ListChatsResult, exists: QueryRecord): boolean {
  const field = exists.field;
  return typeof field === 'string' && getFieldValues(doc, field).length > 0;
}

function matchWildcard(doc: ListChatsResult, wildcard: QueryRecord): boolean {
  return Object.entries(wildcard).every(([field, config]) => {
    const rawValue = isRecord(config) ? config.value : config;
    if (typeof rawValue !== 'string') {
      return false;
    }

    const needle = rawValue.replaceAll('*', '').toLowerCase();
    if (needle.length === 0) {
      return true;
    }

    return getFieldValues(doc, field).some((value) =>
      String(value).toLowerCase().includes(needle)
    );
  });
}

function matchQueryString(
  doc: ListChatsResult,
  queryString: QueryRecord
): boolean {
  const field = queryString.default_field;
  const query = queryString.query;

  if (typeof field !== 'string' || typeof query !== 'string') {
    return false;
  }

  const needle = query.replaceAll('*', '').toLowerCase();
  if (needle.length === 0) {
    return true;
  }

  return getFieldValues(doc, field).some((value) =>
    String(value).toLowerCase().includes(needle)
  );
}

function matchBool(doc: ListChatsResult, boolQuery: QueryRecord): boolean {
  const mustClauses = asArray(boolQuery.must);
  const filterClauses = asArray(boolQuery.filter);
  const shouldClauses = asArray(boolQuery.should);
  const mustNotClauses = asArray(boolQuery.must_not);
  const minimumShouldMatch =
    typeof boolQuery.minimum_should_match === 'number'
      ? boolQuery.minimum_should_match
      : shouldClauses.length > 0
        ? 1
        : 0;

  if (!mustClauses.every((clause) => matchClause(doc, clause))) {
    return false;
  }

  if (!filterClauses.every((clause) => matchClause(doc, clause))) {
    return false;
  }

  if (mustNotClauses.some((clause) => matchClause(doc, clause))) {
    return false;
  }

  const matchedShouldClauses = shouldClauses.filter((clause) =>
    matchClause(doc, clause)
  ).length;

  return matchedShouldClauses >= minimumShouldMatch;
}

function matchClause(doc: ListChatsResult, clause: unknown): boolean {
  if (!isRecord(clause)) {
    return true;
  }

  if (isRecord(clause.bool)) {
    return matchBool(doc, clause.bool);
  }

  if (isRecord(clause.nested)) {
    const nestedQuery = clause.nested.query;
    return matchClause(doc, nestedQuery);
  }

  if (isRecord(clause.term)) {
    return matchTerm(doc, clause.term);
  }

  if (isRecord(clause.terms)) {
    return matchTerms(doc, clause.terms);
  }

  if (isRecord(clause.exists)) {
    return matchExists(doc, clause.exists);
  }

  if (isRecord(clause.wildcard)) {
    return matchWildcard(doc, clause.wildcard);
  }

  if (isRecord(clause.query_string)) {
    return matchQueryString(doc, clause.query_string);
  }

  if (isRecord(clause.range)) {
    return true;
  }

  return true;
}

function matchElasticQuery(doc: ListChatsResult, query: unknown): boolean {
  if (!isRecord(query)) {
    return true;
  }

  const queryClause = isRecord(query.query) ? query.query : query;
  return matchClause(doc, queryClause);
}

function buildUseCase(chats: ListChatsResult[]): ChatSearcherUseCase {
  const elasticDatabaseService = {
    select: jest.fn(async (_index: string, query: QueryRecord) => {
      const matchedChats = chats.filter((chat) =>
        matchElasticQuery(chat, query)
      );
      const from = typeof query.from === 'number' ? query.from : 0;
      const size = typeof query.size === 'number' ? query.size : 10;
      const selectedChats =
        size === 0 ? [] : matchedChats.slice(from, from + size);

      return {
        hits: {
          total: {
            value: matchedChats.length,
            relation: 'eq',
          },
          hits: selectedChats.map((chat) => ({
            _id: chat.chat_id,
            _source: chat,
          })),
        },
      };
    }),
  } as unknown as ElasticDatabaseService;

  const chatUserService = {
    viewChatUser: jest.fn(async () => null),
  } as unknown as ChatUserService;

  return new ChatSearcherUseCase(elasticDatabaseService, chatUserService);
}

describe('ChatSearcherUseCase', () => {
  const deniedChat = buildChat({
    chat_id: 'denied-chat',
    name: 'Marilda Sem Acesso',
    user: null,
    secondary_users: [],
    sector: null,
    status: EChatStatus.in_chat,
  });

  const ownChat = buildChat({
    chat_id: 'own-chat',
    name: 'Marilda Permitida',
    user: {
      id: 'user-1',
      name: 'User One',
      photo: null,
      entered_at: null,
    },
    secondary_users: [],
    sector: null,
    status: EChatStatus.in_chat,
  });

  it('does not return unreadable chats when global search has no status', async () => {
    const useCase = buildUseCase([deniedChat, ownChat]);

    const result = await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: 'marilda',
      },
      'user-1',
      [buildAction(EChatPermissions.chat_access)],
      ['sector-1'],
      []
    );

    expect(result.results.map((chat) => chat.chat_id)).toEqual(['own-chat']);
    expect(result.pagings.total).toBe(1);
    expect(result.counts.in_chat).toBe(1);
  });

  it('does not return unassigned no-sector queue chats for restricted users with sectors', async () => {
    const natanQueueChat = buildChat({
      chat_id: 'natan-queue-chat',
      name: 'Bot NATAN',
      user: null,
      secondary_users: [],
      sector: null,
      status: EChatStatus.queue,
    });
    const useCase = buildUseCase([natanQueueChat]);

    const result = await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: 'natan',
      },
      'user-1',
      [buildAction(EChatPermissions.chat_access)],
      ['sector-1'],
      []
    );

    expect(result.results).toEqual([]);
    expect(result.pagings.total).toBe(0);
    expect(result.counts.queue).toBe(0);
  });

  it('keeps status searches restricted by the same read policy', async () => {
    const useCase = buildUseCase([deniedChat, ownChat]);

    const result = await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: 'marilda',
        status: EChatStatus.in_chat,
      },
      'user-1',
      [buildAction(EChatPermissions.chat_access)],
      ['sector-1'],
      []
    );

    expect(result.results.map((chat) => chat.chat_id)).toEqual(['own-chat']);
    expect(result.pagings.total).toBe(1);
  });

  it('allows unrestricted users to find every matching chat', async () => {
    const useCase = buildUseCase([deniedChat, ownChat]);

    const result = await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: 'marilda',
      },
      'user-1',
      [buildAction(EGeneralPermissions.full_access)],
      [],
      []
    );

    expect(result.results.map((chat) => chat.chat_id)).toEqual([
      'denied-chat',
      'own-chat',
    ]);
    expect(result.pagings.total).toBe(2);
    expect(result.counts.in_chat).toBe(2);
  });

  it('applies filter_sector_id for users with list_all_chats_in_sector permission', async () => {
    const sectorOneChat = buildChat({
      chat_id: 'sector-one-chat',
      name: 'Atendimento Setor',
      sector: {
        id: 'sector-1',
        name: 'Setor 1',
        color: '#111111',
      },
      status: EChatStatus.in_chat,
    });
    const sectorTwoChat = buildChat({
      chat_id: 'sector-two-chat',
      name: 'Atendimento Setor',
      sector: {
        id: 'sector-2',
        name: 'Setor 2',
        color: '#222222',
      },
      status: EChatStatus.in_chat,
    });

    const useCase = buildUseCase([sectorOneChat, sectorTwoChat]);

    const result = await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: 'atendimento setor',
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

    expect(result.results.map((chat) => chat.chat_id)).toEqual([
      'sector-one-chat',
    ]);
    expect(result.pagings.total).toBe(1);
  });

  it('does not leak chats from other sectors when filtering with sector-scoped permission', async () => {
    const sectorOneChat = buildChat({
      chat_id: 'sector-one-safe-chat',
      name: 'Filtro Seguro',
      sector: {
        id: 'sector-1',
        name: 'Setor 1',
        color: '#111111',
      },
      status: EChatStatus.in_chat,
    });
    const sectorTwoChat = buildChat({
      chat_id: 'sector-two-forbidden-chat',
      name: 'Filtro Seguro',
      sector: {
        id: 'sector-2',
        name: 'Setor 2',
        color: '#222222',
      },
      status: EChatStatus.in_chat,
    });

    const useCase = buildUseCase([sectorOneChat, sectorTwoChat]);

    const result = await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: 'filtro seguro',
        status: EChatStatus.in_chat,
        filter_sector_id: 'sector-2',
      },
      'user-1',
      [
        buildAction(EChatPermissions.chat_access),
        buildAction(EChatPermissions.list_all_chats_in_sector),
      ],
      ['sector-1'],
      []
    );

    expect(result.results).toEqual([]);
    expect(result.pagings.total).toBe(0);
  });

  it('finds a full formatted phone with BR normalization (with/without DDI and 9th digit)', async () => {
    const formattedPhoneChat = buildChat({
      chat_id: 'formatted-phone-chat',
      name: 'Contato Telefone',
      phone: '5561993399580',
      contact: {
        id: 'contact-formatted-phone',
        name: 'Contato Telefone',
        phone: '5561993399580',
        phone_ddi: '55',
        photo: null,
      },
    });

    const useCase = buildUseCase([formattedPhoneChat]);

    const result = await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: '(61) 9339-9580',
      },
      'user-1',
      [buildAction(EGeneralPermissions.full_access)],
      [],
      []
    );

    expect(result.results.map((chat) => chat.chat_id)).toEqual([
      'formatted-phone-chat',
    ]);
  });

  it('applies filter_phone with formatted full phone consistently', async () => {
    const matchingChat = buildChat({
      chat_id: 'matching-filter-phone',
      name: 'Match Phone',
      phone: '5561993399580',
      contact: {
        id: 'contact-matching-filter-phone',
        name: 'Match Phone',
        phone: '5561993399580',
        phone_ddi: '55',
        photo: null,
      },
    });
    const nonMatchingChat = buildChat({
      chat_id: 'non-matching-filter-phone',
      name: 'Other Phone',
      phone: '5511999999999',
      contact: {
        id: 'contact-non-matching-filter-phone',
        name: 'Other Phone',
        phone: '5511999999999',
        phone_ddi: '55',
        photo: null,
      },
    });

    const useCase = buildUseCase([matchingChat, nonMatchingChat]);

    const result = await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: '',
        status: EChatStatus.in_chat,
        filter_phone: '(61) 9339-9580',
      },
      'user-1',
      [buildAction(EGeneralPermissions.full_access)],
      [],
      []
    );

    expect(result.results.map((chat) => chat.chat_id)).toEqual([
      'matching-filter-phone',
    ]);
  });

  it('returns only closed chats when search uses status=closed', async () => {
    const closedChat = buildChat({
      chat_id: 'closed-chat-only',
      name: 'Contato Fechado',
      status: EChatStatus.closed,
    });
    const inChat = buildChat({
      chat_id: 'in-chat-not-closed',
      name: 'Contato Fechado',
      status: EChatStatus.in_chat,
    });

    const useCase = buildUseCase([closedChat, inChat]);

    const result = await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: 'contato fechado',
        status: EChatStatus.closed,
      },
      'user-1',
      [buildAction(EGeneralPermissions.full_access)],
      [],
      []
    );

    expect(result.results.map((chat) => chat.chat_id)).toEqual([
      'closed-chat-only',
    ]);
    expect(
      result.results.every((chat) => chat.status === EChatStatus.closed)
    ).toBe(true);
  });

  it('returns only queue and in_chat participants when status=my_chats', async () => {
    const myInChat = buildChat({
      chat_id: 'my-in-chat',
      name: 'Meu Atendimento In Chat',
      status: EChatStatus.in_chat,
      user: {
        id: 'user-1',
        name: 'User One',
        photo: null,
        entered_at: null,
      },
    });
    const myQueue = buildChat({
      chat_id: 'my-queue',
      name: 'Meu Atendimento Fila',
      status: EChatStatus.queue,
      user: {
        id: 'user-1',
        name: 'User One',
        photo: null,
        entered_at: null,
      },
    });
    const myClosed = buildChat({
      chat_id: 'my-closed',
      name: 'Meu Atendimento Fechado',
      status: EChatStatus.closed,
      user: {
        id: 'user-1',
        name: 'User One',
        photo: null,
        entered_at: null,
      },
    });
    const otherQueue = buildChat({
      chat_id: 'other-queue',
      name: 'Outro Atendimento Fila',
      status: EChatStatus.queue,
      user: {
        id: 'user-2',
        name: 'User Two',
        photo: null,
        entered_at: null,
      },
    });

    const useCase = buildUseCase([myInChat, myQueue, myClosed, otherQueue]);

    const result = await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        search: 'atendimento',
        status: MY_CHATS_STATUS,
      },
      'user-1',
      [buildAction(EGeneralPermissions.full_access)],
      [],
      []
    );

    expect(result.results).toHaveLength(2);
    expect(result.results.map((chat) => chat.chat_id)).toEqual(
      expect.arrayContaining(['my-in-chat', 'my-queue'])
    );
    expect(
      result.results.every((chat) =>
        [EChatStatus.in_chat, EChatStatus.queue].includes(
          chat.status as EChatStatus
        )
      )
    ).toBe(true);
  });
});
