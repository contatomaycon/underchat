import fs from 'node:fs';
import path from 'node:path';

describe('workerGrpcServer plugin', () => {
  it('acks create and recreate commands before running the heavy worker operation', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain(
      "if (action === 'create' || action === 'recreate')"
    );
    expect(source).toContain(
      'void handler.handle(payload).catch(handleError);'
    );
    expect(source).toContain('callback(null, {});');
  });

  it('copies reserved recreate server slot metadata into the worker payload', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain('WORKER_RECREATE_SERVER_SLOT_KEY_METADATA');
    expect(source).toContain('payload.recreate_server_slot_key');
    expect(source).toContain('payload.recreate_server_slot_token');
  });
});
