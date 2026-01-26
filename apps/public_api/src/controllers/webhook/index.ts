import { injectable } from 'tsyringe';
import { receiveWebhook } from './methods/receiveWebhook';

@injectable()
class WebhookController {
  public receiveWebhook = receiveWebhook;
}

export default WebhookController;
