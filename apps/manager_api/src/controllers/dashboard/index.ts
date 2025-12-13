import { injectable } from 'tsyringe';
import { getDashboardStats } from './methods/getDashboardStats';
import { getDashboardConversations } from './methods/getDashboardConversations';
import { getDashboardAdditional } from './methods/getDashboardAdditional';

@injectable()
class DashboardController {
  public getDashboardStats = getDashboardStats;
  public getDashboardConversations = getDashboardConversations;
  public getDashboardAdditional = getDashboardAdditional;
}

export default DashboardController;
