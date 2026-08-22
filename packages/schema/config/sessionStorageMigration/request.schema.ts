import { Static, Type } from '@sinclair/typebox';

export const sessionStorageMigrationChannelParamsSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
});

export const sessionStorageMigrationParamsSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
  migration_id: Type.String({ format: 'uuid' }),
});

export type SessionStorageMigrationChannelParams = Static<
  typeof sessionStorageMigrationChannelParamsSchema
>;

export type SessionStorageMigrationParams = Static<
  typeof sessionStorageMigrationParamsSchema
>;
