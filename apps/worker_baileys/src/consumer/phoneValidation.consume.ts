import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { PhoneValidationConsume } from '@core/consumer/phoneValidation/PhoneValidation.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const phoneValidationConsume = container.resolve(PhoneValidationConsume);

    phoneValidationConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await phoneValidationConsume.close();
    });
  },
  { name: 'phone-validation-consume' }
);
