import { injectable } from 'tsyringe';
import { MiscMessageGenerationOptions } from '@whiskeysockets/baileys';
import { IMediaInput } from '@core/common/interfaces/IMediaInput';
import { BaileysHelpersService } from './helpers.service';
import { IStatusOmitKeys } from '@core/common/interfaces/IStatusOmitKeys';
import { IStatusArgs } from '@core/common/interfaces/IStatusArgs';
import { IStatusTextArgs } from '@core/common/interfaces/IStatusTextArgs';

@injectable()
export class BaileysMessageStatusStoriesService {
  constructor(private readonly baileysHelpersService: BaileysHelpersService) {}

  async sendStatusImage(
    jid: string,
    media: IMediaInput,
    args: IStatusArgs,
    options?: Omit<MiscMessageGenerationOptions, IStatusOmitKeys>
  ) {
    console.dir(args.statusJidList, { depth: null, colors: true });

    return this.baileysHelpersService.send(
      jid,
      { image: media, caption: args.caption },
      {
        ...options,
        statusJidList: args.statusJidList ?? [],
        backgroundColor: args.backgroundColor,
        font: args.font,
        broadcast: true,
      }
    );
  }

  sendStatusVideo(
    jid: string,
    media: IMediaInput,
    args: IStatusArgs,
    options?: Omit<MiscMessageGenerationOptions, IStatusOmitKeys>
  ) {
    return this.baileysHelpersService.send(
      jid,
      { video: media, caption: args.caption },
      {
        ...options,
        statusJidList: args.statusJidList ?? [],
        backgroundColor: args.backgroundColor,
        font: args.font,
        broadcast: true,
      }
    );
  }

  sendStatusText(
    jid: string,
    text: string,
    args: IStatusTextArgs,
    options?: Omit<MiscMessageGenerationOptions, IStatusOmitKeys>
  ) {
    return this.baileysHelpersService.send(
      jid,
      { text },
      {
        ...options,
        statusJidList: args.statusJidList ?? [],
        backgroundColor: args.backgroundColor,
        font: args.font,
        broadcast: true,
      }
    );
  }

  sendStatusAudio(
    jid: string,
    media: IMediaInput,
    args: IStatusArgs,
    options?: Omit<MiscMessageGenerationOptions, IStatusOmitKeys>
  ) {
    return this.baileysHelpersService.send(
      jid,
      { audio: media, caption: args.caption },
      {
        ...options,
        statusJidList: args.statusJidList ?? [],
        backgroundColor: args.backgroundColor,
        font: args.font,
        broadcast: true,
      }
    );
  }
}
