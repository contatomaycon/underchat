import fs from 'node:fs';
import path from 'node:path';

describe('WorkerGrpcClientService', () => {
  it('uses a deadline for connection status dispatches', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/services/workerGrpcClient.service.ts'),
      'utf8'
    );

    expect(source).toContain(
      'const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);'
    );
    expect(source).toContain(
      '(client as any).ChangeConnectionStatus(\n' +
        '        protoPayload,\n' +
        '        { deadline },'
    );
  });

  it('uses a bounded recreate dispatch by default', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/services/workerGrpcClient.service.ts'),
      'utf8'
    );

    expect(source).toContain('timeoutMs: number = GRPC_DEADLINE_MS');
    expect(source).toContain(
      "await this.call('RecreateWorker', payload, timeoutMs);"
    );
  });
});
