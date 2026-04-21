import 'reflect-metadata';
import { DashboardTemplatesRepository } from '@core/repositories/dashboard/DashboardTemplates.repository';

describe('DashboardTemplatesRepository', () => {
  it('throws when accountId is empty', async () => {
    const repository = new DashboardTemplatesRepository({
      execute: jest.fn(),
    } as never);

    await expect(repository.getTemplateTotals('')).rejects.toThrow(
      'accountId is required'
    );
  });

  it('returns parsed template totals', async () => {
    const repository = new DashboardTemplatesRepository({
      execute: jest.fn(async () => ({
        rows: [
          {
            contact_groups_total: '2',
            message_templates_total: '3',
            label_templates_total: '4',
          },
        ],
      })),
    } as never);

    await expect(repository.getTemplateTotals('acc-1')).resolves.toEqual({
      contactGroupsTotal: 2,
      messageTemplatesTotal: 3,
      labelTemplatesTotal: 4,
    });
  });
});
