import { Static, Type } from '@sinclair/typebox';

export const downloadArtifactSchema = Type.Object({
  artifact_key: Type.String(),
  product: Type.Union([
    Type.Literal('underchat_authenticator'),
    Type.Literal('underchat_chrome_extension'),
  ]),
  environment: Type.Union([Type.Literal('dev'), Type.Literal('prod')]),
  platform: Type.Union([
    Type.Literal('linux'),
    Type.Literal('macos'),
    Type.Literal('windows'),
    Type.Literal('chrome'),
  ]),
  label: Type.String(),
  filename: Type.String(),
  url: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export const downloadArtifactsResponseSchema = Type.Object({
  artifacts: Type.Array(downloadArtifactSchema),
});

export type DownloadArtifactResponse = Static<typeof downloadArtifactSchema>;
export type DownloadArtifactsResponse = Static<
  typeof downloadArtifactsResponseSchema
>;
