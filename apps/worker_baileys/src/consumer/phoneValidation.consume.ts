import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { PhoneValidationConsume } from '@core/consumer/phoneValidation/PhoneValidation.consume';

export function startPhoneValidationConsume(
  server: FastifyInstance
): PhoneValidationConsume {
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] phoneValidation.consume: startPhoneValidationConsume iniciado',
    { ts: t0 }
  );
  const phoneValidationConsume = container.resolve(PhoneValidationConsume);
  phoneValidationConsume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting phone validation consume');
  });
  console.log(
    '[worker_baileys:init] phoneValidation.consume: startPhoneValidationConsume retornando',
    { ms: Date.now() - t0, ts: Date.now() }
  );

  return phoneValidationConsume;
}
