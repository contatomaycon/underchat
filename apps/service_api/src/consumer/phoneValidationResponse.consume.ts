import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { PhoneValidationResponseConsume } from '@core/consumer/phoneValidation/PhoneValidationResponse.consume';

export function startPhoneValidationResponseConsume(
  server: FastifyInstance
): PhoneValidationResponseConsume {
  const phoneValidationResponseConsume = container.resolve(
    PhoneValidationResponseConsume
  );

  phoneValidationResponseConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting phone validation response consume'
    );
  });

  return phoneValidationResponseConsume;
}
