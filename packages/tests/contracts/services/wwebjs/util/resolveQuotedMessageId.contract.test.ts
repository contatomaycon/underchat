import { resolveQuotedMessageId } from '@core/services/wwebjs/util/resolveQuotedMessageId';

describe('resolveQuotedMessageId', () => {
  it('returns serialized id from direct getMessageById lookup', async () => {
    const getMessageById = jest
      .fn<Promise<unknown>, [string]>()
      .mockImplementation(async (candidate) => ({
        id: { _serialized: candidate },
      }));
    const getChatById = jest.fn();

    const result = await resolveQuotedMessageId(
      {
        getMessageById,
        getChatById,
      } as never,
      '55118888@c.us',
      {
        id: 'false_55118888@c.us_msg-1',
      }
    );

    expect(result).toBe('false_55118888@c.us_msg-1');
    expect(getMessageById).toHaveBeenCalledWith('false_55118888@c.us_msg-1');
    expect(getChatById).not.toHaveBeenCalled();
  });

  it('falls back to chat scan and resolves by stanza/fromMe/participant aliases', async () => {
    const getMessageById = jest
      .fn<Promise<unknown>, [string]>()
      .mockRejectedValue(new Error('not-found'));

    const fetchMessages = jest.fn<Promise<unknown[]>, [{ limit?: number }]>(
      async () => [
        {
          id: {
            id: 'quoted-42',
            remote: '55118888@s.whatsapp.net',
            fromMe: false,
          },
          author: '55119999@s.whatsapp.net',
        },
      ]
    );

    const getChatById = jest
      .fn<Promise<unknown>, [string]>()
      .mockResolvedValue({ fetchMessages });

    const result = await resolveQuotedMessageId(
      {
        getMessageById,
        getChatById,
      } as never,
      '55118888@c.us',
      {
        id: 'quoted-42',
        remote_jid: '55118888@s.whatsapp.net',
        participant: '55119999@c.us',
      }
    );

    expect(result).toBe('false_55118888@s.whatsapp.net_quoted-42');
    expect(getChatById).toHaveBeenCalled();
    expect(fetchMessages).toHaveBeenCalledWith({ limit: 100 });
  });

  it('returns undefined when quoted key id is empty', async () => {
    const getMessageById = jest.fn();
    const getChatById = jest.fn();

    const result = await resolveQuotedMessageId(
      {
        getMessageById,
        getChatById,
      } as never,
      '55118888@c.us',
      {
        id: '   ',
      }
    );

    expect(result).toBeUndefined();
    expect(getMessageById).not.toHaveBeenCalled();
    expect(getChatById).not.toHaveBeenCalled();
  });

  it('resolves serialized id from object id+remote when fromMe is on message', async () => {
    const getMessageById = jest
      .fn<Promise<unknown>, [string]>()
      .mockResolvedValueOnce({ id: null })
      .mockResolvedValueOnce({
        id: {
          id: 'msg-obj-1',
          remote: { _serialized: '55117777@c.us' },
        },
        fromMe: true,
      });
    const getChatById = jest.fn();

    const result = await resolveQuotedMessageId(
      {
        getMessageById,
        getChatById,
      } as never,
      '55118888@c.us',
      {
        id: 'raw-msg-id',
      }
    );

    expect(result).toBe('true_55117777@c.us_msg-obj-1');
    expect(getChatById).not.toHaveBeenCalled();
  });

  it('handles invalid serialized prefix and still resolves raw string id', async () => {
    const getMessageById = jest
      .fn<Promise<unknown>, [string]>()
      .mockImplementation(async (candidate) => ({
        id: candidate === 'x_55118888@c.us_msg-10' ? candidate : null,
      }));

    const result = await resolveQuotedMessageId(
      {
        getMessageById,
        getChatById: jest.fn(),
      } as never,
      '55118888@c.us',
      {
        id: 'x_55118888@c.us_msg-10',
      }
    );

    expect(result).toBe('x_55118888@c.us_msg-10');
  });

  it('continues scanning candidates when chat fetch fails or has no matches', async () => {
    const getMessageById = jest
      .fn<Promise<unknown>, [string]>()
      .mockRejectedValue(new Error('missing'));

    const getChatById = jest
      .fn<Promise<unknown>, [string]>()
      .mockRejectedValueOnce(new Error('chat-fail'))
      .mockResolvedValueOnce({
        fetchMessages: jest.fn<Promise<unknown[]>, [{ limit?: number }]>(
          async () => []
        ),
      })
      .mockResolvedValueOnce({
        fetchMessages: jest.fn<Promise<unknown[]>, [{ limit?: number }]>(
          async () => [
            {
              id: {
                id: 'other-id',
                remote: '55118888@c.us',
                fromMe: true,
              },
            },
          ]
        ),
      });

    const result = await resolveQuotedMessageId(
      {
        getMessageById,
        getChatById,
      } as never,
      '55118888@c.us',
      {
        id: 'quoted-99',
      }
    );

    expect(result).toBeUndefined();
    expect(getMessageById).toHaveBeenCalled();
    expect(getChatById).toHaveBeenCalled();
  });

  it('covers chat scan branches for stanza/fromMe/participant and returns serialized fallback', async () => {
    const getMessageById = jest
      .fn<Promise<unknown>, [string]>()
      .mockRejectedValue(new Error('missing'));

    const fetchMessages = jest.fn<Promise<unknown[]>, [{ limit?: number }]>(
      async () => [
        null,
        {
          id: {
            id: 'other-id',
          },
        },
        {
          id: {
            id: 'quoted-abc',
            remote: '55118888@c.us',
          },
          fromMe: true,
        },
        {
          id: {
            id: 'quoted-abc',
          },
        },
        {
          id: {
            id: 'quoted-abc',
            remote: 'different@c.us',
            fromMe: false,
            participant: { _serialized: '55117777@s.whatsapp.net' },
          },
        },
        {
          id: {
            _serialized: 'false_different@c.us_quoted-abc',
          },
          author: '55119999@s.whatsapp.net',
        },
      ]
    );

    const getChatById = jest
      .fn<Promise<unknown>, [string]>()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ fetchMessages });

    const result = await resolveQuotedMessageId(
      {
        getMessageById,
        getChatById,
      } as never,
      '55118888@c.us',
      {
        id: 'quoted-abc',
        from_me: false,
        remote_jid: '55118888@c.us',
        participant: '55119999@c.us',
      }
    );

    expect(result).toBe('false_different@c.us_quoted-abc');
    expect(fetchMessages).toHaveBeenCalledWith({ limit: 100 });
  });
});
