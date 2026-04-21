import 'reflect-metadata';
import * as creditCard from '@core/services/asaas/creditCard';

describe('asaas/creditCard/index', () => {
  it('exports credit card services', () => {
    expect(creditCard.TokenizeCreditCardService).toBeDefined();
  });
});
