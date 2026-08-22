import {
  MESSAGE_SEND_RESERVATION_LEASE_MARGIN_MS,
  resolveMessageSendPreProviderTimeoutMs,
  resolveMessageSendReservationLeaseMs,
} from '@core/common/functions/messageSendPreProviderBudget';

describe('message send pre-provider budget', () => {
  it('covers maximum typing, provider reserve, bounded preparation and margin', () => {
    const timeoutMs = resolveMessageSendPreProviderTimeoutMs({
      typingSimulationMaxDelayMs: 60_000,
      providerTimeoutMs: 45_000,
      preparationTimeoutMs: 45_000,
    });

    expect(timeoutMs).toBe(160_000);
    expect(resolveMessageSendReservationLeaseMs(timeoutMs, 600_000)).toBe(
      timeoutMs + MESSAGE_SEND_RESERVATION_LEASE_MARGIN_MS
    );
  });

  it('is deterministic and cannot drift through environment configuration', () => {
    const input = {
      typingSimulationMaxDelayMs: 60_000,
      providerTimeoutMs: 45_000,
      preparationTimeoutMs: 45_000,
    };
    process.env.MESSAGE_SEND_PRE_PROVIDER_TIMEOUT_MS = '999999';
    expect(resolveMessageSendPreProviderTimeoutMs(input)).toBe(160_000);
    delete process.env.MESSAGE_SEND_PRE_PROVIDER_TIMEOUT_MS;
  });

  it('keeps the maximum supported component budgets inside the reservation lease', () => {
    const timeoutMs = resolveMessageSendPreProviderTimeoutMs({
      typingSimulationMaxDelayMs: 60_000,
      providerTimeoutMs: 120_000,
      preparationTimeoutMs: 300_000,
    });
    const leaseMs = resolveMessageSendReservationLeaseMs(timeoutMs, 600_000);

    expect(timeoutMs).toBe(490_000);
    expect(leaseMs).toBe(520_000);
    expect(leaseMs - timeoutMs).toBe(MESSAGE_SEND_RESERVATION_LEASE_MARGIN_MS);
  });
});
