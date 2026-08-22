import {
  classifyOfficialWhatsappProviderTimestampForEffects,
  OFFICIAL_WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS,
  OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS,
  resolveOfficialWhatsappEffectMaxAgeMs,
  resolveOfficialWhatsappFutureToleranceMs,
  resolveOfficialWhatsappInboundTimestamp,
  resolveOfficialWhatsappInboundTimestampWithSource,
  resolveOfficialWhatsappProviderTimestamp,
} from '@core/common/functions/officialWhatsappInboundTimestamp';

describe('resolveOfficialWhatsappInboundTimestamp', () => {
  const now = '2026-08-16T17:30:00.000Z';

  it('keeps Meta authoritative when a webhook is persisted or replayed later', () => {
    expect(
      resolveOfficialWhatsappInboundTimestamp({
        providerTimestamp: '1786800363',
        receivedAt: '2026-08-15T13:26:04.000Z',
        persistedAt: '2026-08-16T17:24:05.959Z',
        now,
      })
    ).toBe('2026-08-15T13:26:03.000Z');
  });

  it('uses ingress time when Meta omits an event timestamp', () => {
    expect(
      resolveOfficialWhatsappInboundTimestamp({
        providerTimestamp: null,
        receivedAt: '2026-08-16T17:24:05.100Z',
        persistedAt: '2026-08-16T17:24:06.000Z',
        now,
      })
    ).toBe('2026-08-16T17:24:05.100Z');
  });

  it('keeps Meta authoritative when only a later persistence time exists', () => {
    expect(
      resolveOfficialWhatsappInboundTimestamp({
        providerTimestamp: '1786800363',
        persistedAt: '2026-08-16T17:24:05.959Z',
        now,
      })
    ).toBe('2026-08-15T13:26:03.000Z');
  });

  it('uses Meta time when UnderChat arrival metadata is unavailable', () => {
    expect(
      resolveOfficialWhatsappInboundTimestamp({
        providerTimestamp: '1786800363',
        now,
      })
    ).toBe('2026-08-15T13:26:03.000Z');
  });

  it('rejects implausible future provider timestamps', () => {
    expect(
      resolveOfficialWhatsappInboundTimestamp({
        providerTimestamp: Date.parse('2026-08-17T17:30:00.000Z'),
        receivedAt: '2026-08-16T17:24:05.100Z',
        now,
      })
    ).toBe('2026-08-16T17:24:05.100Z');
  });

  it('reports which clock supplied the canonical timestamp', () => {
    expect(
      resolveOfficialWhatsappInboundTimestampWithSource({
        providerTimestamp: '1786800363',
        receivedAt: '2026-08-16T17:24:05.100Z',
        now,
      })
    ).toEqual({
      timestamp: '2026-08-15T13:26:03.000Z',
      source: 'provider',
    });
  });

  it('normalizes provider status timestamps without inventing one', () => {
    expect(
      resolveOfficialWhatsappProviderTimestamp(
        '1786800363',
        '2026-08-16T17:24:05.100Z'
      )
    ).toBe('2026-08-15T13:26:03.000Z');
    expect(
      resolveOfficialWhatsappProviderTimestamp(null, '2026-08-16T17:24:05.100Z')
    ).toBeNull();
  });

  it('enforces the exact official effect-time boundaries', () => {
    const nowMs = Date.parse('2026-08-17T22:45:50.000Z');
    const classify = (providerTimestamp: number) =>
      classifyOfficialWhatsappProviderTimestampForEffects({
        providerTimestamp,
        now: nowMs,
        maxAgeMs: OFFICIAL_WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS,
        futureToleranceMs: OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS,
      });

    expect(
      classify(nowMs - OFFICIAL_WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS + 1)
        .accepted
    ).toBe(true);
    expect(
      classify(nowMs - OFFICIAL_WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS)
    ).toEqual(expect.objectContaining({ accepted: false, reason: 'stale' }));
    expect(
      classify(nowMs + OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS).accepted
    ).toBe(true);
    expect(
      classify(nowMs + OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS + 1)
    ).toEqual(expect.objectContaining({ accepted: false, reason: 'future' }));
  });

  it('rejects missing or out-of-range provider clocks and clamps safety limits', () => {
    expect(
      classifyOfficialWhatsappProviderTimestampForEffects({
        providerTimestamp: Number.MAX_VALUE,
        now: Date.now(),
        maxAgeMs: OFFICIAL_WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS,
        futureToleranceMs: OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS,
      })
    ).toEqual({
      accepted: false,
      reason: 'missing',
      providerTimestampMs: null,
      ageMs: null,
    });
    expect(
      resolveOfficialWhatsappEffectMaxAgeMs(30 * 24 * 60 * 60 * 1000)
    ).toBe(OFFICIAL_WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS);
    expect(resolveOfficialWhatsappFutureToleranceMs(24 * 60 * 60 * 1000)).toBe(
      OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS
    );
  });
});
