import { EMessageType } from '@core/common/enums/EMessageType';
import {
  buildInboundEventId,
  canonicalInboundParticipantJid,
  ensureInboundEventId,
} from '@core/common/functions/inboundEventIdentity';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';

function upsert(
  id: string,
  provider: IUpsertMessage['source_provider'],
  overrides: Partial<IUpsertMessage> = {}
): IUpsertMessage {
  return {
    account_id: 'account-1',
    worker_id: 'worker-1',
    source_provider: provider,
    type: EMessageType.text,
    has_quoted: false,
    message: {
      key: {
        id,
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
      },
    },
    ...overrides,
  };
}

describe('inboundEventIdentity', () => {
  it('converges WWebJS serialized IDs and raw stanza IDs across providers', () => {
    const wwebjs = upsert('false_5511999999999@c.us_STANZA-1', 'wwebjs');
    const baileys = upsert('STANZA-1', 'baileys');
    const whatsmeow = upsert('STANZA-1', 'whatsmeow');

    expect(buildInboundEventId(wwebjs)).toBe(buildInboundEventId(baileys));
    expect(buildInboundEventId(baileys)).toBe(buildInboundEventId(whatsmeow));
  });

  it('prefers a phone participant over a LID across providers', () => {
    const baileys = upsert('GROUP-STANZA-1', 'baileys');
    baileys.message.key.remoteJid = '120363000000000000@g.us';
    baileys.message.key.participant = '5511999999999:7@s.whatsapp.net';
    baileys.message.key.participantAlt = '158733669765176@lid';

    const whatsmeow = upsert('GROUP-STANZA-1', 'whatsmeow');
    whatsmeow.message.key.remoteJid = '120363000000000000@g.us';
    whatsmeow.message.key.participant = '158733669765176@lid';
    whatsmeow.message.key.participantAlt = '5511999999999@s.whatsapp.net';

    expect(canonicalInboundParticipantJid(baileys.message.key)).toBe(
      '5511999999999@s.whatsapp.net'
    );
    expect(canonicalInboundParticipantJid(whatsmeow.message.key)).toBe(
      '5511999999999@s.whatsapp.net'
    );
    expect(buildInboundEventId(baileys)).toBe(buildInboundEventId(whatsmeow));
  });

  it('matches the shared Go/TypeScript v1 golden identities', () => {
    expect(
      buildInboundEventId(upsert('false_5511999999999@c.us_stanza-1', 'wwebjs'))
    ).toBe(
      'waevt_v1_7c15f3828681b891392eadfc301c86bec03c1ece80699bf7d153ad0acf638caf'
    );

    const edit = upsert('edit-stanza', 'baileys', {
      type: EMessageType.edit_text,
    });
    edit.message.messageTimestamp = 1_700_000_001;
    expect(buildInboundEventId(edit)).toBe(
      'waevt_v1_f701af190d1fc7a8c6797111736477e6d9d1d1f63450a2212ad5b6cd7254b9b9'
    );
  });

  it('accepts repeated content when the physical stanza IDs differ', () => {
    expect(buildInboundEventId(upsert('STANZA-1', 'baileys'))).not.toBe(
      buildInboundEventId(upsert('STANZA-2', 'baileys'))
    );
  });

  it('distinguishes mutation kinds and revisions without using content', () => {
    const editV1 = upsert('MUTATION-1', 'baileys', {
      type: EMessageType.edit_text,
      event_revision: '1',
    });
    const editV2 = upsert('MUTATION-1', 'baileys', {
      type: EMessageType.edit_text,
      event_revision: '2',
    });
    const reaction = upsert('MUTATION-1', 'baileys', {
      type: EMessageType.react,
      event_revision: '1',
    });

    expect(buildInboundEventId(editV1)).not.toBe(buildInboundEventId(editV2));
    expect(buildInboundEventId(editV1)).not.toBe(buildInboundEventId(reaction));
  });

  it('normalizes provider mutation timestamps to seconds', () => {
    const seconds = upsert('MUTATION-2', 'baileys', {
      type: EMessageType.edit_text,
    });
    seconds.message.messageTimestamp = 1_720_000_000;
    const milliseconds = upsert('MUTATION-2', 'wwebjs', {
      type: EMessageType.edit_text,
    });
    milliseconds.message.messageTimestamp = 1_720_000_000_000;

    expect(buildInboundEventId(seconds)).toBe(
      buildInboundEventId(milliseconds)
    );
  });

  it('converges call events across providers by immutable call id', () => {
    const wwebjs = upsert('call_call-123', 'wwebjs', {
      type: EMessageType.system,
      is_call_event: true,
      event_revision: 'call-123',
    });
    wwebjs.message.key.remoteJid = '5511999999999@c.us';
    const whatsmeow = upsert('call_call-123', 'whatsmeow', {
      type: EMessageType.system,
      is_call_event: true,
      event_revision: 'call-123',
    });

    expect(buildInboundEventId(wwebjs)).toBe(buildInboundEventId(whatsmeow));
  });

  it('preserves an identity already assigned at the provider edge', () => {
    const payload = upsert('STANZA-1', 'wwebjs', {
      event_id: 'provider-event-1',
    });

    expect(ensureInboundEventId(payload)).toBe('provider-event-1');
    expect(payload.event_id).toBe('provider-event-1');
  });

  it('does not invent an identity without a physical provider ID', () => {
    const payload = upsert('', 'baileys');
    payload.message.key.id = undefined;

    expect(buildInboundEventId(payload)).toBeNull();
  });

  it('does not deduplicate a mutable event without a stable revision', () => {
    const payload = upsert('MUTATION-WITHOUT-REVISION', 'wwebjs', {
      type: EMessageType.edit_text,
    });
    payload.message.messageTimestamp = undefined;

    expect(buildInboundEventId(payload)).toBeNull();
  });

  it('treats a system pin as a mutable annotation event', () => {
    const pin = upsert('PIN-STANZA', 'baileys', {
      type: EMessageType.system,
    });
    pin.message.message = {
      pinInChatMessage: { key: { id: 'TARGET' }, type: 1 },
    };

    expect(buildInboundEventId(pin)).toBeNull();
    pin.event_revision = '1700000001';
    expect(buildInboundEventId(pin)).toMatch(/^waevt_v1_[a-f0-9]{64}$/);
  });
});
