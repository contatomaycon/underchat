jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsWorkerId: 'worker-1',
    wwebjsAccountId: 'account-1',
  },
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: jest.fn((jid: string) => {
    if (typeof jid !== 'string') {
      return jid;
    }

    if (jid.endsWith('@s.whatsapp.net')) {
      return jid.replace(/@s\.whatsapp\.net$/, '@c.us');
    }

    return jid;
  }),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import {
  buildCallUpsert,
  buildDeleteMessageUpsert,
  buildEditMessageUpsert,
  buildReactionUpsert,
  buildRevokeMeUpsert,
} from '@core/services/wwebjs/util/wwebjsUpsertBuilders';

describe('wwebjsUpsertBuilders', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (normalizeJid as unknown as jest.Mock).mockImplementation((jid: string) => {
      if (typeof jid !== 'string') {
        return jid;
      }

      if (jid.endsWith('@s.whatsapp.net')) {
        return jid.replace(/@s\.whatsapp\.net$/, '@c.us');
      }

      return jid;
    });
  });

  it('builds delete-message upsert using deleted id from before message', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1711111111000);

    try {
      const output = buildDeleteMessageUpsert(
        {
          id: { _serialized: 'event-id-1' },
          fromMe: false,
          from: '123@g.us',
          to: 'me@c.us',
          author: '55119999@s.whatsapp.net',
          timestamp: 111,
        } as never,
        {
          id: { _serialized: 'deleted-id-1' },
          fromMe: false,
          from: '123@g.us',
          timestamp: 110,
        } as never
      );

      expect(output).toEqual({
        worker_id: 'worker-1',
        account_id: 'account-1',
        type: EMessageType.delete_message,
        has_quoted: false,
        message: {
          key: {
            id: 'event-id-1',
            remoteJid: '123@g.us',
            remoteJidAlt: undefined,
            fromMe: false,
            participant: '55119999@c.us',
          },
          message: {
            protocolMessage: {
              key: { id: 'deleted-id-1' },
            },
          },
          messageTimestamp: 111,
        },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('returns null for delete-message upsert when no ids are available', () => {
    expect(buildDeleteMessageUpsert({} as never, null)).toBeNull();
    expect(
      buildDeleteMessageUpsert(
        {
          id: { _serialized: 'event-id' },
          fromMe: true,
          from: '',
          to: '',
          timestamp: 1,
        } as never,
        {
          id: { _serialized: 'deleted-id' },
        } as never
      )
    ).toBeNull();
  });

  it('supports id derivation from message object and participant fallback from from', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1711111112555);

    try {
      const output = buildDeleteMessageUpsert(
        {
          id: {
            id: 'event-2',
            remote: { _serialized: '999@g.us' },
            fromMe: true,
          },
          fromMe: true,
          from: '55116666@s.whatsapp.net',
          to: '999@g.us',
          timestamp: 222,
        } as never,
        {
          id: 'deleted-id-string',
        } as never,
        {
          remoteJid: '999@g.us',
          remoteJidAlt: '999@c.us',
        }
      );

      expect(output?.message.key.id).toBe('true_999@g.us_event-2');
      expect(output?.message.key.participant).toBe('55116666@c.us');
      expect((output?.message as any)?.message?.protocolMessage?.key?.id).toBe(
        'deleted-id-string'
      );
      expect(output?.message.key.remoteJidAlt).toBe('999@c.us');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('builds revoke-me and edit upserts and handles missing ids', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1711111112000);

    try {
      const revokeOutput = buildRevokeMeUpsert({
        id: { _serialized: 'msg-1' },
        fromMe: true,
        from: 'me@c.us',
        to: '55118888@s.whatsapp.net',
        timestamp: 200,
      } as never);

      expect(revokeOutput?.type).toBe(EMessageType.delete_message);
      expect(revokeOutput?.message.key.id).toBe(
        'revoke_me_msg-1_1711111112000'
      );
      expect(revokeOutput?.message.key.remoteJid).toBe('55118888@c.us');
      expect(revokeOutput?.has_quoted).toBe(false);

      const editOutput = buildEditMessageUpsert(
        {
          id: { _serialized: 'edit-msg-1' },
          fromMe: false,
          from: '55118888@s.whatsapp.net',
          to: 'me@c.us',
          timestamp: 201,
          hasQuotedMsg: true,
        } as never,
        'novo texto'
      );

      expect(editOutput?.type).toBe(EMessageType.edit_text);
      expect(editOutput?.message.key.id).toBe('edit_edit-msg-1_1711111112000');
      const editProtocolMessage = (editOutput as any)?.message?.message
        ?.protocolMessage;
      expect(editProtocolMessage?.editedMessage).toEqual({
        conversation: 'novo texto',
        extendedTextMessage: { text: 'novo texto' },
      });
      expect(editOutput?.has_quoted).toBe(true);

      expect(buildRevokeMeUpsert({} as never)).toBeNull();
      expect(buildEditMessageUpsert({} as never, 'x')).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('builds reaction upsert with expected payload', () => {
    const output = buildReactionUpsert(
      '55118888@c.us',
      '55118888@s.whatsapp.net',
      'reaction-1',
      'target-1',
      '🔥',
      true,
      '55119999@c.us',
      300
    );

    expect(output).toEqual({
      worker_id: 'worker-1',
      account_id: 'account-1',
      type: EMessageType.react,
      has_quoted: false,
      message: {
        key: {
          id: 'reaction-1',
          remoteJid: '55118888@c.us',
          remoteJidAlt: '55118888@s.whatsapp.net',
          fromMe: true,
          participant: '55119999@c.us',
        },
        message: {
          reactionMessage: {
            key: { id: 'target-1' },
            text: '🔥',
          },
        },
        messageTimestamp: 300,
      },
    });
  });

  it('uses plain id from object when remote is missing', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1711111112999);

    try {
      const output = buildEditMessageUpsert(
        {
          id: {
            id: 'plain-id-only',
          },
          fromMe: false,
          from: '55118888@c.us',
          timestamp: 444,
        } as never,
        'texto'
      );

      expect(output?.message.key.id).toBe('edit_plain-id-only_1711111112999');
      expect(output?.message.messageTimestamp).toBe(444);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('builds call upsert for video call and default timestamp branch', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1711111113333);

    try {
      const withCallId = buildCallUpsert(
        '55118888@s.whatsapp.net',
        'Maria',
        '+55118888',
        'call-id-1',
        1711111113333,
        true
      );

      expect(withCallId.message.key.id).toBe('call_call-id-1');
      expect(withCallId.message.key.remoteJid).toBe('55118888@c.us');
      expect(withCallId.message.key.remoteJidAlt).toBe(
        '55118888@s.whatsapp.net'
      );
      expect((withCallId.message as any)?.message?.conversation).toBe(
        'Ligacao de video recebida'
      );
      expect(withCallId.message.messageTimestamp).toBe(1711111113);
      expect(withCallId.is_call_event).toBe(true);

      const withoutCallId = buildCallUpsert(
        '55117777@c.us',
        null,
        '+55117777',
        undefined,
        undefined,
        false
      );

      expect(withoutCallId.message.key.id).toBe('call_1711111113333');
      expect((withoutCallId.message as any)?.message?.conversation).toBe(
        'Ligacao recebida'
      );
      expect(withoutCallId.message.messageTimestamp).toBe(1711111113);
      expect(withoutCallId.call_name).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('covers fallback branches for ids, participant resolution and defaults', () => {
    const normalizeMock = normalizeJid as unknown as jest.Mock;
    normalizeMock.mockImplementation((jid: string) => {
      if (jid === 'raw-no-normalize') {
        return undefined;
      }
      if (jid.endsWith('@s.whatsapp.net')) {
        return jid.replace(/@s\.whatsapp\.net$/, '@c.us');
      }
      return jid;
    });

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1711111114444);

    try {
      expect(
        buildDeleteMessageUpsert(
          {
            id: { fromMe: true },
          } as never,
          null
        )
      ).toBeNull();

      const deleteWithFallback = buildDeleteMessageUpsert(
        {
          id: { fromMe: true },
          from: '   ',
          to: '',
          author: '   ',
          timestamp: 500,
        } as never,
        {
          id: { _serialized: 'deleted-2' },
          from: '55117777@s.whatsapp.net',
          author: '55117777@s.whatsapp.net',
        } as never,
        { remoteJid: 'group-1@g.us' }
      );

      expect(deleteWithFallback?.message.key.id).toBe(
        'revoke_deleted-2_1711111114444'
      );
      expect(deleteWithFallback?.message.key.fromMe).toBe(false);
      expect(deleteWithFallback?.message.key.participant).toBe('55117777@c.us');

      const revokeWithoutRemote = buildRevokeMeUpsert({
        id: 'msg-remote-missing',
        fromMe: true,
        from: '',
        to: '',
      } as never);
      expect(revokeWithoutRemote).toBeNull();

      const revokeWithRawRemote = buildRevokeMeUpsert({
        id: 'msg-raw-remote',
        fromMe: false,
        from: 'raw-no-normalize',
        to: '',
        timestamp: 501,
      } as never);
      expect(revokeWithRawRemote?.message.key.remoteJid).toBe(
        'raw-no-normalize'
      );

      const editWithoutRemote = buildEditMessageUpsert(
        {
          id: 'edit-remote-missing',
          fromMe: false,
          from: '',
          to: '',
        } as never,
        'x'
      );
      expect(editWithoutRemote).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('covers call timestamp branch for seconds and normalize fallback', () => {
    const normalizeMock = normalizeJid as unknown as jest.Mock;
    normalizeMock.mockImplementation((jid: string) => {
      if (jid === 'raw-no-normalize') {
        return undefined;
      }
      return jid;
    });

    const output = buildCallUpsert(
      'raw-no-normalize',
      'Joao',
      '+55116666',
      'call-seconds',
      1234567890,
      false
    );

    expect(output.message.key.remoteJid).toBe('raw-no-normalize');
    expect(output.message.key.remoteJidAlt).toBeUndefined();
    expect(output.message.messageTimestamp).toBe(1234567890);
    expect(output.message.key.id).toBe('call_call-seconds');
  });

  it('covers remaining branches for resolved jids and group-participant fallbacks', () => {
    const normalizeMock = normalizeJid as unknown as jest.Mock;
    normalizeMock.mockImplementation((jid: string) => {
      if (jid === 'raw-no-normalize') {
        return undefined;
      }
      return jid;
    });

    const revoke = buildRevokeMeUpsert(
      {
        id: 'rev-1',
        timestamp: 600,
      } as never,
      {
        remoteJid: 'group-2@g.us',
        remoteJidAlt: 'group-2@c.us',
      }
    );

    expect(revoke?.message.key.remoteJid).toBe('group-2@g.us');
    expect(revoke?.message.key.remoteJidAlt).toBe('group-2@c.us');
    expect(revoke?.message.key.fromMe).toBe(false);

    const edit = buildEditMessageUpsert(
      {
        id: 'edit-1',
        timestamp: 601,
      } as never,
      'texto',
      {
        remoteJid: 'group-3@g.us',
        remoteJidAlt: 'group-3@c.us',
      }
    );

    expect(edit?.message.key.remoteJid).toBe('group-3@g.us');
    expect(edit?.message.key.remoteJidAlt).toBe('group-3@c.us');
    expect(edit?.message.key.fromMe).toBe(false);

    const deleteWithAuthorFallback = buildDeleteMessageUpsert(
      {
        id: {
          id: 'event-string-remote',
          remote: 'group-4@g.us',
          fromMe: false,
        },
        author: 'raw-no-normalize',
        timestamp: 602,
      } as never,
      null,
      {
        remoteJid: 'group-4@g.us',
      }
    );
    expect(deleteWithAuthorFallback?.message.key.participant).toBe(
      'raw-no-normalize'
    );

    const deleteWithFromFallback = buildDeleteMessageUpsert(
      {
        id: {
          id: 'event-string-remote-2',
          remote: 'group-5@g.us',
          fromMe: false,
        },
        author: '',
        from: 'raw-no-normalize',
        timestamp: 603,
      } as never,
      null,
      {
        remoteJid: 'group-5@g.us',
      }
    );
    expect(deleteWithFromFallback?.message.key.participant).toBe(
      'raw-no-normalize'
    );
  });
});
