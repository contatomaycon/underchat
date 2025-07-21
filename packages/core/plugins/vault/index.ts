import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { VaultService } from '@core/services/vault.service';
import { valtEnvironment } from '@core/config/environments/ValtEnvironment';

export default fp(async function vaultPlugin(server) {
  const vault = container.resolve(VaultService);

  await vault.loadEnv(valtEnvironment.vaultPatch);

  server.decorate('vault', vault);
});
