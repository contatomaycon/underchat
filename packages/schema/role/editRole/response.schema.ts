import { Static, Type } from '@sinclair/typebox';

export const editRoleResponseSchema = Type.Null();

export type EditRoleResponse = Static<typeof editRoleResponseSchema>;
