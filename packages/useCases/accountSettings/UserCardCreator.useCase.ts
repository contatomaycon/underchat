import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PaymentService } from '@core/services/payment.service';
import { UserCustomerRepository } from '@core/repositories/payment/UserCustomer.repository';
import { UserCardsListerRepository } from '@core/repositories/plan/UserCardsLister.repository';
import { CreateUserCardRequest } from '@core/schema/accountSettings/createUserCard/request.schema';
import { CreateUserCardResponse } from '@core/schema/accountSettings/createUserCard/response.schema';

@injectable()
export class UserCardCreatorUseCase {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly userCustomerRepository: UserCustomerRepository,
    private readonly userCardsListerRepository: UserCardsListerRepository
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    userId: string,
    remoteIp: string,
    input: CreateUserCardRequest
  ): Promise<CreateUserCardResponse> => {
    const userCustomer =
      await this.userCustomerRepository.getUserCustomerByUserId(userId);

    if (!userCustomer) {
      throw new Error(t('user_customer_not_found'));
    }

    const result = await this.paymentService.tokenizeAndSaveNewCard(
      userId,
      userCustomer.user_customer,
      remoteIp,
      {
        number: input.number,
        holder_name: input.holder_name,
        expiry_month: input.expiry_month,
        expiry_year: input.expiry_year,
        cvv: input.cvv,
      }
    );

    if (!result.userCardId) {
      throw new Error(t('card_creation_failed'));
    }

    const cards = await this.userCardsListerRepository.listUserCards(userId);
    const createdCard = cards.find(
      (card) => card.user_card_id === result.userCardId
    );

    if (!createdCard) {
      throw new Error(t('card_not_found'));
    }

    return {
      user_card_id: createdCard.user_card_id,
      holder_name: createdCard.holder_name,
      last_number: createdCard.last_number,
      brand: createdCard.brand,
      default: createdCard.default,
      created_at: createdCard.created_at || new Date().toISOString(),
    };
  };
}
