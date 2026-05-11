import fs from 'node:fs';
import path from 'node:path';

describe('WorkerBaileysGrpcClientService', () => {
  it('keeps a dedicated whatsmeow gRPC port route', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/services/workerBaileysGrpcClient.service.ts'
      ),
      'utf8'
    );

    expect(source).toContain('workerType === EWorkerType.whatsmeow');
    expect(source).toContain('balanceEnvironment.workerWhatsmeowGrpcPort');
  });

  it('uses a deadline for worker connection requests', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/services/workerBaileysGrpcClient.service.ts'
      ),
      'utf8'
    );

    expect(source).toContain(
      'const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);'
    );
    expect(source).toContain(
      '(client as any).RequestConnection(\n' +
        '        protoPayload,\n' +
        '        { deadline },'
    );
  });
});
