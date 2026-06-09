import 'reflect-metadata';

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    warn: jest.fn(),
  },
}));

import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import {
  createRequestLatencyContext,
  runWithRequestLatencyContext,
} from '@core/plugins/telemetry/requestLatency';
import { logger } from '@core/plugins/telemetry/logger';

describe('ElasticDatabaseService.select', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('returns search response and records request latency metadata', async () => {
    const search = jest.fn().mockResolvedValue({
      took: 5,
      timed_out: false,
      hits: {
        total: {
          value: 2,
          relation: 'eq',
        },
        hits: [{ _source: { id: 'message-1' } }],
      },
    });
    const service = new ElasticDatabaseService({ search } as never);
    const context = createRequestLatencyContext();

    const result = await runWithRequestLatencyContext(context, () =>
      service.select('message', { query: { match_all: {} } })
    );

    expect(result).not.toBeNull();
    expect(search).toHaveBeenCalledWith({
      index: 'message',
      body: { query: { match_all: {} } },
    });
    expect(context.stages).toEqual([
      expect.objectContaining({
        name: 'elastic.select',
        index: 'message',
        ok: true,
        took: 5,
        timed_out: false,
        hits_total: 2,
        hit_count: 1,
      }),
    ]);
  });

  it('keeps returning null on select errors and records the failure', async () => {
    const search = jest.fn().mockRejectedValue(new Error('timeout exceeded'));
    const service = new ElasticDatabaseService({ search } as never);
    const context = createRequestLatencyContext();

    const result = await runWithRequestLatencyContext(context, () =>
      service.select('message', { query: { match_all: {} } })
    );

    expect(result).toBeNull();
    expect(context.stages).toEqual([
      expect.objectContaining({
        name: 'elastic.select',
        index: 'message',
        ok: false,
        error: 'timeout exceeded',
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'elastic_select_error',
        index: 'message',
      }),
      'Elasticsearch select failed'
    );
  });

  it('logs slow select operations with safe metadata only', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2501);

    const search = jest.fn().mockResolvedValue({
      took: 1200,
      timed_out: false,
      hits: {
        total: 1,
        hits: [{ _source: { id: 'message-1' } }],
      },
    });
    const service = new ElasticDatabaseService({ search } as never);

    await service.select('message', { query: { match_all: {} } });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'elastic_select_slow',
        index: 'message',
        duration: 1501,
        took: 1200,
        timed_out: false,
        hits_total: 1,
        hit_count: 1,
      }),
      'Elasticsearch select was slow'
    );
  });
});
