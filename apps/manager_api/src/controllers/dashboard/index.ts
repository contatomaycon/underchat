import { injectable } from 'tsyringe';
import { getDashboardStats } from './methods/getDashboardStats';
import { getDashboardConversations } from './methods/getDashboardConversations';

@injectable()
class DashboardController {
  public getDashboardStats = getDashboardStats;
  public getDashboardConversations = getDashboardConversations;
}

export default DashboardController;
