import { injectable, inject } from 'tsyringe';
import {
  MiscMessageGenerationOptions,
  WAMessageKey,
} from '@whiskeysockets/baileys';
import { IMediaInput } from '@core/common/interfaces/IMediaInput';
import { BaileysHelpersService } from './helpers.service';
import { BaileysMessageEditDeleteService } from './messageEditDelete.service';
import { IStatusOmitKeys } from '@core/common/interfaces/IStatusOmitKeys';
import { IStatusArgs } from '@core/common/interfaces/IStatusArgs';
import { IStatusTextArgs } from '@core/common/interfaces/IStatusTextArgs';

@injectable()
export class BaileysMessageStatusStoriesService {
  constructor(
    @inject(BaileysHelpersService)
    private readonly baileysHelpersService: BaileysHelpersService,
    @inject(BaileysMessageEditDeleteService)
    private readonly baileysMessageEditDeleteService: BaileysMessageEditDeleteService
  ) {}

  async sendStatusImage(
    jid: string,
    media: IMediaInput,
    args: IStatusArgs,
    options?: Omit<MiscMessageGenerationOptions, IStatusOmitKeys>,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const statusJidList = this.baileysHelpersService.addOwnJidToStatusList(
      args.statusJidList ?? []
    );

    const content = { image: media, caption: args.caption };
    const sendOptions = {
      ...options,
      statusJidList,
      backgroundColor: args.backgroundColor,
      font: args.font,
      broadcast: true,
    };
    return beforeProviderInvoke
      ? this.baileysHelpersService.send(
          jid,
          content,
          sendOptions,
          beforeProviderInvoke
        )
      : this.baileysHelpersService.send(jid, content, sendOptions);
  }

  sendStatusVideo(
    jid: string,
    media: IMediaInput,
    args: IStatusArgs,
    options?: Omit<MiscMessageGenerationOptions, IStatusOmitKeys>,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const statusJidList = this.baileysHelpersService.addOwnJidToStatusList(
      args.statusJidList ?? []
    );

    const content = { video: media, caption: args.caption };
    const sendOptions = {
      ...options,
      statusJidList,
      backgroundColor: args.backgroundColor,
      font: args.font,
      broadcast: true,
    };
    return beforeProviderInvoke
      ? this.baileysHelpersService.send(
          jid,
          content,
          sendOptions,
          beforeProviderInvoke
        )
      : this.baileysHelpersService.send(jid, content, sendOptions);
  }

  sendStatusText(
    jid: string,
    text: string,
    args: IStatusTextArgs,
    options?: Omit<MiscMessageGenerationOptions, IStatusOmitKeys>,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const statusJidList = this.baileysHelpersService.addOwnJidToStatusList(
      args.statusJidList ?? []
    );

    const content = { text };
    const sendOptions = {
      ...options,
      statusJidList,
      backgroundColor: args.backgroundColor,
      font: args.font,
      broadcast: true,
    };
    return beforeProviderInvoke
      ? this.baileysHelpersService.send(
          jid,
          content,
          sendOptions,
          beforeProviderInvoke
        )
      : this.baileysHelpersService.send(jid, content, sendOptions);
  }

  sendStatusAudio(
    jid: string,
    media: IMediaInput,
    args: IStatusArgs,
    options?: Omit<MiscMessageGenerationOptions, IStatusOmitKeys>,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const statusJidList = this.baileysHelpersService.addOwnJidToStatusList(
      args.statusJidList ?? []
    );

    const content = { audio: media, caption: args.caption };
    const sendOptions = {
      ...options,
      statusJidList,
      backgroundColor: args.backgroundColor,
      font: args.font,
      broadcast: true,
    };
    return beforeProviderInvoke
      ? this.baileysHelpersService.send(
          jid,
          content,
          sendOptions,
          beforeProviderInvoke
        )
      : this.baileysHelpersService.send(jid, content, sendOptions);
  }

  deleteStatus(
    externalId: string,
    statusJidList?: string[],
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const jid = 'status@broadcast';
    const key: WAMessageKey = {
      remoteJid: jid,
      fromMe: true,
      id: externalId,
    };

    const finalStatusJidList = this.baileysHelpersService.addOwnJidToStatusList(
      statusJidList ?? []
    );

    const sendOptions = {
      broadcast: true,
      statusJidList: finalStatusJidList,
    };
    return beforeProviderInvoke
      ? this.baileysMessageEditDeleteService.deleteMessage(
          jid,
          key,
          sendOptions,
          beforeProviderInvoke
        )
      : this.baileysMessageEditDeleteService.deleteMessage(
          jid,
          key,
          sendOptions
        );
  }
}
