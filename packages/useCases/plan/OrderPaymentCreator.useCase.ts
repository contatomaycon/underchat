import { inject, injectable } from 'tsyringe';
import { PlanService } from '@core/services/plan.service';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import { CreateOrderPaymentResponse } from '@core/schema/plan/createOrderPayment/response.schema';

@injectable()
export class OrderPaymentCreatorUseCase {
  constructor(private readonly planService: PlanService) {}

  execute = async (
    accountId: string,
    input: CreateOrderPaymentRequest
  ): Promise<CreateOrderPaymentResponse> => {
    console.log('=== USECASE: OrderPaymentCreator ===');
    console.log('Account ID:', accountId);
    console.log('Input:', JSON.stringify(input, null, 2));
    console.log('=====================================');

    const result = await this.planService.createOrderPayment(accountId, input);

    const customer = await this.planService.getOrCreateCustomer(accountId);

    console.log('=== RESULTADO DO PAGAMENTO ===');
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log('VALOR FINAL A SER PAGO:', result.total_amount);
    console.log('Customer:', JSON.stringify(customer, null, 2));
    console.log('===============================');

    return result;
  };
}
