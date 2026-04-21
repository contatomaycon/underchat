import 'reflect-metadata';
import { AsaasCreditCardServices } from '@core/services/asaas/asaasCreditCardServices';

describe('AsaasCreditCardServices', () => {
  it('stores injected credit card tokenizer service', () => {
    const tokenize = { tokenizeCreditCard: jest.fn() } as never;

    const service = new AsaasCreditCardServices(tokenize);

    expect(service.tokenize).toBe(tokenize);
  });
});
