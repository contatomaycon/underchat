import { injectable } from 'tsyringe';
import { TokenizeCreditCardService } from './creditCard';

@injectable()
export class AsaasCreditCardServices {
  public readonly tokenize: TokenizeCreditCardService;

  constructor(tokenize: TokenizeCreditCardService) {
    this.tokenize = tokenize;
  }
}
