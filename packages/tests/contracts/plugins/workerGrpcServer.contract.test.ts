import fs from 'node:fs';
import path from 'node:path';

describe('workerGrpcServer plugin', () => {
  it('acks recreate commands before running the heavy worker operation', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain("if (action === 'recreate')");
    expect(source).toContain(
      'void handler.handle(payload).catch(handleError);'
    );
    expect(source).toContain('callback(null, {});');
  });
});
