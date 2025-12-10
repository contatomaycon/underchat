import { injectable } from 'tsyringe';
import { listNotifications } from '@/controllers/notifications/methods/listNotifications';
import { updateNotifications } from '@/controllers/notifications/methods/updateNotifications';
import { listWorkers } from '@/controllers/notifications/methods/listWorkers';
import { listSentNotifications } from '@/controllers/notifications/methods/listSentNotifications';
import { listNfse } from './methods/listNfse';
import { updateNfse } from './methods/updateNfse';
import { listChannels } from './methods/listChannels';
import { listAccounts } from './methods/listAccounts';
import { recreateChannel } from './methods/recreateChannel';
import { deleteChannel } from './methods/deleteChannel';
import { recreateChannelsAll } from './methods/recreateChannelsAll';
import { channelsStatistics } from './methods/channelsStatistics';

@injectable()
class ConfigController {
  public listNotifications = listNotifications;
  public updateNotifications = updateNotifications;
  public listWorkers = listWorkers;
  public listSentNotifications = listSentNotifications;
  public listNfse = listNfse;
  public updateNfse = updateNfse;
  public listChannels = listChannels;
  public listAccounts = listAccounts;
  public recreateChannel = recreateChannel;
  public deleteChannel = deleteChannel;
  public recreateChannelsAll = recreateChannelsAll;
  public channelsStatistics = channelsStatistics;
}

export default ConfigController;
