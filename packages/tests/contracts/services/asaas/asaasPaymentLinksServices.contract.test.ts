import 'reflect-metadata';
import { AsaasPaymentLinksServices } from '@core/services/asaas/asaasPaymentLinksServices';

describe('AsaasPaymentLinksServices', () => {
  it('stores injected payment link services', () => {
    const create = { createPaymentLink: jest.fn() } as never;
    const list = { listPaymentLinks: jest.fn() } as never;
    const get = { getPaymentLink: jest.fn() } as never;
    const update = { updatePaymentLink: jest.fn() } as never;
    const deleteService = { deletePaymentLink: jest.fn() } as never;
    const restore = { restorePaymentLink: jest.fn() } as never;
    const images = { upload: jest.fn() } as never;

    const service = new AsaasPaymentLinksServices(
      create,
      list,
      get,
      update,
      deleteService,
      restore,
      images
    );

    expect(service.create).toBe(create);
    expect(service.list).toBe(list);
    expect(service.get).toBe(get);
    expect(service.update).toBe(update);
    expect(service.delete).toBe(deleteService);
    expect(service.restore).toBe(restore);
    expect(service.images).toBe(images);
  });
});
