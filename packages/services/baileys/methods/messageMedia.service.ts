import { injectable, inject } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  proto,
  WAMediaUpload,
} from '@whiskeysockets/baileys';
import { IMediaInput } from '@core/common/interfaces/IMediaInput';
import { BaileysHelpersService } from './helpers.service';

interface IBaileysMediaMetadataArgs {
  mimetype?: string;
  fileName?: string;
  filesize?: number;
}

@injectable()
export class BaileysMessageMediaService {
  constructor(
    @inject(BaileysHelpersService)
    private readonly baileysHelpersService: BaileysHelpersService
  ) {}

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
      contextInfo?: proto.IContextInfo;
    },
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const content: AnyMessageContent = {
      image: image as WAMediaUpload,
      caption: args?.caption,
      jpegThumbnail: args?.jpegThumbnail,
      width: args?.width,
      height: args?.height,
      viewOnce: args?.viewOnce,
      contextInfo: args?.contextInfo,
    };

    return this.sendWithBoundary(jid, content, options, beforeProviderInvoke);
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
      seconds?: number;
      mimetype?: string;
      fileName?: string;
      filesize?: number;
      contextInfo?: proto.IContextInfo;
    },
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const mimetype = 'video/mp4';
    const media = this.withMediaMetadata(video, {
      ...args,
      mimetype,
    });

    const content: AnyMessageContent = {
      video: media as WAMediaUpload,
      caption: args?.caption,
      gifPlayback: !!args?.gifPlayback,
      jpegThumbnail: args?.jpegThumbnail,
      ptv: !!args?.ptv,
      width: args?.width,
      height: args?.height,
      viewOnce: args?.viewOnce,
      seconds: args?.seconds,
      mimetype,
      contextInfo: args?.contextInfo,
    };

    return this.sendWithBoundary(jid, content, options, beforeProviderInvoke);
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
      fileName?: string;
      filesize?: number;
      viewOnce?: boolean;
      waveform?: Uint8Array;
      contextInfo?: proto.IContextInfo;
    },
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const isViewOnce = args?.viewOnce === true;
    const isPtt = isViewOnce ? true : !!args?.ptt;
    const mimetype = isPtt ? 'audio/ogg; codecs=opus' : 'audio/mpeg';
    const media = this.withMediaMetadata(audio, {
      ...args,
      mimetype,
    });

    const content: AnyMessageContent = isViewOnce
      ? ({
          audio: media as WAMediaUpload,
          ptt: true,
          seconds: args?.seconds,
          mimetype,
          waveform: args?.waveform,
          viewOnce: true,
          contextInfo: args?.contextInfo,
        } as AnyMessageContent)
      : ({
          audio: media as WAMediaUpload,
          ptt: isPtt,
          seconds: args?.seconds,
          mimetype,
          waveform: args?.waveform,
          contextInfo: args?.contextInfo,
        } as AnyMessageContent);

    return this.sendWithBoundary(jid, content, options, beforeProviderInvoke);
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
      contextInfo?: proto.IContextInfo;
    },
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const content: AnyMessageContent = {
      sticker: sticker as WAMediaUpload,
      isAnimated: !!args?.isAnimated,
      width: args?.width,
      height: args?.height,
      contextInfo: args?.contextInfo,
    };

    return this.sendWithBoundary(jid, content, options, beforeProviderInvoke);
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
      filesize?: number;
      caption?: string;
      contextInfo?: proto.IContextInfo;
    },
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const media = this.withMediaMetadata(document, args);

    const content: AnyMessageContent = {
      document: media as WAMediaUpload,
      mimetype: args.mimetype,
      fileName: args.fileName,
      caption: args.caption,
      contextInfo: args.contextInfo,
    };

    return this.sendWithBoundary(jid, content, options, beforeProviderInvoke);
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
    return this.baileysHelpersService.send(
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
    return this.baileysHelpersService.send(
      jid,
      { video: media as WAMediaUpload, viewOnce: true, caption },
      options
    );
  }

  private withMediaMetadata(
    input: IMediaInput,
    args?: IBaileysMediaMetadataArgs
  ): IMediaInput {
    if (typeof input !== 'object' || input === null) {
      return input;
    }

    if (!('url' in input) && !('stream' in input)) {
      return input;
    }

    return {
      ...input,
      mimetype: args?.mimetype ?? input.mimetype ?? undefined,
      filename: args?.fileName ?? input.filename ?? undefined,
      filesize: args?.filesize ?? input.filesize ?? undefined,
    } as IMediaInput;
  }

  private sendWithBoundary(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    return beforeProviderInvoke
      ? this.baileysHelpersService.send(
          jid,
          content,
          options,
          beforeProviderInvoke
        )
      : this.baileysHelpersService.send(jid, content, options);
  }
}
