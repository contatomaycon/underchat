import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { PhoneValidationResponseConsume } from '@core/consumer/phoneValidation/PhoneValidationResponse.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const phoneValidationResponseConsume = container.resolve(
      PhoneValidationResponseConsume
    );

    phoneValidationResponseConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await phoneValidationResponseConsume.close();
    });
  },
  { name: 'phone-validation-response-consume' }
);
