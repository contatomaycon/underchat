import 'reflect-metadata';

import type { IOfficialWhatsappConversationWindowRecord } from '@core/common/interfaces/IOfficialWhatsappConversationWindow';
import { OfficialWhatsappConversationWindowRepository } from '@core/repositories/whatsapp/OfficialWhatsappConversationWindow.repository';

const pendingRecord: IOfficialWhatsappConversationWindowRecord = {
  official_whatsapp_conversation_window_id: 'window-with-nine',
  account_id: 'account-1',
  worker_id: 'worker-1',
  contact_id: 'contact-1',
  phone: '5548999077927',
  remote_jid: '5548999077927@s.whatsapp.net',
  awaiting_contact_reply_since: '2026-07-21T13:17:47.811Z',
  awaiting_template_message_id: 'wamid.template',
  last_template_sent_at: '2026-07-21T13:17:47.811Z',
  closed_reason: 'template_pending',
  updated_at: '2026-07-21T13:17:48.000Z',
};

const inboundAliasRecord: IOfficialWhatsappConversationWindowRecord = {
  official_whatsapp_conversation_window_id: 'window-without-nine',
  account_id: 'account-1',
  worker_id: 'worker-1',
  contact_id: 'contact-1',
  phone: '554899077927',
  remote_jid: '554899077927@s.whatsapp.net',
  last_inbound_message_id: 'wamid.inbound',
  last_inbound_at: '2026-07-21T13:18:15.000Z',
  service_window_expires_at: '2026-07-22T13:18:15.000Z',
  updated_at: '2026-07-21T13:18:16.000Z',
};

function makeRepository(
  records: IOfficialWhatsappConversationWindowRecord[]
): OfficialWhatsappConversationWindowRepository {
  const database = {
    query: {
      officialWhatsappConversationWindow: {
        findMany: jest.fn(async () => records),
      },
    },
  };

  return new OfficialWhatsappConversationWindowRepository(
    database as never,
    database as never
  );
}

describe('OfficialWhatsappConversationWindowRepository', () => {
  it('treats Brazilian JIDs with and without the ninth digit as one identity', () => {
    const repository = makeRepository([]) as unknown as {
      phoneCandidates: (phone: string) => string[];
    };

    expect(repository.phoneCandidates('5548999077927')).toEqual([
      '5548999077927',
      '554899077927',
    ]);
    expect(repository.phoneCandidates('554899077927')).toEqual([
      '554899077927',
      '5548999077927',
    ]);
  });

  it('merges legacy alias rows using business-event order and releases pending after the reply', async () => {
    const repositories = [
      makeRepository([pendingRecord, inboundAliasRecord]),
      makeRepository([inboundAliasRecord, pendingRecord]),
    ];

    for (const repository of repositories) {
      await expect(
        repository.findByIdentity({
          accountId: 'account-1',
          workerId: 'worker-1',
          phone: '5548999077927',
        })
      ).resolves.toMatchObject({
        last_inbound_message_id: 'wamid.inbound',
        last_inbound_at: '2026-07-21T13:18:15.000Z',
        service_window_expires_at: '2026-07-22T13:18:15.000Z',
        last_template_sent_at: '2026-07-21T13:17:47.811Z',
        awaiting_contact_reply_since: null,
        awaiting_template_message_id: null,
        closed_reason: null,
      });
    }
  });

  it('keeps the latest template pending when the prior inbound window did not cover it', async () => {
    const staleInbound = {
      ...inboundAliasRecord,
      last_inbound_at: '2026-07-01T10:00:00.000Z',
      service_window_expires_at: '2026-07-02T10:00:00.000Z',
    };
    const newerPending = {
      ...pendingRecord,
      awaiting_contact_reply_since: '2026-07-03T10:00:00.000Z',
      last_template_sent_at: '2026-07-03T10:00:00.000Z',
    };
    const repository = makeRepository([staleInbound, newerPending]);

    await expect(
      repository.findByIdentity({
        accountId: 'account-1',
        workerId: 'worker-1',
        phone: '554899077927',
      })
    ).resolves.toMatchObject({
      last_inbound_at: '2026-07-01T10:00:00.000Z',
      last_template_sent_at: '2026-07-03T10:00:00.000Z',
      awaiting_contact_reply_since: '2026-07-03T10:00:00.000Z',
      awaiting_template_message_id: 'wamid.template',
      closed_reason: 'template_pending',
    });
  });

  it('does not merge an uncertain template into a stale alias service window', async () => {
    const uncertainTemplate = {
      ...pendingRecord,
      closed_reason: 'template_send_uncertain',
      updated_at: '2026-07-21T13:18:17.000Z',
    };
    const repository = makeRepository([inboundAliasRecord, uncertainTemplate]);

    await expect(
      repository.findByIdentity({
        accountId: 'account-1',
        workerId: 'worker-1',
        phone: '5548999077927',
      })
    ).resolves.toMatchObject({
      awaiting_contact_reply_since: '2026-07-21T13:17:47.811Z',
      awaiting_template_message_id: 'wamid.template',
      closed_reason: 'template_send_uncertain',
    });
  });
});
