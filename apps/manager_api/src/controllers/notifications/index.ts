import { injectable } from 'tsyringe';
import { listNotifications } from './methods/listNotifications';
import { updateNotifications } from './methods/updateNotifications';
import { listWorkers } from './methods/listWorkers';

@injectable()
class NotificationsController {
  public listNotifications = listNotifications;
  public updateNotifications = updateNotifications;
  public listWorkers = listWorkers;
}

export default NotificationsController;
