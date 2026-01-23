import { injectable } from 'tsyringe';
import { getDashboardStats } from './methods/getDashboardStats';
import { getDashboardConversations } from './methods/getDashboardConversations';
import { getDashboardAdditional } from './methods/getDashboardAdditional';
import { listOfflineChannels } from './methods/listOfflineChannels';

@injectable()
class DashboardController {
  public getDashboardStats = getDashboardStats;
  public getDashboardConversations = getDashboardConversations;
  public getDashboardAdditional = getDashboardAdditional;
  public listOfflineChannels = listOfflineChannels;
}

export default DashboardController;
