import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { LabelTemplateService } from '@core/services/labelTemplate.service';

describe('LabelTemplateService', () => {
  it('delegates list and CRUD methods', async () => {
    const listLabelTemplates = jest.fn(async () => [
      { label_template_id: 'l1' },
    ]);
    const listLabelTemplateTotal = jest.fn(async () => 3);

    const service = new LabelTemplateService(
      { listLabelTemplates, listLabelTemplateTotal } as never,
      { existsLabelStatusById: jest.fn(async () => true) } as never,
      {
        existsLabelTemplateById: jest.fn(async () => true),
        existsLabelTemplatesByIds: jest.fn(async () => new Set(['l1'])),
      } as never,
      { createLabelTemplate: jest.fn(async () => 'l1') } as never,
      {
        viewLabelTemplateById: jest.fn(async () => ({
          label_template_id: 'l1',
        })),
      } as never,
      { deleteLabelTemplateById: jest.fn(async () => true) } as never,
      { updateLabelTemplateById: jest.fn(async () => true) } as never,
      {
        listLabelTemplateAll: jest.fn(async () => [
          { label_template_id: 'l1' },
        ]),
      } as never
    );

    await expect(
      service.listLabelTemplates(10, 1, { query: 'x' } as never, 'a1')
    ).resolves.toEqual([[{ label_template_id: 'l1' }], 3]);
    await expect(service.existsLabelStatusById('s1')).resolves.toBe(true);
    await expect(service.existsLabelTemplateById('l1')).resolves.toBe(true);
    await expect(service.existsLabelTemplatesByIds(['l1'])).resolves.toEqual(
      new Set(['l1'])
    );
    await expect(service.createLabelTemplate({} as never, 'a1')).resolves.toBe(
      'l1'
    );
    await expect(service.viewLabelTemplateById('l1', 'a1')).resolves.toEqual({
      label_template_id: 'l1',
    });
    await expect(service.deleteLabelTemplateById('l1', 'a1')).resolves.toBe(
      true
    );
    await expect(service.updateLabelTemplateById('l1', {}, 'a1')).resolves.toBe(
      true
    );
    await expect(service.listLabelTemplateAll('a1')).resolves.toEqual([
      { label_template_id: 'l1' },
    ]);
  });
});
