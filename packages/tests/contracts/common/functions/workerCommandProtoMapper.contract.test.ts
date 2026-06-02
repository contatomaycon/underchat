import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import {
  protoToWorkerPayload,
  workerPayloadToProto,
} from '@core/common/functions/workerCommandProtoMapper';

describe('workerCommandProtoMapper', () => {
  it('preserves lifecycle operation ids in worker payload roundtrips', () => {
    const proto = workerPayloadToProto({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-1',
    });

    expect(proto.lifecycle_operation_id).toBe('operation-1');
    expect(protoToWorkerPayload(proto)).toEqual(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
      })
    );
  });
});
