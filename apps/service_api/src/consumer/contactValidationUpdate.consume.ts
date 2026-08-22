import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ContactValidationUpdateConsume } from '@core/consumer/contact/ContactValidationUpdate.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startContactValidationUpdateConsume(
  server: FastifyInstance
): ContactValidationUpdateConsume {
  const contactValidationUpdateConsume = container.resolve(
    ContactValidationUpdateConsume
  );

  return launchServiceApiConsumerStartup(
    contactValidationUpdateConsume,
    () => contactValidationUpdateConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting contact validation update consume'
      )
  );
}
