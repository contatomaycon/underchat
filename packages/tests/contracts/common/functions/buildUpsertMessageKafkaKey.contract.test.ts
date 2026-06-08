jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: (jid: string) => jid.replace(/@c\.us$/, '@s.whatsapp.net'),
}));

import { buildUpsertMessageKafkaKey } from '@core/common/functions/buildUpsertMessageKafkaKey';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';

function makeUpsert(key: IUpsertMessage['message']['key']): IUpsertMessage {
  return {
    account_id: 'account-1',
    worker_id: 'worker-1',
    type: EMessageType.text,
    has_quoted: false,
    message: {
      key,
      message: {
        conversation: 'Oi',
      },
    },
  };
}

describe('buildUpsertMessageKafkaKey', () => {
  it('uses the phone alternate JID as the stable partition key for LID chats', () => {
    const upsert = makeUpsert({
      id: 'message-1',
      remoteJid: '252067352473847@lid',
      remoteJidAlt: '556481342084@s.whatsapp.net',
      fromMe: false,
    });

    expect(buildUpsertMessageKafkaKey(upsert)).toBe(
      'account-1:worker-1:556481342084@s.whatsapp.net'
    );
  });

  it('normalizes c.us JIDs and falls back to message id when no remote JID exists', () => {
    const withCusRemote = makeUpsert({
      id: 'message-2',
      remoteJid: '556481342084@c.us',
      fromMe: false,
    });
    const withoutRemote = makeUpsert({
      id: 'message-3',
      fromMe: false,
    });

    expect(buildUpsertMessageKafkaKey(withCusRemote)).toBe(
      'account-1:worker-1:556481342084@s.whatsapp.net'
    );
    expect(buildUpsertMessageKafkaKey(withoutRemote)).toBe(
      'account-1:message-3'
    );
  });
});
