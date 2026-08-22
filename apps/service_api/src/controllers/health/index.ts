import { injectable } from 'tsyringe';
import { viewHealth, viewLiveness, viewReadiness } from './methods/viewHealth';

@injectable()
class HealthController {
  public view = viewHealth;
  public live = viewLiveness;
  public ready = viewReadiness;
}

export default HealthController;
