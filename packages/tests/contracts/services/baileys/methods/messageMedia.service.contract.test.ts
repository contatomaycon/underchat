import 'reflect-metadata';

jest.mock('@core/services/baileys/methods/helpers.service', () => ({
  BaileysHelpersService: class {},
}));

import { BaileysMessageMediaService } from '@core/services/baileys/methods/messageMedia.service';

describe('BaileysMessageMediaService', () => {
  let consoleInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
  });

  const makeService = () => {
    const baileysHelpersService = {
      send: jest.fn(async () => ({ key: { id: 'msg-1' } })),
    };

    const service = new BaileysMessageMediaService(
      baileysHelpersService as never
    );

    return {
      service,
      baileysHelpersService,
    };
  };

  it('sends image with full payload', async () => {
    const { service, baileysHelpersService } = makeService();

    await expect(
      service.sendImage(
        '5511999999999@c.us',
        Buffer.from('img') as never,
        {
          caption: 'legend',
          jpegThumbnail: 'thumb',
          width: 300,
          height: 250,
          viewOnce: true,
          contextInfo: { stanzaId: 's1' } as never,
        },
        { ephemeralExpiration: 30 } as never
      )
    ).resolves.toEqual({ key: { id: 'msg-1' } });

    expect(baileysHelpersService.send).toHaveBeenCalledWith(
      '5511999999999@c.us',
      {
        image: Buffer.from('img'),
        caption: 'legend',
        jpegThumbnail: 'thumb',
        width: 300,
        height: 250,
        viewOnce: true,
        contextInfo: { stanzaId: 's1' },
      },
      { ephemeralExpiration: 30 }
    );
  });

  it('sends video with booleans normalized', async () => {
    const { service, baileysHelpersService } = makeService();

    await service.sendVideo(
      'jid-1',
      { url: 'https://cdn/video.mp4', mimetype: 'video/quicktime' },
      {
        caption: 'video',
        gifPlayback: 1 as never,
        ptv: 0 as never,
        seconds: 42,
        mimetype: 'video/quicktime',
        fileName: 'mobile.mov',
        filesize: 1234,
        contextInfo: { participant: 'p1' } as never,
      }
    );

    expect(baileysHelpersService.send).toHaveBeenCalledWith(
      'jid-1',
      {
        video: {
          url: 'https://cdn/video.mp4',
          mimetype: 'video/mp4',
          filename: 'mobile.mov',
          filesize: 1234,
        },
        caption: 'video',
        gifPlayback: true,
        jpegThumbnail: undefined,
        ptv: false,
        width: undefined,
        height: undefined,
        viewOnce: undefined,
        seconds: 42,
        mimetype: 'video/mp4',
        contextInfo: { participant: 'p1' },
      },
      undefined
    );
  });

  it('sends audio as view-once forcing ptt=true and restricted fields', async () => {
    const { service, baileysHelpersService } = makeService();
    const waveform = new Uint8Array([1, 2, 3]);

    await service.sendAudio(
      'jid-audio',
      Buffer.from('audio') as never,
      {
        ptt: false,
        seconds: 10,
        mimetype: 'audio/mpeg',
        fileName: 'audio.mp3',
        filesize: 500,
        waveform,
        viewOnce: true,
        contextInfo: { participant: 'x' } as never,
      },
      { messageId: 'm-view' } as never
    );

    expect(baileysHelpersService.send).toHaveBeenCalledWith(
      'jid-audio',
      {
        audio: Buffer.from('audio'),
        ptt: true,
        seconds: 10,
        mimetype: 'audio/ogg; codecs=opus',
        waveform,
        viewOnce: true,
        contextInfo: { participant: 'x' },
      },
      { messageId: 'm-view' }
    );
  });

  it('sends standard audio honoring ptt and metadata', async () => {
    const { service, baileysHelpersService } = makeService();
    const waveform = new Uint8Array([7, 8]);

    await service.sendAudio(
      'jid-audio2',
      { url: 'https://cdn/audio.ogg', mimetype: 'audio/ogg' },
      {
        ptt: false,
        seconds: 15,
        mimetype: 'audio/ogg',
        fileName: 'legacy.ogg',
        filesize: 987,
        waveform,
        contextInfo: { participant: 'y' } as never,
      }
    );

    expect(baileysHelpersService.send).toHaveBeenCalledWith(
      'jid-audio2',
      {
        audio: {
          url: 'https://cdn/audio.ogg',
          mimetype: 'audio/mpeg',
          filename: 'legacy.ogg',
          filesize: 987,
        },
        ptt: false,
        seconds: 15,
        mimetype: 'audio/mpeg',
        waveform,
        contextInfo: { participant: 'y' },
      },
      undefined
    );
  });

  it('sends sticker/document/view-once image/video', async () => {
    const { service, baileysHelpersService } = makeService();

    await service.sendSticker(
      'jid-sticker',
      { url: 'https://cdn/sticker.webp' },
      {
        isAnimated: 1 as never,
        width: 512,
        height: 512,
        contextInfo: { stanzaId: 'sticker' } as never,
      }
    );

    await service.sendDocument(
      'jid-doc',
      { url: 'https://cdn/file.pdf' },
      {
        mimetype: 'application/pdf',
        fileName: 'invoice.pdf',
        filesize: 3456,
        caption: 'doc',
        contextInfo: { stanzaId: 'doc' } as never,
      },
      { ephemeralExpiration: 99 } as never
    );

    await service.sendViewOnceImage(
      'jid-vo-image',
      { url: 'https://cdn/image.png' },
      'once image',
      { messageId: 'vo-image' } as never
    );

    await service.sendViewOnceVideo(
      'jid-vo-video',
      { url: 'https://cdn/video-once.mp4' },
      'once video',
      { messageId: 'vo-video' } as never
    );

    expect(baileysHelpersService.send).toHaveBeenNthCalledWith(
      1,
      'jid-sticker',
      {
        sticker: { url: 'https://cdn/sticker.webp' },
        isAnimated: true,
        width: 512,
        height: 512,
        contextInfo: { stanzaId: 'sticker' },
      },
      undefined
    );

    expect(baileysHelpersService.send).toHaveBeenNthCalledWith(
      2,
      'jid-doc',
      {
        document: {
          url: 'https://cdn/file.pdf',
          mimetype: 'application/pdf',
          filename: 'invoice.pdf',
          filesize: 3456,
        },
        mimetype: 'application/pdf',
        fileName: 'invoice.pdf',
        caption: 'doc',
        contextInfo: { stanzaId: 'doc' },
      },
      { ephemeralExpiration: 99 }
    );

    expect(baileysHelpersService.send).toHaveBeenNthCalledWith(
      3,
      'jid-vo-image',
      {
        image: { url: 'https://cdn/image.png' },
        viewOnce: true,
        caption: 'once image',
      },
      { messageId: 'vo-image' }
    );

    expect(baileysHelpersService.send).toHaveBeenNthCalledWith(
      4,
      'jid-vo-video',
      {
        video: { url: 'https://cdn/video-once.mp4' },
        viewOnce: true,
        caption: 'once video',
      },
      { messageId: 'vo-video' }
    );
  });
});
