import { injectable } from 'tsyringe';
import { viewMetrics } from './methods/viewMetrics';

@injectable()
class MetricsController {
  public viewMetrics = viewMetrics;
}

export default MetricsController;
