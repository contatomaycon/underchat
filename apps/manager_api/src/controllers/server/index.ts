import { injectable } from 'tsyringe';
import { createServer } from './methods/createServer';
import { deleteServer } from './methods/deleteServer';
import { editServer } from './methods/editServer';

@injectable()
class ServerController {
  public createServer = createServer;
  public deleteServer = deleteServer;
  public editServer = editServer;
}

export default ServerController;
