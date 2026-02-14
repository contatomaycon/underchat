import { injectable } from 'tsyringe';
import { viewHealth } from './methods/viewHealth';
import { viewConnectionHealth } from './methods/viewConnectionHealth';

@injectable()
class HealthController {
  public view = viewHealth;
  public viewConnectionHealth = viewConnectionHealth;
}

export default HealthController;
