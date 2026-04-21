import 'reflect-metadata';
import { ContactExporterRepository } from '@core/repositories/contact/ContactExporter.repository';

function createDbRoWithExecuteQueue(queue: unknown[]) {
  const execute = jest.fn();
  for (const item of queue) {
    execute.mockResolvedValueOnce(item);
  }

  const chain = {} as {
    from: jest.Mock;
    leftJoin: jest.Mock;
    innerJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    execute: jest.Mock;
  };

  chain.from = jest.fn(() => chain);
  chain.leftJoin = jest.fn(() => chain);
  chain.innerJoin = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.orderBy = jest.fn(() => chain);
  chain.execute = execute;

  const dbRo = {
    select: jest.fn(() => chain),
  };

  return {
    dbRo,
    execute,
  };
}

describe('ContactExporterRepository', () => {
  it('returns empty list when no contacts are found', async () => {
    const { dbRo, execute } = createDbRoWithExecuteQueue([[]]);
    const repository = new ContactExporterRepository(dbRo as never);

    await expect(repository.exportContacts('acc-1')).resolves.toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns contacts with labels map', async () => {
    const contacts = [
      {
        contact_id: 'contact-1',
        name: 'Maycon',
        last_name: 'Silva',
        email: 'a@b.com',
        phone_ddi: '55',
        phone: '11999999999',
        nickname: 'May',
        birthday: '2026-04-21',
        notes: 'obs',
        contact_document_type_name: 'CPF',
        document: '123',
      },
    ];

    const labels = [
      {
        contact_id: 'contact-1',
        label_template_id: 'label-1',
        label: 'VIP',
        color: '#fff000',
      },
    ];

    const { dbRo, execute } = createDbRoWithExecuteQueue([contacts, labels]);
    const repository = new ContactExporterRepository(dbRo as never);

    await expect(
      repository.exportContacts('acc-1', ['contact-1'])
    ).resolves.toEqual([
      {
        ...contacts[0],
        labels: [
          {
            label_template_id: 'label-1',
            label: 'VIP',
            color: '#fff000',
          },
        ],
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
