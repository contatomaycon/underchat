import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { PhoneValidationConsume } from '@core/consumer/phoneValidation/PhoneValidation.consume';

export function startPhoneValidationConsume(
  server: FastifyInstance
): PhoneValidationConsume {
  const phoneValidationConsume = container.resolve(PhoneValidationConsume);

  phoneValidationConsume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting phone validation consume');
  });

  return phoneValidationConsume;
}
