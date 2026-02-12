import { injectable, inject } from 'tsyringe';
import { TokenizeCreditCardService } from './creditCard';

@injectable()
export class AsaasCreditCardServices {
  public readonly tokenize: TokenizeCreditCardService;

  constructor(
    @inject(TokenizeCreditCardService)
    tokenize: TokenizeCreditCardService
  ) {
    this.tokenize = tokenize;
  }
}
