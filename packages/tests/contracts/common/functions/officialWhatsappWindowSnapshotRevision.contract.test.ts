import {
  hasApplicableIncomingOfficialWhatsappWindowSnapshot,
  selectNewestOfficialWhatsappWindowSnapshot,
} from '@core/common/functions/officialWhatsappWindowSnapshotRevision';
import type { IOfficialWhatsappConversationWindowSnapshot } from '@core/common/interfaces/IOfficialWhatsappConversationWindow';

const openWindow: IOfficialWhatsappConversationWindowSnapshot = {
  is_official: true,
  state: 'open',
  reason: 'customer_service_window_open',
  can_send_freeform: true,
  can_send_template: true,
  updated_at: '2026-08-16T17:24:05.100Z',
};

describe('official WhatsApp window snapshot revision', () => {
  it('applies a newer Meta 131047 closure to the active chat', () => {
    const metaClosure: IOfficialWhatsappConversationWindowSnapshot = {
      ...openWindow,
      state: 'closed',
      reason: 'meta_reengagement',
      can_send_freeform: false,
      last_meta_error_code: 131047,
      closed_reason: 'meta_reengagement',
      updated_at: '2026-08-16T17:25:00.000Z',
    };

    expect(
      hasApplicableIncomingOfficialWhatsappWindowSnapshot(
        openWindow,
        metaClosure
      )
    ).toBe(true);
    expect(
      selectNewestOfficialWhatsappWindowSnapshot(openWindow, metaClosure)
    ).toBe(metaClosure);
  });

  it('does not regress an inbound-opened window from an older closure event', () => {
    const oldClosure: IOfficialWhatsappConversationWindowSnapshot = {
      ...openWindow,
      state: 'closed',
      reason: 'meta_reengagement',
      can_send_freeform: false,
      last_meta_error_code: 131047,
      updated_at: '2026-08-16T17:23:00.000Z',
    };

    expect(
      hasApplicableIncomingOfficialWhatsappWindowSnapshot(
        openWindow,
        oldClosure
      )
    ).toBe(false);
    expect(
      selectNewestOfficialWhatsappWindowSnapshot(openWindow, oldClosure)
    ).toBe(openWindow);
  });

  it('keeps last-arrival compatibility only for legacy unversioned snapshots', () => {
    const legacyClosed = {
      ...openWindow,
      state: 'closed' as const,
      reason: 'customer_service_window_closed' as const,
      can_send_freeform: false,
      updated_at: null,
    };
    const legacyOpen = { ...openWindow, updated_at: null };

    expect(
      selectNewestOfficialWhatsappWindowSnapshot(legacyClosed, legacyOpen)
    ).toBe(legacyOpen);
  });
});
