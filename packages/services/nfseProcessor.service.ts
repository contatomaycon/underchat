import { injectable, inject } from 'tsyringe';
import { AsaasService } from '@core/services/asaas';
import { AccountPaymentNfSeUpserterRepository } from '@core/repositories/account/AccountPaymentNfSeUpserter.repository';
import { AsaasNfseWebhookRequest } from '@core/schema/nfse/Webhook/request.schema';

@injectable()
export class NfseProcessorService {
  constructor(
    @inject(AsaasService)
    private readonly asaasService: AsaasService,
    @inject(AccountPaymentNfSeUpserterRepository)
    private readonly accountPaymentNfSeUpserterRepository: AccountPaymentNfSeUpserterRepository
  ) {}

  processWebhookEvent = async (
    data: AsaasNfseWebhookRequest
  ): Promise<void> => {
    const invoiceId = data.invoice.id;
    const paymentId = data.invoice.payment;

    if (!paymentId) {
      throw new Error('Payment ID não encontrado no webhook');
    }

    const accountPayment =
      await this.accountPaymentNfSeUpserterRepository.findAccountPaymentByBilling(
        paymentId
      );

    if (!accountPayment) {
      throw new Error(
        `Account payment não encontrado para billing: ${paymentId}`
      );
    }

    const invoiceData = await this.asaasService.getInvoice(invoiceId);

    if (!invoiceData) {
      throw new Error(`Invoice não encontrada no Asaas: ${invoiceId}`);
    }

    await this.accountPaymentNfSeUpserterRepository.upsertAccountPaymentNfSe(
      accountPayment.account_payment_id,
      invoiceData
    );
  };
}
