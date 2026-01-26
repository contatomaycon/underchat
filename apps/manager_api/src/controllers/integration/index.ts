import { injectable } from 'tsyringe';
import { viewIntegration } from './methods/viewIntegration';
import { updateIntegrationStatus } from './methods/updateIntegrationStatus';
import { generateIntegrationKey } from './methods/generateIntegrationKey';

@injectable()
class IntegrationController {
  public viewIntegration = viewIntegration;
  public updateIntegrationStatus = updateIntegrationStatus;
  public generateIntegrationKey = generateIntegrationKey;
}

export default IntegrationController;
