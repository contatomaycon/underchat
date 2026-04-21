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
