import { buildMessageMarkReadKafkaKey } from '@core/common/functions/buildMessageMarkReadKafkaKey';

describe('buildMessageMarkReadKafkaKey', () => {
  it('routes the same worker and chat to one partition regardless of key order', () => {
    const first = buildMessageMarkReadKafkaKey({
      account_id: 'account-1',
      worker_id: 'worker-1',
      keys: [
        { remoteJid: '5511999999999@s.whatsapp.net' },
        { remoteJidAlt: '5511888888888@s.whatsapp.net' },
      ],
    });
    const second = buildMessageMarkReadKafkaKey({
      account_id: 'account-1',
      worker_id: 'worker-1',
      keys: [
        { remoteJidAlt: '5511888888888@s.whatsapp.net' },
        { remoteJid: '5511999999999@s.whatsapp.net' },
      ],
    });

    expect(first).toBe(
      'account-1:worker-1:5511888888888@s.whatsapp.net,5511999999999@s.whatsapp.net'
    );
    expect(second).toBe(first);
  });

  it('keeps legacy remote_jid payloads ordered on the same entity key', () => {
    expect(
      buildMessageMarkReadKafkaKey({
        account_id: 'account-1',
        worker_id: 'worker-1',
        keys: [
          {
            remote_jid: '5511999999999@c.us',
          } as never,
        ],
      })
    ).toBe('account-1:worker-1:5511999999999@c.us');
  });
});
