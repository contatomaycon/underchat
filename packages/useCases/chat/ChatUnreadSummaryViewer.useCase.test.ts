import 'reflect-metadata';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import type { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ChatUnreadSummaryViewerUseCase } from './ChatUnreadSummaryViewer.useCase';

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

function queryContainsStatus(query: unknown, status: EChatStatus): boolean {
  if (Array.isArray(query)) {
    return query.some((item) => queryContainsStatus(item, status));
  }

  if (!query || typeof query !== 'object') {
    return false;
  }

  const record = query as Record<string, unknown>;
  const termQuery = record.term;
  const termsQuery = record.terms;

  if (
    termQuery &&
    typeof termQuery === 'object' &&
    (termQuery as Record<string, unknown>).status === status
  ) {
    return true;
  }

  if (termsQuery && typeof termsQuery === 'object') {
    const statuses = (termsQuery as Record<string, unknown>).status;
    if (Array.isArray(statuses) && statuses.includes(status)) {
      return true;
    }
  }

  return Object.values(record).some((value) =>
    queryContainsStatus(value, status)
  );
}

function queryContainsTermValue(
  query: unknown,
  field: string,
  expected: string
): boolean {
  if (Array.isArray(query)) {
    return query.some((item) => queryContainsTermValue(item, field, expected));
  }

  if (!query || typeof query !== 'object') {
    return false;
  }

  const record = query as Record<string, unknown>;
  const termQuery = record.term;
  const termsQuery = record.terms;

  if (termQuery && typeof termQuery === 'object') {
    if ((termQuery as Record<string, unknown>)[field] === expected) {
      return true;
    }
  }

  if (termsQuery && typeof termsQuery === 'object') {
    const values = (termsQuery as Record<string, unknown>)[field];
    if (Array.isArray(values) && values.includes(expected)) {
      return true;
    }
  }

  return Object.values(record).some((value) =>
    queryContainsTermValue(value, field, expected)
  );
}

function buildUseCase(result: unknown): {
  useCase: ChatUnreadSummaryViewerUseCase;
  select: jest.Mock;
} {
  const select = jest.fn(async () => result);
  const elasticDatabaseService = {
    select,
  } as unknown as ElasticDatabaseService;

  return {
    useCase: new ChatUnreadSummaryViewerUseCase(elasticDatabaseService),
    select,
  };
}

describe('ChatUnreadSummaryViewerUseCase', () => {
  it('sums unread_count with account, active menu statuses and channel filters', async () => {
    const { useCase, select } = buildUseCase({
      aggregations: {
        summary: {
          unread_total: {
            value: 12,
          },
        },
      },
    });

    await expect(
      useCase.execute(
        'account-1',
        'user-1',
        [buildAction(EGeneralPermissions.full_access)],
        [],
        [{ id: 'worker-1', name: 'Worker' }]
      )
    ).resolves.toEqual({ unread_count: 12 });

    expect(select).toHaveBeenCalledWith(
      EElasticIndex.chat,
      expect.objectContaining({
        size: 0,
        aggs: {
          summary: {
            nested: {
              path: 'summary',
            },
            aggs: {
              unread_total: {
                sum: {
                  field: 'summary.unread_count',
                },
              },
            },
          },
        },
      })
    );

    const query = select.mock.calls[0][1] as QueryRecord;
    expect(queryContainsTermValue(query, 'account.id', 'account-1')).toBe(true);
    expect(queryContainsTermValue(query, 'worker.id', 'worker-1')).toBe(true);
    expect(queryContainsStatus(query, EChatStatus.closed)).toBe(false);
    expect(queryContainsStatus(query, EChatStatus.queue)).toBe(true);
    expect(queryContainsStatus(query, EChatStatus.in_chat)).toBe(true);
    expect(queryContainsStatus(query, EChatStatus.ura_webhook)).toBe(true);
  });

  it('applies participant and sector visibility for restricted users', async () => {
    const { useCase, select } = buildUseCase({
      aggregations: {
        summary: {
          unread_total: {
            value: 3,
          },
        },
      },
    });

    await useCase.execute(
      'account-1',
      'user-1',
      [buildAction(EChatPermissions.chat_access)],
      ['sector-1'],
      []
    );

    const query = select.mock.calls[0][1] as QueryRecord;
    expect(queryContainsTermValue(query, 'user.id', 'user-1')).toBe(true);
    expect(queryContainsTermValue(query, 'secondary_users.id', 'user-1')).toBe(
      true
    );
    expect(queryContainsTermValue(query, 'sector.id', 'sector-1')).toBe(true);
    expect(queryContainsStatus(query, EChatStatus.closed)).toBe(false);
  });

  it('returns zero when Elasticsearch result or aggregation is missing', async () => {
    const { useCase } = buildUseCase({ aggregations: {} });

    await expect(
      useCase.execute(
        'account-1',
        'user-1',
        [buildAction(EChatPermissions.chat_access)],
        [],
        []
      )
    ).resolves.toEqual({ unread_count: 0 });
  });
});
