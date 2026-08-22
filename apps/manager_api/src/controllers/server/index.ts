import { injectable } from 'tsyringe';
import { createServer } from './methods/createServer';
import { deleteServer } from './methods/deleteServer';
import { editServer } from './methods/editServer';
import { viewServer } from './methods/viewServer';
import { listServer } from './methods/listServer';
import { serverLogsInstall } from './methods/serverLogsInstall';
import { reinstallServer } from './methods/reinstallServer';
import { cancelInstallServer } from './methods/cancelInstallServer';
import { listServerBuild } from './methods/listServerBuild';
import { generateServerBuild } from './methods/generateServerBuild';
import { cancelServerBuild } from './methods/cancelServerBuild';
import { setServerBuildDefault } from './methods/setServerBuildDefault';
import { retryServerBuild } from './methods/retryServerBuild';
import { deleteServerBuild } from './methods/deleteServerBuild';
import { deleteServerBuildVersion } from './methods/deleteServerBuildVersion';
import { pairServerBuild } from './methods/pairServerBuild';

@injectable()
class ServerController {
  public createServer = createServer;
  public deleteServer = deleteServer;
  public editServer = editServer;
  public viewServer = viewServer;
  public listServer = listServer;
  public serverLogsInstall = serverLogsInstall;
  public reinstallServer = reinstallServer;
  public cancelInstallServer = cancelInstallServer;
  public listServerBuild = listServerBuild;
  public generateServerBuild = generateServerBuild;
  public cancelServerBuild = cancelServerBuild;
  public setServerBuildDefault = setServerBuildDefault;
  public retryServerBuild = retryServerBuild;
  public deleteServerBuild = deleteServerBuild;
  public deleteServerBuildVersion = deleteServerBuildVersion;
  public pairServerBuild = pairServerBuild;
}

export default ServerController;
