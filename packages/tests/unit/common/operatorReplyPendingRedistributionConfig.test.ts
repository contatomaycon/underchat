import {
  defaultOperatorReplyPendingRedistributionConfig,
  isOperatorReplyPendingRedistributionSectorInScope,
  normalizeOperatorReplyPendingRedistributionSectorIds,
  parseOperatorReplyPendingRedistributionConfig,
} from '@core/common/functions/operatorReplyPendingRedistributionConfig';

describe('operatorReplyPendingRedistributionConfig', () => {
  it('uses disabled and 15 minutes by default', () => {
    expect(defaultOperatorReplyPendingRedistributionConfig()).toEqual({
      enabled: false,
      time_minutes: 15,
      sector_ids: [],
    });
    expect(parseOperatorReplyPendingRedistributionConfig(undefined)).toEqual({
      enabled: false,
      time_minutes: 15,
      sector_ids: [],
    });
  });

  it('tolerates legacy, invalid and partial persisted values', () => {
    expect(
      parseOperatorReplyPendingRedistributionConfig('not-json', true)
    ).toEqual({ enabled: true, time_minutes: 15, sector_ids: [] });
    expect(parseOperatorReplyPendingRedistributionConfig('{}', true)).toEqual({
      enabled: true,
      time_minutes: 15,
      sector_ids: [],
    });
    expect(
      parseOperatorReplyPendingRedistributionConfig(
        JSON.stringify({ time_minutes: '7' }),
        true
      )
    ).toEqual({ enabled: true, time_minutes: 7, sector_ids: [] });
    expect(
      parseOperatorReplyPendingRedistributionConfig(
        JSON.stringify({ time_minutes: 0 }),
        false
      )
    ).toEqual({ enabled: false, time_minutes: 1, sector_ids: [] });
  });

  it('normalizes persisted sector ids while preserving their order', () => {
    expect(
      normalizeOperatorReplyPendingRedistributionSectorIds([
        ' sector-2 ',
        'sector-1',
        'sector-2',
        '',
        null,
      ])
    ).toEqual(['sector-2', 'sector-1']);

    expect(
      parseOperatorReplyPendingRedistributionConfig(
        JSON.stringify({
          time_minutes: 10,
          sector_ids: ['sector-1', 'sector-2', 'sector-1'],
        }),
        true
      )
    ).toEqual({
      enabled: true,
      time_minutes: 10,
      sector_ids: ['sector-1', 'sector-2'],
    });
  });

  it('treats an empty sector list as global and a populated list as scoped', () => {
    expect(
      isOperatorReplyPendingRedistributionSectorInScope(
        { sector_ids: [] },
        undefined
      )
    ).toBe(true);
    expect(
      isOperatorReplyPendingRedistributionSectorInScope(
        { sector_ids: ['sector-1', 'sector-2'] },
        'sector-2'
      )
    ).toBe(true);
    expect(
      isOperatorReplyPendingRedistributionSectorInScope(
        { sector_ids: ['sector-1', 'sector-2'] },
        'sector-3'
      )
    ).toBe(false);
  });
});
