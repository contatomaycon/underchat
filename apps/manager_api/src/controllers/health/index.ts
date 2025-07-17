import { injectable } from 'tsyringe';
import { viewHealth } from './methods/viewHealth';

@injectable()
class HealthController {
  public view = viewHealth;
}

export default HealthController;
