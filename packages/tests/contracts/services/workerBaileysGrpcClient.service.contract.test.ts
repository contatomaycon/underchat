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
});
