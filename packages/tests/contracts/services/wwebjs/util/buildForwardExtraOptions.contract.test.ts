import { buildForwardExtraOptions } from '@core/services/wwebjs/util/buildForwardExtraOptions';

describe('buildForwardExtraOptions', () => {
  it('returns undefined when context info does not exist', () => {
    expect(
      buildForwardExtraOptions({ content: null } as never)
    ).toBeUndefined();
  });

  it('builds options from forwarding_score variants', () => {
    expect(
      buildForwardExtraOptions({
        content: { context_info: { forwarding_score: '3' } },
      } as never)
    ).toEqual({
      isForwarded: true,
      forwardingScore: 3,
    });

    expect(
      buildForwardExtraOptions({
        content: { context_info: { forwardingScore: 2, isForwarded: true } },
      } as never)
    ).toEqual({
      isForwarded: true,
      forwardingScore: 2,
    });
  });

  it('falls back to minimum forwarding score 1 when no score is valid', () => {
    expect(
      buildForwardExtraOptions({
        content: { context_info: { is_forwarded: true, forwarding_score: 0 } },
      } as never)
    ).toEqual({
      isForwarded: true,
      forwardingScore: 1,
    });
  });
});
