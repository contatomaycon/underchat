import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import type { IOfficialWhatsappConversationWindowSnapshot } from '@core/common/interfaces/IOfficialWhatsappConversationWindow';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { OfficialOpeningContextViewerUseCase } from '@core/useCases/chat/OfficialOpeningContextViewer.useCase';

const closedWindow: IOfficialWhatsappConversationWindowSnapshot = {
  is_official: true,
  state: 'closed',
  reason: 'no_customer_message',
  can_send_freeform: false,
  can_send_template: true,
  service_window_started_at: null,
  last_inbound_at: null,
  service_window_expires_at: null,
};

function makeUseCase(
  window: IOfficialWhatsappConversationWindowSnapshot = closedWindow
) {
  const metaWhatsappEmbeddedService = {
    listApprovedMessageTemplates: jest.fn(async () => []),
  };
  const officialWindowService = {
    resolveAuthoritativeForIdentity: jest.fn(async () => window),
  };
  const useCase = new OfficialOpeningContextViewerUseCase(
    {
      viewContactById: jest.fn(async () => ({
        contact_id: 'contact-1',
        phone_ddi: '55',
      })),
      getContactSensitiveDataDecrypted: jest.fn(async () => ({
        phone: '11999999999',
      })),
    } as never,
    {
      viewWorkerType: jest.fn(async () => ({
        worker_type_id: EWorkerType.whatsapp,
      })),
    } as never,
    { decrypt: jest.fn(() => 'plain-token') } as never,
    metaWhatsappEmbeddedService as never,
    { normalizeTemplates: jest.fn((templates) => templates) } as never,
    {
      findActiveByWorkerId: jest.fn(async () => ({
        api_version: 'v25.0',
        access_token_encrypted: 'encrypted-token',
        waba_id: 'waba-1',
      })),
    } as never,
    officialWindowService as never
  );

  return { useCase, metaWhatsappEmbeddedService, officialWindowService };
}

describe('OfficialOpeningContextViewerUseCase', () => {
  it.each(['open', 'awaiting_contact_reply', 'send_uncertain'] as const)(
    'does not query Meta templates while the window is %s',
    async (state) => {
      const { useCase, metaWhatsappEmbeddedService, officialWindowService } =
        makeUseCase({
          ...closedWindow,
          state,
          reason:
            state === 'open'
              ? 'customer_service_window_open'
              : state === 'awaiting_contact_reply'
                ? 'customer_reply_required'
                : 'template_send_uncertain',
          can_send_freeform: state === 'open',
          can_send_template: state === 'open',
        });

      await expect(
        useCase.execute(((key: string) => key) as never, 'account-1', {
          worker_id: 'worker-1',
          contact_id: 'contact-1',
        })
      ).resolves.toMatchObject({
        requires_template: false,
        templates: [],
        official_window: { state },
      });

      expect(
        metaWhatsappEmbeddedService.listApprovedMessageTemplates
      ).not.toHaveBeenCalled();
      expect(
        officialWindowService.resolveAuthoritativeForIdentity
      ).toHaveBeenCalledWith(
        {
          accountId: 'account-1',
          workerId: 'worker-1',
          contactId: 'contact-1',
          phone: '5511999999999',
        },
        expect.any(Date)
      );
    }
  );

  it('lists approved templates when the window is closed', async () => {
    const { useCase, metaWhatsappEmbeddedService } = makeUseCase();

    await expect(
      useCase.execute(((key: string) => key) as never, 'account-1', {
        worker_id: 'worker-1',
        contact_id: 'contact-1',
      })
    ).resolves.toMatchObject({
      requires_template: true,
      official_window: { state: 'closed' },
    });

    expect(
      metaWhatsappEmbeddedService.listApprovedMessageTemplates
    ).toHaveBeenCalledTimes(1);
  });
});
