import { injectable } from 'tsyringe';
import {
  MiscMessageGenerationOptions,
  WAMessageKey,
} from '@whiskeysockets/baileys';
import { IMediaInput } from '@core/common/interfaces/IMediaInput';
import { BaileysHelpersService } from './helpers.service';
import { BaileysConnectionService } from './connection.service';
import { BaileysMessageEditDeleteService } from './messageEditDelete.service';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { IStatusOmitKeys } from '@core/common/interfaces/IStatusOmitKeys';
import { IStatusArgs } from '@core/common/interfaces/IStatusArgs';
import { IStatusTextArgs } from '@core/common/interfaces/IStatusTextArgs';

@injectable()
export class BaileysMessageStatusStoriesService {
  constructor(
    private readonly baileysHelpersService: BaileysHelpersService,
    private readonly baileysConnectionService: BaileysConnectionService,
    private readonly baileysMessageEditDeleteService: BaileysMessageEditDeleteService
  ) {}

  async sendStatusImage(
    jid: string,
    media: IMediaInput,
    args: IStatusArgs,
    options?: Omit<MiscMessageGenerationOptions, IStatusOmitKeys>
  ) {
    const statusJidList = this.addOwnJidToStatusList(args.statusJidList ?? []);

    return this.baileysHelpersService.send(
      jid,
      { image: media, caption: args.caption },
      {
        ...options,
        statusJidList,
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
    const statusJidList = this.addOwnJidToStatusList(args.statusJidList ?? []);

    return this.baileysHelpersService.send(
      jid,
      { video: media, caption: args.caption },
      {
        ...options,
        statusJidList,
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
    const statusJidList = this.addOwnJidToStatusList(args.statusJidList ?? []);

    return this.baileysHelpersService.send(
      jid,
      { text },
      {
        ...options,
        statusJidList,
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
    const statusJidList = this.addOwnJidToStatusList(args.statusJidList ?? []);

    return this.baileysHelpersService.send(
      jid,
      { audio: media, caption: args.caption },
      {
        ...options,
        statusJidList,
        backgroundColor: args.backgroundColor,
        font: args.font,
        broadcast: true,
      }
    );
  }

  deleteStatus(externalId: string, statusJidList?: string[]) {
    const jid = 'status@broadcast';
    const key: WAMessageKey = {
      remoteJid: jid,
      fromMe: true,
      id: externalId,
    };

    const finalStatusJidList = this.addOwnJidToStatusList(statusJidList ?? []);

    return this.baileysMessageEditDeleteService.deleteMessage(jid, key, {
      broadcast: true,
      statusJidList: finalStatusJidList,
    });
  }

  private addOwnJidToStatusList(statusJidList: string[]): string[] {
    const socket = this.baileysConnectionService.getSocket();
    const ownJidRaw = socket?.user?.id;

    if (!ownJidRaw) {
      return statusJidList;
    }

    const ownJid = normalizeJid(ownJidRaw);

    if (!ownJid) {
      return statusJidList;
    }

    const normalizedStatusJidList = statusJidList.map(
      (jid) => normalizeJid(jid) ?? jid
    );
    const ownJidExists = normalizedStatusJidList.some((jid) => jid === ownJid);

    if (!ownJidExists) {
      return [...statusJidList, ownJid];
    }

    return statusJidList;
  }
}
