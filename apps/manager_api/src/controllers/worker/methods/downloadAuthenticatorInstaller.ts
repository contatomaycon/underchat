import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { WorkerAuthenticatorDownloadParams } from '@core/schema/worker/secureConnection/request.schema';
import { FastifyReply, FastifyRequest } from 'fastify';

type AuthenticatorArtifact = {
  contentType: string;
  filename: string;
  path: string;
  size: number;
};

const platformConfig = {
  linux: {
    contentType: 'application/vnd.debian.binary-package',
    extensions: ['.deb'],
  },
  macos: {
    contentType: 'application/x-apple-diskimage',
    extensions: ['.dmg'],
  },
  windows: {
    contentType: 'application/vnd.microsoft.portable-executable',
    extensions: ['.exe'],
  },
} as const;

export const downloadAuthenticatorInstaller = async (
  request: FastifyRequest<{
    Params: WorkerAuthenticatorDownloadParams;
  }>,
  reply: FastifyReply
) => {
  const { t } = request;

  try {
    const artifact = await findAuthenticatorArtifact(request.params.platform);

    if (!artifact) {
      return sendResponse(reply, {
        message: t('worker_authenticator_download_not_found'),
        httpStatusCode: EHTTPStatusCode.not_found,
      });
    }

    return reply
      .code(EHTTPStatusCode.ok)
      .header('Content-Type', artifact.contentType)
      .header('Content-Length', artifact.size)
      .header(
        'Content-Disposition',
        `attachment; filename="${artifact.filename}"; filename*=UTF-8''${encodeURIComponent(
          artifact.filename
        )}`
      )
      .send(createReadStream(artifact.path));
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};

async function findAuthenticatorArtifact(
  platform: WorkerAuthenticatorDownloadParams['platform']
): Promise<AuthenticatorArtifact | null> {
  const releaseChannel = resolveAuthenticatorReleaseChannel();
  const config = platformConfig[platform];

  for (const root of getAuthenticatorDownloadRoots()) {
    const releaseDir = resolve(root, releaseChannel);
    const files = await readdir(releaseDir, { withFileTypes: true }).catch(
      () => []
    );
    const artifacts = await Promise.all(
      files
        .filter((file) => file.isFile())
        .filter((file) =>
          (config.extensions as readonly string[]).includes(extname(file.name))
        )
        .filter((file) => file.name.startsWith('Underchat-Authenticator-'))
        .map(async (file) => {
          const path = resolve(releaseDir, file.name);
          const fileStat = await stat(path);

          return {
            contentType: config.contentType,
            filename: basename(file.name),
            mtimeMs: fileStat.mtimeMs,
            path,
            size: fileStat.size,
          };
        })
    );

    artifacts.sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (artifacts[0]) {
      return {
        contentType: artifacts[0].contentType,
        filename: artifacts[0].filename,
        path: artifacts[0].path,
        size: artifacts[0].size,
      };
    }
  }

  return null;
}

function resolveAuthenticatorReleaseChannel(): 'dev' | 'prod' {
  const appEnvironment = process.env.APP_ENVIRONMENT?.trim().toUpperCase();

  if (
    appEnvironment === EAppEnvironment.local ||
    (!appEnvironment && process.env.NODE_ENV !== 'production')
  ) {
    return 'dev';
  }

  return 'prod';
}

function getAuthenticatorDownloadRoots(): string[] {
  const configured = process.env.AUTHENTICATOR_DOWNLOADS_DIR?.trim();
  const candidates = [
    configured,
    resolve(
      import.meta.dirname,
      '../../../../downloads/underchat-authenticator'
    ),
    resolve(process.cwd(), 'downloads/underchat-authenticator'),
    resolve(
      process.cwd(),
      'apps/manager_api/downloads/underchat-authenticator'
    ),
  ].filter(Boolean) as string[];

  return [...new Set(candidates)];
}
