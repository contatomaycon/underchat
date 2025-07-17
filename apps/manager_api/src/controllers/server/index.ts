import { injectable } from 'tsyringe';
import { createServer } from './methods/createServer';

@injectable()
class ServerController {
  public createServer = createServer;
}

export default ServerController;
