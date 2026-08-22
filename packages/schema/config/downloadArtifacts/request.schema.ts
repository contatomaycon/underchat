import { Static, Type } from '@sinclair/typebox';

export const updateDownloadArtifactsRequestSchema = Type.Object({
  artifacts: Type.Array(
    Type.Object({
      artifact_key: Type.String(),
      url: Type.Union([Type.String(), Type.Null()]),
    })
  ),
});

export type UpdateDownloadArtifactsRequest = Static<
  typeof updateDownloadArtifactsRequestSchema
>;
