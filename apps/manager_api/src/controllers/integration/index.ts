import { injectable } from 'tsyringe';
import { listIntegrations } from './methods/listIntegrations';
import { createIntegration } from './methods/createIntegration';
import { updateIntegration } from './methods/updateIntegration';
import { deleteIntegration } from './methods/deleteIntegration';
import { viewIntegrationById } from './methods/viewIntegrationById';
import { updateIntegrationStatus } from './methods/updateIntegrationStatus';
import { generateIntegrationKey } from './methods/generateIntegrationKey';
import { listAvailableChannels } from './methods/listAvailableChannels';
import { viewWebhookMapping } from './methods/viewWebhookMapping';
import { saveWebhookMapping } from './methods/saveWebhookMapping';
import { viewWebhookData } from './methods/viewWebhookData';
import { listUsers } from './methods/listUsers';
import { listSectors } from './methods/listSectors';
import { listSectorUsers } from './methods/listSectorUsers';
import { listInputChatbots } from './methods/listInputChatbots';

@injectable()
class IntegrationController {
  public listIntegrations = listIntegrations;
  public createIntegration = createIntegration;
  public updateIntegration = updateIntegration;
  public deleteIntegration = deleteIntegration;
  public viewIntegrationById = viewIntegrationById;
  public updateIntegrationStatus = updateIntegrationStatus;
  public generateIntegrationKey = generateIntegrationKey;
  public listAvailableChannels = listAvailableChannels;
  public viewWebhookMapping = viewWebhookMapping;
  public saveWebhookMapping = saveWebhookMapping;
  public viewWebhookData = viewWebhookData;
  public listUsers = listUsers;
  public listSectors = listSectors;
  public listSectorUsers = listSectorUsers;
  public listInputChatbots = listInputChatbots;
}

export default IntegrationController;
