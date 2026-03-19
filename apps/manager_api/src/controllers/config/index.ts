import { injectable } from 'tsyringe';
import { listNotifications } from '@/controllers/notifications/methods/listNotifications';
import { updateNotifications } from '@/controllers/notifications/methods/updateNotifications';
import { listWorkers } from '@/controllers/notifications/methods/listWorkers';
import { listSentNotifications } from '@/controllers/notifications/methods/listSentNotifications';
import { listNfse } from './methods/listNfse';
import { updateNfse } from './methods/updateNfse';
import { uploadNfseCertificate } from './methods/uploadNfseCertificate';
import { listChannels } from './methods/listChannels';
import { listAccounts } from './methods/listAccounts';
import { listChannelServers } from './methods/listChannelServers';
import { recreateChannel } from './methods/recreateChannel';
import { deleteChannel } from './methods/deleteChannel';
import { recreateChannelsAll } from './methods/recreateChannelsAll';
import { channelsStatistics } from './methods/channelsStatistics';
import { listCreditCardFee } from './methods/listCreditCardFee';
import { updateCreditCardFee } from './methods/updateCreditCardFee';
import { checkChannelOpenConversations } from './methods/checkChannelOpenConversations';
import { listMethodPayments } from './methods/listMethodPayments';
import { updateMethodPayment } from './methods/updateMethodPayment';
import { updateChannel } from './methods/updateChannel';

@injectable()
class ConfigController {
  public listNotifications = listNotifications;
  public updateNotifications = updateNotifications;
  public listWorkers = listWorkers;
  public listSentNotifications = listSentNotifications;
  public listNfse = listNfse;
  public updateNfse = updateNfse;
  public uploadNfseCertificate = uploadNfseCertificate;
  public listChannels = listChannels;
  public listAccounts = listAccounts;
  public listChannelServers = listChannelServers;
  public recreateChannel = recreateChannel;
  public deleteChannel = deleteChannel;
  public recreateChannelsAll = recreateChannelsAll;
  public channelsStatistics = channelsStatistics;
  public updateChannel = updateChannel;
  public listCreditCardFee = listCreditCardFee;
  public updateCreditCardFee = updateCreditCardFee;
  public checkChannelOpenConversations = checkChannelOpenConversations;
  public listMethodPayments = listMethodPayments;
  public updateMethodPayment = updateMethodPayment;
}

export default ConfigController;
