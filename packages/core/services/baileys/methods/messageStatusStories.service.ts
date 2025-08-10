import { injectable } from 'tsyringe';
import { MiscMessageGenerationOptions } from '@whiskeysockets/baileys';
import { IMediaInput } from '@core/common/interfaces/IMediaInput';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysMessageStatusStoriesService {
  constructor(private readonly baileysHelpersService: BaileysHelpersService) {}

  /**
   * Publica imagem no Status (stories) para contatos específicos.
   */
  sendStatusImage(
    jid: string,
    media: IMediaInput,
    args: {
      caption?: string;
      statusJidList: string[];
      backgroundColor?: string;
      font?: number;
    },
    options?: Omit<
      MiscMessageGenerationOptions,
      'statusJidList' | 'backgroundColor' | 'font' | 'broadcast'
    >
  ) {
    return this.baileysHelpersService.send(
      jid,
      { image: media, caption: args.caption },
      {
        ...(options || {}),
        statusJidList: args.statusJidList,
        backgroundColor: args.backgroundColor,
        font: args.font,
        broadcast: true,
      }
    );
  }

  /**
   * Publica vídeo no Status.
   */
  sendStatusVideo(
    jid: string,
    media: IMediaInput,
    args: {
      caption?: string;
      statusJidList: string[];
      backgroundColor?: string;
      font?: number;
    },
    options?: Omit<
      MiscMessageGenerationOptions,
      'statusJidList' | 'backgroundColor' | 'font' | 'broadcast'
    >
  ) {
    return this.baileysHelpersService.send(
      jid,
      { video: media, caption: args.caption },
      {
        ...(options || {}),
        statusJidList: args.statusJidList,
        backgroundColor: args.backgroundColor,
        font: args.font,
        broadcast: true,
      }
    );
  }

  /**
   * Publica texto no Status.
   */
  sendStatusText(
    jid: string,
    text: string,
    args: { statusJidList: string[]; backgroundColor?: string; font?: number },
    options?: Omit<
      MiscMessageGenerationOptions,
      'statusJidList' | 'backgroundColor' | 'font' | 'broadcast'
    >
  ) {
    return this.baileysHelpersService.send(
      jid,
      { text },
      {
        ...(options || {}),
        statusJidList: args.statusJidList,
        backgroundColor: args.backgroundColor,
        font: args.font,
        broadcast: true,
      }
    );
  }
}
