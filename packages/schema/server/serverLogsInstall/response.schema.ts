import { Static, Type } from '@sinclair/typebox';

export const serverLogsInstallResponseSchema = Type.Object({
  event_id: Type.Optional(Type.String()),
  installation_id: Type.Optional(Type.String()),
  install_event_type: Type.Optional(
    Type.Union([
      Type.Literal('output'),
      Type.Literal('stage'),
      Type.Literal('lifecycle'),
    ])
  ),
  install_stage: Type.Optional(
    Type.Union([
      Type.Literal('queued'),
      Type.Literal('packages'),
      Type.Literal('docker'),
      Type.Literal('images'),
      Type.Literal('worker_baileys'),
      Type.Literal('worker_wwebjs'),
      Type.Literal('worker_meow'),
      Type.Literal('balance'),
      Type.Literal('health'),
    ])
  ),
  install_stage_status: Type.Optional(
    Type.Union([
      Type.Literal('pending'),
      Type.Literal('running'),
      Type.Literal('complete'),
      Type.Literal('error'),
    ])
  ),
  install_status: Type.Optional(
    Type.Union([
      Type.Literal('queued'),
      Type.Literal('running'),
      Type.Literal('complete'),
      Type.Literal('error'),
      Type.Literal('canceled'),
    ])
  ),
  command: Type.Union([Type.String(), Type.Null()]),
  output: Type.Union([Type.String(), Type.Null()]),
  date: Type.String(),
});

export type ServerLogsInstallResponse = Static<
  typeof serverLogsInstallResponseSchema
>;
