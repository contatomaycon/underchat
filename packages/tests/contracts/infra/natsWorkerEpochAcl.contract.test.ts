import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const config = fs.readFileSync(
  path.resolve(workspaceRoot, 'infra/nats/nats-server.conf'),
  'utf8'
);
const init = fs.readFileSync(
  path.resolve(workspaceRoot, 'infra/nats/init.sh'),
  'utf8'
);
const compose = fs.readFileSync(
  path.resolve(workspaceRoot, 'docker-compose.yml'),
  'utf8'
);

describe('worker epoch KV runtime ACL', () => {
  const directGetSubject =
    '$JS.API.DIRECT.GET.KV_UC_WORKER_EPOCH_V1.$KV.UC_WORKER_EPOCH_V1.worker.*';

  it('allows only the worker-key shape through the optimized KV direct-get API', () => {
    expect(config).toContain(`"${directGetSubject}"`);
    expect(config).not.toContain(
      '"$JS.API.DIRECT.GET.KV_UC_WORKER_EPOCH_V1.>"'
    );
  });

  it('proves the runtime credential direct-get before bootstrap is ready', () => {
    expect(() =>
      execFileSync('sh', [
        '-n',
        path.resolve(workspaceRoot, 'infra/nats/init.sh'),
      ])
    ).not.toThrow();
    expect(init).toContain('verify_runtime_epoch_direct_get');
    expect(init).toContain(
      '$JS.API.DIRECT.GET.KV_UC_WORKER_EPOCH_V1.$KV.UC_WORKER_EPOCH_V1.worker.__acl_probe'
    );
    expect(init).toContain(
      "log 'runtime epoch KV direct-get ACL verification failed'"
    );
    expect(init.indexOf('verify_contract\n')).toBeLessThan(
      init.lastIndexOf('verify_runtime_epoch_direct_get\n')
    );
  });

  it('injects separate runtime credentials into the bootstrap probe', () => {
    expect(compose).toContain(
      "NATS_RUNTIME_USER: '${NATS_USER:-underchat_runtime}'"
    );
    expect(compose).toContain(
      "NATS_RUNTIME_PASSWORD: '${NATS_PASSWORD:-underchat_local_runtime_only}'"
    );
  });
});
