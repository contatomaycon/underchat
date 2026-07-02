import 'reflect-metadata';
import { SchedulePendingListerRepository } from '@core/repositories/schedule/SchedulePendingLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';
import { EWorkerType } from '@core/common/enums/EWorkerType';

describe('SchedulePendingListerRepository', () => {
  it('listPendingSchedules maps result and applies default send_speed', async () => {
    const ro = createSelectDbMock([
      {
        schedule_id: 'sch-1',
        account_id: 'acc-1',
        account_name: null,
        worker_id: 'wk-1',
        worker_name: null,
        worker_type_id: EWorkerType.baileys,
        type: 'text',
        send_to: 'contacts',
        send_speed: null,
        chatbot_id: null,
        chatbot_name: null,
        message: 'hello',
        url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        official_template: null,
        send_date: '2026-04-21T22:00:00.000Z',
      },
    ]).db;
    const repository = new SchedulePendingListerRepository(
      ro as never,
      {} as never
    );

    await expect(repository.listPendingSchedules()).resolves.toEqual([
      {
        schedule_id: 'sch-1',
        account_id: 'acc-1',
        account_name: '',
        worker_id: 'wk-1',
        worker_name: '',
        worker_type_id: EWorkerType.baileys,
        type: 'text',
        send_to: 'contacts',
        send_speed: 'low',
        chatbot_id: null,
        chatbot_name: null,
        message: 'hello',
        url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        official_template: null,
        send_date: '2026-04-21T22:00:00.000Z',
      },
    ]);
  });

  it('listPendingScheduleById returns null when schedule not found', async () => {
    const rw = createSelectDbMock([]).db;
    const repository = new SchedulePendingListerRepository(
      {} as never,
      rw as never
    );

    await expect(
      repository.listPendingScheduleById('sch-1')
    ).resolves.toBeNull();
  });

  it('viewScheduleById returns null when schedule not found', async () => {
    const rw = createSelectDbMock([]).db;
    const repository = new SchedulePendingListerRepository(
      {} as never,
      rw as never
    );

    await expect(repository.viewScheduleById('sch-1')).resolves.toBeNull();
  });

  it('viewScheduleById returns mapped schedule when found', async () => {
    const rw = createSelectDbMock([
      {
        schedule_id: 'sch-1',
        account_id: 'acc-1',
        account_name: 'Account 1',
        worker_id: 'wk-1',
        worker_name: 'Worker 1',
        worker_type_id: EWorkerType.whatsapp,
        type: 'text',
        send_to: 'contacts',
        send_speed: 'high',
        chatbot_id: 'cb-1',
        chatbot_name: 'Chatbot',
        message: 'hello',
        url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        official_template: null,
        send_date: '2026-04-21T22:00:00.000Z',
      },
    ]).db;
    const repository = new SchedulePendingListerRepository(
      {} as never,
      rw as never
    );

    await expect(repository.viewScheduleById('sch-1')).resolves.toEqual({
      schedule_id: 'sch-1',
      account_id: 'acc-1',
      account_name: 'Account 1',
      worker_id: 'wk-1',
      worker_name: 'Worker 1',
      worker_type_id: EWorkerType.whatsapp,
      type: 'text',
      send_to: 'contacts',
      send_speed: 'high',
      chatbot_id: 'cb-1',
      chatbot_name: 'Chatbot',
      message: 'hello',
      url: null,
      mimetype: null,
      duration: null,
      width: null,
      height: null,
      official_template: null,
      send_date: '2026-04-21T22:00:00.000Z',
    });
  });
});
