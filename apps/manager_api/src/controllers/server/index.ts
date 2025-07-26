import { injectable } from 'tsyringe';
import { createServer } from './methods/createServer';
import { deleteServer } from './methods/deleteServer';
import { editServer } from './methods/editServer';
import { viewServer } from './methods/viewServer';
import { listServer } from './methods/listServer';
import { serverLogsInstall } from './methods/serverLogsInstall';

@injectable()
class ServerController {
  public createServer = createServer;
  public deleteServer = deleteServer;
  public editServer = editServer;
  public viewServer = viewServer;
  public listServer = listServer;
  public serverLogsInstall = serverLogsInstall;
}

export default ServerController;
