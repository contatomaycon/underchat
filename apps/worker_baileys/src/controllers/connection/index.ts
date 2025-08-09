import { injectable } from 'tsyringe';
import { connectionHealthCheck } from './methods/connectionHealthCheck';

@injectable()
class ConnectionController {
  public connectionHealthCheck = connectionHealthCheck;
}

export default ConnectionController;
