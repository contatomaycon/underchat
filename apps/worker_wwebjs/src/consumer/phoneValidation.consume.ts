import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { PhoneValidationWwebjsConsume } from '@core/consumer/phoneValidation/PhoneValidationWwebjs.consume';

export function startPhoneValidationWwebjsConsume(
  server: FastifyInstance
): PhoneValidationWwebjsConsume {
  const consume = container.resolve(PhoneValidationWwebjsConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting phone validation consume');
  });

  return consume;
}
