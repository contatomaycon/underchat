import { injectable } from 'tsyringe';
import { listNotifications } from './methods/listNotifications';
import { updateNotifications } from './methods/updateNotifications';
import { listWorkers } from './methods/listWorkers';
import { listSentNotifications } from './methods/listSentNotifications';

@injectable()
class NotificationsController {
  public listNotifications = listNotifications;
  public updateNotifications = updateNotifications;
  public listWorkers = listWorkers;
  public listSentNotifications = listSentNotifications;
}

export default NotificationsController;
