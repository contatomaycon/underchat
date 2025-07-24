import { injectable } from 'tsyringe';
import { createServer } from './methods/createServer';
import { deleteServer } from './methods/deleteServer';
import { editServer } from './methods/editServer';
import { viewServer } from './methods/viewServer';

@injectable()
class ServerController {
  public createServer = createServer;
  public deleteServer = deleteServer;
  public editServer = editServer;
  public viewServer = viewServer;
}

export default ServerController;
