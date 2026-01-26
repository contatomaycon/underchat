import { injectable } from 'tsyringe';
import { viewIntegration } from './methods/viewIntegration';
import { updateIntegrationStatus } from './methods/updateIntegrationStatus';
import { generateIntegrationKey } from './methods/generateIntegrationKey';
import { viewWebhookMapping } from './methods/viewWebhookMapping';
import { saveWebhookMapping } from './methods/saveWebhookMapping';
import { viewWebhookData } from './methods/viewWebhookData';

@injectable()
class IntegrationController {
  public viewIntegration = viewIntegration;
  public updateIntegrationStatus = updateIntegrationStatus;
  public generateIntegrationKey = generateIntegrationKey;
  public viewWebhookMapping = viewWebhookMapping;
  public saveWebhookMapping = saveWebhookMapping;
  public viewWebhookData = viewWebhookData;
}

export default IntegrationController;
