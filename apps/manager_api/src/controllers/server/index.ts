import { injectable } from 'tsyringe';
import { createServer } from './methods/createServer';
import { deleteServer } from './methods/deleteServer';

@injectable()
class ServerController {
  public createServer = createServer;
  public deleteServer = deleteServer;
}

export default ServerController;
