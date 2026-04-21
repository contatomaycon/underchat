import 'reflect-metadata';

jest.mock('@wwebjs/whatsapp-web.js', () => ({
  __esModule: true,
  default: {
    MessageMedia: {
      fromUrl: jest.fn(async (url: string) => ({ mediaUrl: url })),
    },
  },
}));

jest.mock('@core/common/functions/getMediaUrlFromInput', () => ({
  withMediaUrlFromInput: jest.fn(async (_input, callback) =>
    callback('https://cdn/media')
  ),
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

    expect(sendMessage).toHaveBeenNthCalledWith(1, 'status@broadcast', 'txt');
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      'status@broadcast',
      { mediaUrl: 'https://cdn/media' },
      { caption: 'img' }
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      'status@broadcast',
      { mediaUrl: 'https://cdn/media' },
      { caption: 'vid' }
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      4,
      'status@broadcast',
      { mediaUrl: 'https://cdn/media' },
      { caption: 'aud', sendAudioAsVoice: true }
    );
    expect(deleteMessage).toHaveBeenCalledWith({
      remoteJid: 'status@broadcast',
      fromMe: true,
      id: 'ext-1',
    });
  });
});
