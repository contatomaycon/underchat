import 'reflect-metadata';
import { LabelTemplateViewerExistsRepository } from '@core/repositories/labelTemplate/LabelTemplateViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('LabelTemplateViewerExistsRepository', () => {
  it('returns false when template by id does not exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new LabelTemplateViewerExistsRepository(db as never);

    await expect(repository.existsLabelTemplateById('label-1')).resolves.toBe(
      false
    );
  });

  it('returns true when template by id exists', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new LabelTemplateViewerExistsRepository(db as never);

    await expect(repository.existsLabelTemplateById('label-1')).resolves.toBe(
      true
    );
  });

  it('returns empty set when ids are empty', async () => {
    const { db } = createSelectDbMock([{ label_template_id: 'label-1' }]);
    const repository = new LabelTemplateViewerExistsRepository(db as never);

    const result = await repository.existsLabelTemplatesByIds([]);

    expect(result.size).toBe(0);
    expect(db.select as jest.Mock).not.toHaveBeenCalled();
  });

  it('returns set of existing ids', async () => {
    const { db } = createSelectDbMock([
      { label_template_id: 'label-1' },
      { label_template_id: 'label-2' },
      { label_template_id: 'label-1' },
    ]);
    const repository = new LabelTemplateViewerExistsRepository(db as never);

    const result = await repository.existsLabelTemplatesByIds([
      'label-1',
      'label-2',
      'label-3',
    ]);

    expect(Array.from(result)).toEqual(['label-1', 'label-2']);
  });
});
