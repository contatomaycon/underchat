import 'reflect-metadata';

import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';

describe('ElasticDatabaseService', () => {
  it('detects Elasticsearch read-only allow-delete cluster block errors', () => {
    const service = new ElasticDatabaseService({} as never);

    expect(
      service.isReadOnlyAllowDeleteBlockError(
        new Error('cluster_block_exception index read-only-allow-delete')
      )
    ).toBe(true);
    expect(
      service.isReadOnlyAllowDeleteBlockError(new Error('connection refused'))
    ).toBe(false);
  });
});
