import { injectable } from 'tsyringe';
import { authToken } from './methods/authToken';

@injectable()
class CentrifugoController {
  public authToken = authToken;
}

export default CentrifugoController;
