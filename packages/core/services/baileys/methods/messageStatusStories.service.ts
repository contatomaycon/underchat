import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  proto,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';
import { IMediaInput } from '@core/common/interfaces/IMediaInput';

@injectable()
export class BaileysMessageStatusStoriesService {
  constructor(private readonly connection: BaileysConnectionService) {}

  private socket() {
    const s = this.connection.getSocket();
    if (!s) {
      throw new Error('Socket not connected');
    }

    return s;
  }

  send(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ): Promise<proto.WebMessageInfo | undefined> {
    return this.socket().sendMessage(jid, content, options);
  }

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
    return this.send(
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
    return this.send(
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
    return this.send(
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
