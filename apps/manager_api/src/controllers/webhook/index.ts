import { invoiceWebhook } from './methods/invoiceWebhook';
import { nfseWebhook } from './methods/nfseWebhook';
import { receiveWhatsappEmbeddedWebhook } from './methods/receiveWhatsappEmbeddedWebhook';
import { verifyWhatsappEmbeddedWebhook } from './methods/verifyWhatsappEmbeddedWebhook';

export default class WebhookController {
  invoiceWebhook = invoiceWebhook;
  nfseWebhook = nfseWebhook;
  verifyWhatsappEmbeddedWebhook = verifyWhatsappEmbeddedWebhook;
  receiveWhatsappEmbeddedWebhook = receiveWhatsappEmbeddedWebhook;
}
