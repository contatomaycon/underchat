import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ContactValidationUpdateConsume } from '@core/consumer/contact/ContactValidationUpdate.consume';

export function startContactValidationUpdateConsume(
  server: FastifyInstance
): ContactValidationUpdateConsume {
  const contactValidationUpdateConsume = container.resolve(
    ContactValidationUpdateConsume
  );

  contactValidationUpdateConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting contact validation update consume'
    );
  });

  return contactValidationUpdateConsume;
}
