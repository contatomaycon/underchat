import 'reflect-metadata';
import { AsaasService } from '@core/services/asaas';

describe('AsaasService', () => {
  it('delegates all methods to internal services', async () => {
    const fn = () => jest.fn<Promise<unknown>, unknown[]>();

    const clients = {
      create: { createCustomer: fn() },
      list: { listCustomers: fn() },
      get: { getCustomer: fn() },
      update: { updateCustomer: fn() },
      delete: { deleteCustomer: fn() },
      restore: { restoreCustomer: fn() },
      getNotifications: { getCustomerNotifications: fn() },
    };

    const payments = {
      create: { createPayment: fn() },
      createCreditCard: { createCreditCardPayment: fn() },
      captureAuthorized: { captureAuthorizedPayment: fn() },
      payWithCreditCard: { payWithCreditCard: fn() },
      get: { getPayment: fn() },
      update: { updatePayment: fn() },
      delete: { deletePayment: fn() },
      restore: { restorePayment: fn() },
      getStatus: { getPaymentStatus: fn() },
      getIdentificationField: { getPaymentIdentificationField: fn() },
      getPixQrCode: { getPaymentPixQrCode: fn() },
      getBillingInfo: { getPaymentBillingInfo: fn() },
      getViewingInfo: { getPaymentViewingInfo: fn() },
      list: { listPayments: fn() },
      documents: {
        upload: { uploadPaymentDocument: fn() },
        list: { listPaymentDocuments: fn() },
        get: { getPaymentDocument: fn() },
        update: { updatePaymentDocument: fn() },
        delete: { deletePaymentDocument: fn() },
      },
    };

    const installments = {
      create: { createInstallment: fn() },
      createWithCreditCard: { createInstallmentWithCreditCard: fn() },
      get: { getInstallment: fn() },
      delete: { deleteInstallment: fn() },
      list: { listInstallments: fn() },
      listPayments: { listInstallmentPayments: fn() },
      getPaymentBook: { getInstallmentPaymentBook: fn() },
      updateSplits: { updateInstallmentSplits: fn() },
      refund: { refundInstallment: fn() },
    };

    const subscriptions = {
      create: { createSubscription: fn() },
      createWithCreditCard: { createSubscriptionWithCreditCard: fn() },
      get: { getSubscription: fn() },
      update: { updateSubscription: fn() },
      updateCreditCard: { updateSubscriptionCreditCard: fn() },
      delete: { deleteSubscription: fn() },
      list: { listSubscriptions: fn() },
      listPayments: { listSubscriptionPayments: fn() },
      getPaymentBook: { getSubscriptionPaymentBook: fn() },
      invoiceSettings: {
        create: { createSubscriptionInvoiceSettings: fn() },
        get: { getSubscriptionInvoiceSettings: fn() },
        update: { updateSubscriptionInvoiceSettings: fn() },
        delete: { deleteSubscriptionInvoiceSettings: fn() },
      },
      listInvoices: { listSubscriptionInvoices: fn() },
    };

    const paymentLinks = {
      create: { createPaymentLink: fn() },
      list: { listPaymentLinks: fn() },
      get: { getPaymentLink: fn() },
      update: { updatePaymentLink: fn() },
      delete: { deletePaymentLink: fn() },
      restore: { restorePaymentLink: fn() },
      images: {
        upload: { uploadPaymentLinkImage: fn() },
        list: { listPaymentLinkImages: fn() },
        get: { getPaymentLinkImage: fn() },
        delete: { deletePaymentLinkImage: fn() },
        setAsMain: { setPaymentLinkImageAsMain: fn() },
      },
    };

    const checkout = {
      create: { createCheckout: fn() },
      cancel: { cancelCheckout: fn() },
    };

    const creditCard = {
      tokenize: { tokenizeCreditCard: fn() },
    };

    const refunds = {
      list: { listPaymentRefunds: fn() },
      refundBankSlip: { refundBankSlip: fn() },
      refundPaymentLean: { refundPaymentLean: fn() },
      refundPayment: { refundPayment: fn() },
    };

    const invoices = {
      create: { createInvoice: fn() },
      list: { listInvoices: fn() },
      update: { updateInvoice: fn() },
      get: { getInvoice: fn() },
      authorize: { authorizeInvoice: fn() },
      cancel: { cancelInvoice: fn() },
    };

    const service = new AsaasService(
      clients as never,
      payments as never,
      installments as never,
      subscriptions as never,
      paymentLinks as never,
      checkout as never,
      creditCard as never,
      refunds as never,
      invoices as never
    );

    const request = { value: true };
    const id = 'id_1';
    const id2 = 'id_2';

    const cases: Array<{
      name: string;
      call: () => Promise<unknown>;
      mock: jest.Mock<Promise<unknown>, unknown[]>;
      args: unknown[];
    }> = [
      {
        name: 'createCustomer',
        call: () => service.createCustomer(request as never),
        mock: clients.create.createCustomer,
        args: [request],
      },
      {
        name: 'listCustomers',
        call: () => service.listCustomers(request as never),
        mock: clients.list.listCustomers,
        args: [request],
      },
      {
        name: 'getCustomer',
        call: () => service.getCustomer(id),
        mock: clients.get.getCustomer,
        args: [id],
      },
      {
        name: 'updateCustomer',
        call: () => service.updateCustomer(id, request as never),
        mock: clients.update.updateCustomer,
        args: [id, request],
      },
      {
        name: 'deleteCustomer',
        call: () => service.deleteCustomer(id),
        mock: clients.delete.deleteCustomer,
        args: [id],
      },
      {
        name: 'restoreCustomer',
        call: () => service.restoreCustomer(id),
        mock: clients.restore.restoreCustomer,
        args: [id],
      },
      {
        name: 'getCustomerNotifications',
        call: () => service.getCustomerNotifications(id),
        mock: clients.getNotifications.getCustomerNotifications,
        args: [id],
      },
      {
        name: 'createPayment',
        call: () => service.createPayment(request as never),
        mock: payments.create.createPayment,
        args: [request],
      },
      {
        name: 'createCreditCardPayment',
        call: () => service.createCreditCardPayment(request as never),
        mock: payments.createCreditCard.createCreditCardPayment,
        args: [request],
      },
      {
        name: 'captureAuthorizedPayment',
        call: () => service.captureAuthorizedPayment(id),
        mock: payments.captureAuthorized.captureAuthorizedPayment,
        args: [id],
      },
      {
        name: 'payWithCreditCard',
        call: () => service.payWithCreditCard(id, request as never),
        mock: payments.payWithCreditCard.payWithCreditCard,
        args: [id, request],
      },
      {
        name: 'getPayment',
        call: () => service.getPayment(id),
        mock: payments.get.getPayment,
        args: [id],
      },
      {
        name: 'updatePayment',
        call: () => service.updatePayment(id, request as never),
        mock: payments.update.updatePayment,
        args: [id, request],
      },
      {
        name: 'deletePayment',
        call: () => service.deletePayment(id),
        mock: payments.delete.deletePayment,
        args: [id],
      },
      {
        name: 'restorePayment',
        call: () => service.restorePayment(id),
        mock: payments.restore.restorePayment,
        args: [id],
      },
      {
        name: 'getPaymentStatus',
        call: () => service.getPaymentStatus(id),
        mock: payments.getStatus.getPaymentStatus,
        args: [id],
      },
      {
        name: 'getPaymentIdentificationField',
        call: () => service.getPaymentIdentificationField(id),
        mock: payments.getIdentificationField.getPaymentIdentificationField,
        args: [id],
      },
      {
        name: 'getPaymentPixQrCode',
        call: () => service.getPaymentPixQrCode(id),
        mock: payments.getPixQrCode.getPaymentPixQrCode,
        args: [id],
      },
      {
        name: 'getPaymentBillingInfo',
        call: () => service.getPaymentBillingInfo(id),
        mock: payments.getBillingInfo.getPaymentBillingInfo,
        args: [id],
      },
      {
        name: 'getPaymentViewingInfo',
        call: () => service.getPaymentViewingInfo(id),
        mock: payments.getViewingInfo.getPaymentViewingInfo,
        args: [id],
      },
      {
        name: 'listPayments',
        call: () => service.listPayments(request as never),
        mock: payments.list.listPayments,
        args: [request],
      },
      {
        name: 'uploadPaymentDocument',
        call: () => service.uploadPaymentDocument(id, request as never),
        mock: payments.documents.upload.uploadPaymentDocument,
        args: [id, request],
      },
      {
        name: 'listPaymentDocuments',
        call: () => service.listPaymentDocuments(id),
        mock: payments.documents.list.listPaymentDocuments,
        args: [id],
      },
      {
        name: 'getPaymentDocument',
        call: () => service.getPaymentDocument(id, id2),
        mock: payments.documents.get.getPaymentDocument,
        args: [id, id2],
      },
      {
        name: 'updatePaymentDocument',
        call: () => service.updatePaymentDocument(id, id2, request as never),
        mock: payments.documents.update.updatePaymentDocument,
        args: [id, id2, request],
      },
      {
        name: 'deletePaymentDocument',
        call: () => service.deletePaymentDocument(id, id2),
        mock: payments.documents.delete.deletePaymentDocument,
        args: [id, id2],
      },
      {
        name: 'createInstallment',
        call: () => service.createInstallment(request as never),
        mock: installments.create.createInstallment,
        args: [request],
      },
      {
        name: 'createInstallmentWithCreditCard',
        call: () => service.createInstallmentWithCreditCard(request as never),
        mock: installments.createWithCreditCard.createInstallmentWithCreditCard,
        args: [request],
      },
      {
        name: 'getInstallment',
        call: () => service.getInstallment(id),
        mock: installments.get.getInstallment,
        args: [id],
      },
      {
        name: 'deleteInstallment',
        call: () => service.deleteInstallment(id),
        mock: installments.delete.deleteInstallment,
        args: [id],
      },
      {
        name: 'listInstallments',
        call: () => service.listInstallments(request as never),
        mock: installments.list.listInstallments,
        args: [request],
      },
      {
        name: 'listInstallmentPayments',
        call: () => service.listInstallmentPayments(id, request as never),
        mock: installments.listPayments.listInstallmentPayments,
        args: [id, request],
      },
      {
        name: 'getInstallmentPaymentBook',
        call: () => service.getInstallmentPaymentBook(id, request as never),
        mock: installments.getPaymentBook.getInstallmentPaymentBook,
        args: [id, request],
      },
      {
        name: 'updateInstallmentSplits',
        call: () => service.updateInstallmentSplits(id, request as never),
        mock: installments.updateSplits.updateInstallmentSplits,
        args: [id, request],
      },
      {
        name: 'refundInstallment',
        call: () => service.refundInstallment(id, request as never),
        mock: installments.refund.refundInstallment,
        args: [id, request],
      },
      {
        name: 'createSubscription',
        call: () => service.createSubscription(request as never),
        mock: subscriptions.create.createSubscription,
        args: [request],
      },
      {
        name: 'createSubscriptionWithCreditCard',
        call: () => service.createSubscriptionWithCreditCard(request as never),
        mock: subscriptions.createWithCreditCard
          .createSubscriptionWithCreditCard,
        args: [request],
      },
      {
        name: 'getSubscription',
        call: () => service.getSubscription(id),
        mock: subscriptions.get.getSubscription,
        args: [id],
      },
      {
        name: 'updateSubscription',
        call: () => service.updateSubscription(id, request as never),
        mock: subscriptions.update.updateSubscription,
        args: [id, request],
      },
      {
        name: 'updateSubscriptionCreditCard',
        call: () => service.updateSubscriptionCreditCard(id, request as never),
        mock: subscriptions.updateCreditCard.updateSubscriptionCreditCard,
        args: [id, request],
      },
      {
        name: 'deleteSubscription',
        call: () => service.deleteSubscription(id),
        mock: subscriptions.delete.deleteSubscription,
        args: [id],
      },
      {
        name: 'listSubscriptions',
        call: () => service.listSubscriptions(request as never),
        mock: subscriptions.list.listSubscriptions,
        args: [request],
      },
      {
        name: 'listSubscriptionPayments',
        call: () => service.listSubscriptionPayments(id, request as never),
        mock: subscriptions.listPayments.listSubscriptionPayments,
        args: [id, request],
      },
      {
        name: 'getSubscriptionPaymentBook',
        call: () => service.getSubscriptionPaymentBook(id, request as never),
        mock: subscriptions.getPaymentBook.getSubscriptionPaymentBook,
        args: [id, request],
      },
      {
        name: 'createSubscriptionInvoiceSettings',
        call: () =>
          service.createSubscriptionInvoiceSettings(id, request as never),
        mock: subscriptions.invoiceSettings.create
          .createSubscriptionInvoiceSettings,
        args: [id, request],
      },
      {
        name: 'getSubscriptionInvoiceSettings',
        call: () => service.getSubscriptionInvoiceSettings(id),
        mock: subscriptions.invoiceSettings.get.getSubscriptionInvoiceSettings,
        args: [id],
      },
      {
        name: 'updateSubscriptionInvoiceSettings',
        call: () =>
          service.updateSubscriptionInvoiceSettings(id, request as never),
        mock: subscriptions.invoiceSettings.update
          .updateSubscriptionInvoiceSettings,
        args: [id, request],
      },
      {
        name: 'deleteSubscriptionInvoiceSettings',
        call: () => service.deleteSubscriptionInvoiceSettings(id),
        mock: subscriptions.invoiceSettings.delete
          .deleteSubscriptionInvoiceSettings,
        args: [id],
      },
      {
        name: 'listSubscriptionInvoices',
        call: () => service.listSubscriptionInvoices(id, request as never),
        mock: subscriptions.listInvoices.listSubscriptionInvoices,
        args: [id, request],
      },
      {
        name: 'createPaymentLink',
        call: () => service.createPaymentLink(request as never),
        mock: paymentLinks.create.createPaymentLink,
        args: [request],
      },
      {
        name: 'listPaymentLinks',
        call: () => service.listPaymentLinks(request as never),
        mock: paymentLinks.list.listPaymentLinks,
        args: [request],
      },
      {
        name: 'getPaymentLink',
        call: () => service.getPaymentLink(id),
        mock: paymentLinks.get.getPaymentLink,
        args: [id],
      },
      {
        name: 'updatePaymentLink',
        call: () => service.updatePaymentLink(id, request as never),
        mock: paymentLinks.update.updatePaymentLink,
        args: [id, request],
      },
      {
        name: 'deletePaymentLink',
        call: () => service.deletePaymentLink(id),
        mock: paymentLinks.delete.deletePaymentLink,
        args: [id],
      },
      {
        name: 'restorePaymentLink',
        call: () => service.restorePaymentLink(id),
        mock: paymentLinks.restore.restorePaymentLink,
        args: [id],
      },
      {
        name: 'uploadPaymentLinkImage',
        call: () => service.uploadPaymentLinkImage(id, request as never),
        mock: paymentLinks.images.upload.uploadPaymentLinkImage,
        args: [id, request],
      },
      {
        name: 'listPaymentLinkImages',
        call: () => service.listPaymentLinkImages(id),
        mock: paymentLinks.images.list.listPaymentLinkImages,
        args: [id],
      },
      {
        name: 'getPaymentLinkImage',
        call: () => service.getPaymentLinkImage(id, id2),
        mock: paymentLinks.images.get.getPaymentLinkImage,
        args: [id, id2],
      },
      {
        name: 'deletePaymentLinkImage',
        call: () => service.deletePaymentLinkImage(id, id2),
        mock: paymentLinks.images.delete.deletePaymentLinkImage,
        args: [id, id2],
      },
      {
        name: 'setPaymentLinkImageAsMain',
        call: () => service.setPaymentLinkImageAsMain(id, id2),
        mock: paymentLinks.images.setAsMain.setPaymentLinkImageAsMain,
        args: [id, id2],
      },
      {
        name: 'createCheckout',
        call: () => service.createCheckout(request as never),
        mock: checkout.create.createCheckout,
        args: [request],
      },
      {
        name: 'cancelCheckout',
        call: () => service.cancelCheckout(id),
        mock: checkout.cancel.cancelCheckout,
        args: [id],
      },
      {
        name: 'tokenizeCreditCard',
        call: () => service.tokenizeCreditCard(request as never),
        mock: creditCard.tokenize.tokenizeCreditCard,
        args: [request],
      },
      {
        name: 'listPaymentRefunds',
        call: () => service.listPaymentRefunds(id),
        mock: refunds.list.listPaymentRefunds,
        args: [id],
      },
      {
        name: 'refundBankSlip',
        call: () => service.refundBankSlip(id),
        mock: refunds.refundBankSlip.refundBankSlip,
        args: [id],
      },
      {
        name: 'refundPaymentLean',
        call: () => service.refundPaymentLean(id, request as never),
        mock: refunds.refundPaymentLean.refundPaymentLean,
        args: [id, request],
      },
      {
        name: 'refundPayment',
        call: () => service.refundPayment(id, request as never),
        mock: refunds.refundPayment.refundPayment,
        args: [id, request],
      },
      {
        name: 'createInvoice',
        call: () => service.createInvoice(request as never),
        mock: invoices.create.createInvoice,
        args: [request],
      },
      {
        name: 'listInvoices',
        call: () => service.listInvoices(request as never),
        mock: invoices.list.listInvoices,
        args: [request],
      },
      {
        name: 'updateInvoice',
        call: () => service.updateInvoice(id, request as never),
        mock: invoices.update.updateInvoice,
        args: [id, request],
      },
      {
        name: 'getInvoice',
        call: () => service.getInvoice(id),
        mock: invoices.get.getInvoice,
        args: [id],
      },
      {
        name: 'authorizeInvoice',
        call: () => service.authorizeInvoice(id),
        mock: invoices.authorize.authorizeInvoice,
        args: [id],
      },
      {
        name: 'cancelInvoice',
        call: () => service.cancelInvoice(id, request as never),
        mock: invoices.cancel.cancelInvoice,
        args: [id, request],
      },
    ];

    for (const item of cases) {
      const result = { method: item.name };
      item.mock.mockResolvedValueOnce(result);

      await expect(item.call()).resolves.toEqual(result);
      expect(item.mock).toHaveBeenCalledWith(...item.args);
    }
  });
});
