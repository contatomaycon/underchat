import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';

describe('buildWppConnectionDocumentId', () => {
  it('builds account and worker compound id', () => {
    expect(buildWppConnectionDocumentId('acc-1', 'worker-2')).toBe(
      'acc-1:worker-2'
    );
  });
});
