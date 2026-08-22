import { extractIndexedMultipartValues } from '@core/common/functions/extractIndexedMultipartValues';

describe('extractIndexedMultipartValues contract', () => {
  it('orders indexed fields without allocating a sparse array', () => {
    const input = {
      'sector_ids[4294967294]': { value: 'last' },
      'sector_ids[2]': { value: 'third' },
      'sector_ids[0]': { value: 'first' },
      'sector_ids[1]': 'second',
    };

    expect(extractIndexedMultipartValues(input, 'sector_ids')).toEqual([
      'first',
      'second',
      'third',
      'last',
    ]);
  });

  it('ignores unsafe indexes, empty values and unrelated fields', () => {
    const input = {
      'channel_ids[9007199254740992]': { value: 'unsafe' },
      'channel_ids[0]': { value: '' },
      'channel_ids[1]': { value: 'channel-1' },
      'sector_ids[0]': { value: 'sector-1' },
    };

    expect(extractIndexedMultipartValues(input, 'channel_ids')).toEqual([
      'channel-1',
    ]);
  });
});
