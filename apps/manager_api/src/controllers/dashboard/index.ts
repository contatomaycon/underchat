import { injectable } from 'tsyringe';
import { getDashboardStats } from './methods/getDashboardStats';
import { getDashboardConversations } from './methods/getDashboardConversations';
import { getDashboardAdditional } from './methods/getDashboardAdditional';
import { listOfflineChannels } from '@core/controllers/dashboard/methods/listOfflineChannels';

@injectable()
class DashboardController {
  public getDashboardStats = getDashboardStats;
  public getDashboardConversations = getDashboardConversations;
  public getDashboardAdditional = getDashboardAdditional;
  public listOfflineChannels = listOfflineChannels;
}

export default DashboardController;
