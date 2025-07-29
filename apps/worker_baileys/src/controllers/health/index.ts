import { injectable } from 'tsyringe';
import { viewHealth } from './methods/viewHealth';
import { teste } from './methods/teste';

@injectable()
class HealthController {
  public view = viewHealth;
  public teste = teste;
}

export default HealthController;
