import 'reflect-metadata';
import { PermissionAssignmentUserViewerRepository } from '@core/repositories/permission/PermissionAssignmentUserViewer.repository';

describe('PermissionAssignmentUserViewerRepository', () => {
  it('returns empty array when query returns no rows', async () => {
    const execute = jest.fn(async () => ({ rowCount: 0, rows: [] }));
    const repository = new PermissionAssignmentUserViewerRepository({
      execute,
    } as never);

    await expect(repository.viewPermissionByUserId('user-1')).resolves.toEqual(
      []
    );
  });

  it('returns rows from SQL query', async () => {
    const rows = [{ action: 'read_chat' }, { action: 'send_message' }];
    const execute = jest.fn(async () => ({ rowCount: 2, rows }));
    const repository = new PermissionAssignmentUserViewerRepository({
      execute,
    } as never);

    await expect(repository.viewPermissionByUserId('user-1')).resolves.toEqual(
      rows
    );
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("'user-1'"));
  });
});
