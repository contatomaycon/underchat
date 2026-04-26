import { extractReactionMessage } from '@core/common/functions/extractReactionMessage';

describe('extractReactionMessage', () => {
  it('returns null for missing message', () => {
    expect(extractReactionMessage(undefined)).toBeNull();
    expect(extractReactionMessage(null)).toBeNull();
  });

  it('returns direct reactionMessage when present', () => {
    const reaction = { key: { id: 'r1' } };
    expect(
      extractReactionMessage({ reactionMessage: reaction } as never)
    ).toEqual(reaction);
  });

  it('normalizes whatsmeow proto JSON reaction key casing', () => {
    const reaction = {
      key: {
        ID: 'target-message-id',
        remoteJID: '158733669765176@lid',
        fromMe: true,
      },
      text: '\u2764\ufe0f',
      senderTimestampMS: '1777208911964',
    };

    const result = extractReactionMessage({
      reactionMessage: reaction,
    } as never) as any;

    expect(result?.key?.id).toBe('target-message-id');
    expect(result?.key?.remoteJid).toBe('158733669765176@lid');
    expect(result?.senderTimestampMs).toBe('1777208911964');
  });

  it('returns encrypted reaction when present', () => {
    const reaction = { key: { id: 'r2' } };
    expect(
      extractReactionMessage({ encReactionMessage: reaction } as never)
    ).toEqual(reaction);
  });

  it('resolves nested reactions in wrapper message structures', () => {
    const reaction = { key: { id: 'r3' } };
    const message = {
      ephemeralMessage: {
        message: {
          viewOnceMessageV2: {
            message: {
              reactionMessage: reaction,
            },
          },
        },
      },
    };

    expect(extractReactionMessage(message as never)).toEqual(reaction);
  });

  it('supports other wrapper variants and returns null when none has reaction', () => {
    const reaction = { key: { id: 'r4' } };

    expect(
      extractReactionMessage({
        viewOnceMessage: { message: { reactionMessage: reaction } },
      } as never)
    ).toEqual(reaction);

    expect(
      extractReactionMessage({
        viewOnceMessageV2Extension: { message: { reactionMessage: reaction } },
      } as never)
    ).toEqual(reaction);

    expect(
      extractReactionMessage({ viewOnceMessageV2: { message: {} } } as never)
    ).toBeNull();
  });
});
