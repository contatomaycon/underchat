import 'reflect-metadata';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { ScheduleContactsValidatedListerRepository } from '@core/repositories/schedule/ScheduleContactsValidatedLister.repository';

function createSelectStep(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  return { from };
}

describe('ScheduleContactsValidatedListerRepository', () => {
  it('getValidatedContacts returns empty when no ids and no account', async () => {
    const repository = new ScheduleContactsValidatedListerRepository({
      select: jest.fn(),
    } as never);

    await expect(
      (repository as any).getValidatedContacts([], undefined)
    ).resolves.toEqual([]);
  });

  it('listValidatedContactsBySchedule loads all contacts when send_to is all', async () => {
    const step = createSelectStep([
      {
        contact_id: 'ct-1',
        name: 'John',
        nickname: 'Johnny',
        phone: '11999999999',
        phone_ddi: '55',
        phone_partial: '***9999',
        is_valided: true,
      },
    ]);

    const repository = new ScheduleContactsValidatedListerRepository({
      select: jest.fn(() => step),
    } as never);

    await expect(
      repository.listValidatedContactsBySchedule(
        'sch-1',
        EScheduleSendTo.all,
        'acc-1'
      )
    ).resolves.toEqual([
      {
        contact_id: 'ct-1',
        name: 'John',
        nickname: 'Johnny',
        phone: '11999999999',
        phone_ddi: '55',
        phone_partial: '***9999',
        is_validated: true,
        validation_origin: null,
      },
    ]);
  });

  it('listValidatedContactsBySchedule merges direct and group contacts without duplicates', async () => {
    const select = jest
      .fn()
      .mockReturnValueOnce(
        createSelectStep([
          { contact_id: 'ct-1', contact_group_id: null },
          { contact_id: 'ct-2', contact_group_id: 'cg-1' },
        ])
      )
      .mockReturnValueOnce(
        createSelectStep([
          { contact_id: 'ct-2' },
          { contact_id: 'ct-3' },
          { contact_id: null },
        ])
      )
      .mockReturnValueOnce(
        createSelectStep([
          {
            contact_id: 'ct-1',
            name: 'John',
            nickname: 'Johnny',
            phone: '11999999999',
            phone_ddi: '55',
            phone_partial: '***9999',
            is_valided: false,
          },
          {
            contact_id: 'ct-2',
            name: 'Mary',
            nickname: null,
            phone: '11888888888',
            phone_ddi: '55',
            phone_partial: '***8888',
            is_valided: true,
          },
          {
            contact_id: 'ct-3',
            name: 'Paul',
            nickname: 'Paulie',
            phone: '11777777777',
            phone_ddi: '55',
            phone_partial: '***7777',
            is_valided: null,
          },
        ])
      );

    const repository = new ScheduleContactsValidatedListerRepository({
      select,
    } as never);

    await expect(
      repository.listValidatedContactsBySchedule(
        'sch-1',
        EScheduleSendTo.contacts,
        'acc-1'
      )
    ).resolves.toEqual([
      {
        contact_id: 'ct-1',
        name: 'John',
        nickname: 'Johnny',
        phone: '11999999999',
        phone_ddi: '55',
        phone_partial: '***9999',
        is_validated: false,
        validation_origin: null,
      },
      {
        contact_id: 'ct-2',
        name: 'Mary',
        nickname: null,
        phone: '11888888888',
        phone_ddi: '55',
        phone_partial: '***8888',
        is_validated: true,
        validation_origin: null,
      },
      {
        contact_id: 'ct-3',
        name: 'Paul',
        nickname: 'Paulie',
        phone: '11777777777',
        phone_ddi: '55',
        phone_partial: '***7777',
        is_validated: false,
        validation_origin: null,
      },
    ]);
  });
});
