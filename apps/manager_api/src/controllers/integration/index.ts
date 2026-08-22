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
import { viewPublicApiToken } from './methods/viewPublicApiToken';
import { generatePublicApiToken } from './methods/generatePublicApiToken';
import { revokePublicApiToken } from './methods/revokePublicApiToken';
import {
  activateOutboundWebhook,
  createOutboundWebhook,
  deleteOutboundWebhook,
  listOutboundWebhookDeliveries,
  listOutboundWebhookEvents,
  listOutboundWebhooks,
  redeliverOutboundWebhookDelivery,
  rotateOutboundWebhookSecret,
  testOutboundWebhook,
  updateOutboundWebhook,
  viewOutboundWebhook,
  viewOutboundWebhookDelivery,
} from './methods/outboundWebhook';

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
  public viewPublicApiToken = viewPublicApiToken;
  public generatePublicApiToken = generatePublicApiToken;
  public revokePublicApiToken = revokePublicApiToken;
  public listOutboundWebhookEvents = listOutboundWebhookEvents;
  public listOutboundWebhooks = listOutboundWebhooks;
  public viewOutboundWebhook = viewOutboundWebhook;
  public createOutboundWebhook = createOutboundWebhook;
  public updateOutboundWebhook = updateOutboundWebhook;
  public deleteOutboundWebhook = deleteOutboundWebhook;
  public testOutboundWebhook = testOutboundWebhook;
  public rotateOutboundWebhookSecret = rotateOutboundWebhookSecret;
  public activateOutboundWebhook = activateOutboundWebhook;
  public listOutboundWebhookDeliveries = listOutboundWebhookDeliveries;
  public viewOutboundWebhookDelivery = viewOutboundWebhookDelivery;
  public redeliverOutboundWebhookDelivery = redeliverOutboundWebhookDelivery;
}

export default IntegrationController;
