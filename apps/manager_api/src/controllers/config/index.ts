import { injectable } from 'tsyringe';
import { listNotifications } from '@/controllers/notifications/methods/listNotifications';
import { updateNotifications } from '@/controllers/notifications/methods/updateNotifications';
import { listWorkers } from '@/controllers/notifications/methods/listWorkers';
import { listNfse } from './methods/listNfse';
import { updateNfse } from './methods/updateNfse';

@injectable()
class ConfigController {
  public listNotifications = listNotifications;
  public updateNotifications = updateNotifications;
  public listWorkers = listWorkers;
  public listNfse = listNfse;
  public updateNfse = updateNfse;
}

export default ConfigController;
