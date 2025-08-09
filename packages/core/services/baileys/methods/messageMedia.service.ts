import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  proto,
  WAMediaUpload,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';
import { IMediaInput } from '@core/common/interfaces/IMediaInput';

@injectable()
export class BaileysMessageMediaService {
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
   * Envia uma imagem com caption opcional, miniatura e dimensões.
   */
  sendImage(
    jid: string,
    image: IMediaInput,
    args?: {
      caption?: string;
      jpegThumbnail?: string;
      width?: number;
      height?: number;
      viewOnce?: boolean;
    },
    options?: MiscMessageGenerationOptions
  ) {
    const content: AnyMessageContent = {
      image: image as WAMediaUpload,
      caption: args?.caption,
      jpegThumbnail: args?.jpegThumbnail,
      width: args?.width,
      height: args?.height,
      viewOnce: args?.viewOnce,
    };

    return this.send(jid, content, options);
  }

  /**
   * Envia vídeo, podendo ser como GIF (gifPlayback: true) ou vídeo note (ptv: true).
   */
  sendVideo(
    jid: string,
    video: IMediaInput,
    args?: {
      caption?: string;
      gifPlayback?: boolean;
      jpegThumbnail?: string;
      ptv?: boolean;
      width?: number;
      height?: number;
      viewOnce?: boolean;
    },
    options?: MiscMessageGenerationOptions
  ) {
    const content: AnyMessageContent = {
      video: video as WAMediaUpload,
      caption: args?.caption,
      gifPlayback: !!args?.gifPlayback,
      jpegThumbnail: args?.jpegThumbnail,
      ptv: !!args?.ptv,
      width: args?.width,
      height: args?.height,
      viewOnce: args?.viewOnce,
    };

    return this.send(jid, content, options);
  }

  /**
   * Envia áudio ou mensagem de voz (ptt: true).
   */
  sendAudio(
    jid: string,
    audio: IMediaInput,
    args?: {
      ptt?: boolean;
      seconds?: number;
      mimetype?: string;
    },
    options?: MiscMessageGenerationOptions
  ) {
    const content: AnyMessageContent = {
      audio: audio as WAMediaUpload,
      ptt: !!args?.ptt,
      seconds: args?.seconds,
      mimetype: args?.mimetype,
    };

    return this.send(jid, content, options);
  }

  /**
   * Envia figurinhas (estáticas ou animadas).
   */
  sendSticker(
    jid: string,
    sticker: IMediaInput,
    args?: {
      isAnimated?: boolean;
      width?: number;
      height?: number;
    },
    options?: MiscMessageGenerationOptions
  ) {
    const content: AnyMessageContent = {
      sticker: sticker as WAMediaUpload,
      isAnimated: !!args?.isAnimated,
      width: args?.width,
      height: args?.height,
    };

    return this.send(jid, content, options);
  }

  /**
   * Envia documento (PDF, DOCX, etc) com mimetype e nome do arquivo.
   */
  sendDocument(
    jid: string,
    document: IMediaInput,
    args: {
      mimetype: string;
      fileName?: string;
      caption?: string;
    },
    options?: MiscMessageGenerationOptions
  ) {
    const content: AnyMessageContent = {
      document: document as WAMediaUpload,
      mimetype: args.mimetype,
      fileName: args.fileName,
      caption: args.caption,
    };

    return this.send(jid, content, options);
  }

  /**
   * Envia imagem que só pode ser vista uma vez.
   */
  sendViewOnceImage(
    jid: string,
    media: IMediaInput,
    caption?: string,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(
      jid,
      { image: media as WAMediaUpload, viewOnce: true, caption },
      options
    );
  }

  /**
   * Envia vídeo que só pode ser visto uma vez.
   */
  sendViewOnceVideo(
    jid: string,
    media: IMediaInput,
    caption?: string,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(
      jid,
      { video: media as WAMediaUpload, viewOnce: true, caption },
      options
    );
  }
}
