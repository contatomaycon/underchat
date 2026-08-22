import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { PhoneValidationResponseConsume } from '@core/consumer/phoneValidation/PhoneValidationResponse.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startPhoneValidationResponseConsume(
  server: FastifyInstance
): PhoneValidationResponseConsume {
  const phoneValidationResponseConsume = container.resolve(
    PhoneValidationResponseConsume
  );

  return launchServiceApiConsumerStartup(
    phoneValidationResponseConsume,
    () => phoneValidationResponseConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting phone validation response consume'
      )
  );
}
