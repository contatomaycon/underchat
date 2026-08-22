import 'reflect-metadata';

jest.mock('@wwebjs/whatsapp-web.js', () => ({
  __esModule: true,
  default: {
    MessageMedia: class MessageMedia {
      constructor(
        readonly mimetype: string,
        readonly data: string,
        readonly filename?: string,
        readonly filesize?: number
      ) {}
    },
  },
}));

jest.mock('@core/common/functions/getMediaUrlFromInput', () => ({
  withMediaUrlFromInput: jest.fn(async (_input, callback) =>
    callback('https://cdn/media', {})
  ),
}));

jest.mock('@core/common/functions/downloadMediaBuffer', () => ({
  downloadMediaBuffer: jest.fn(async () => ({
    buffer: Buffer.from('status-media'),
    contentType: 'image/jpeg',
    contentLength: 12,
    filename: 'status.jpg',
  })),
}));

jest.mock('@core/services/wwebjs/methods/helpers.service', () => ({
  WwebjsHelpersService: class {},
}));

jest.mock('@core/services/wwebjs/methods/messageEditDelete.service', () => ({
  WwebjsMessageEditDeleteService: class {},
}));

jest.mock('@core/services/wwebjs/util/messageToWaLike', () => ({
  messageToWaLike: jest.fn((msg) => ({ wrapped: msg })),
}));

import { WwebjsMessageStatusStoriesService } from '@core/services/wwebjs/methods/messageStatusStories.service';

describe('WwebjsMessageStatusStoriesService', () => {
  it('sends text/image/video/audio status and deletes status', async () => {
    const sendMessage = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce({ id: 't1' })
      .mockResolvedValueOnce({ id: 'i1' })
      .mockResolvedValueOnce({ id: 'v1' })
      .mockResolvedValueOnce({ id: 'a1' });
    const deleteMessage = jest.fn(async () => undefined);

    const service = new WwebjsMessageStatusStoriesService(
      { sendMessage } as never,
      { deleteMessage } as never
    );

    await expect(
      service.sendStatusText('status@broadcast', 'txt')
    ).resolves.toEqual({
      wrapped: { id: 't1' },
    });
    await expect(
      service.sendStatusImage('status@broadcast', { file: 'a' } as never, {
        caption: 'img',
      })
    ).resolves.toEqual({ wrapped: { id: 'i1' } });
    await expect(
      service.sendStatusVideo('status@broadcast', { file: 'v' } as never, {
        caption: 'vid',
      })
    ).resolves.toEqual({ wrapped: { id: 'v1' } });
    await expect(
      service.sendStatusAudio('status@broadcast', { file: 'x' } as never, {
        caption: 'aud',
      })
    ).resolves.toEqual({ wrapped: { id: 'a1' } });

    await expect(service.deleteStatus('ext-1')).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      'status@broadcast',
      'txt',
      undefined,
      undefined
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      'status@broadcast',
      expect.objectContaining({
        mimetype: 'image/jpeg',
        data: Buffer.from('status-media').toString('base64'),
        filename: 'status.jpg',
        filesize: 12,
      }),
      { caption: 'img' },
      undefined
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      'status@broadcast',
      expect.objectContaining({
        mimetype: 'image/jpeg',
        data: Buffer.from('status-media').toString('base64'),
        filename: 'status.jpg',
        filesize: 12,
      }),
      { caption: 'vid' },
      undefined
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      4,
      'status@broadcast',
      expect.objectContaining({
        mimetype: 'image/jpeg',
        data: Buffer.from('status-media').toString('base64'),
        filename: 'status.jpg',
        filesize: 12,
      }),
      { caption: 'aud', sendAudioAsVoice: true },
      undefined
    );
    expect(deleteMessage).toHaveBeenCalledWith(
      {
        remoteJid: 'status@broadcast',
        fromMe: true,
        id: 'ext-1',
      },
      undefined
    );
  });
});
