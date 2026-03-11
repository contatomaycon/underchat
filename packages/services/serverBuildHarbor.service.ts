import axios, { AxiosError, AxiosInstance } from 'axios';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { buildEnvironment } from '@core/config/environments';
import { IHarborArtifactTag } from '@core/common/interfaces/IHarborArtifactTag';
import { IHarborBuildVersionByType } from '@core/common/interfaces/IHarborBuildVersionByType';
import { injectable } from 'tsyringe';

interface HarborTagDto {
  name?: string;
  push_time?: string;
}

interface HarborArtifactDto {
  push_time?: string;
  tags?: HarborTagDto[];
}

type HarborRepositoryInfo = {
  projectName: string;
  repositoryName: string;
  repositoryPath: string;
};

@injectable()
export class ServerBuildHarborService {
  private readonly buildImageByType: Record<EServerBuildType, string> = {
    [EServerBuildType.baileys]: 'under-worker-baileys',
    [EServerBuildType.wwebjs]: 'under-worker-wwebjs',
    [EServerBuildType.balance_api]: 'under-balance-api',
  };

  private axiosInstance: AxiosInstance | null = null;

  private getNamespaceParts(): {
    projectName: string;
    repositoryPrefix: string;
  } {
    const namespace = buildEnvironment.harborNamespace.trim();
    const namespaceParts = namespace.split('/').filter((part) => part.length);
    const projectName = namespaceParts[0];

    if (!projectName) {
      throw new InvalidConfigurationError(
        'HARBOR_NAMESPACE must include at least the project name.'
      );
    }

    const repositoryPrefix = namespaceParts.slice(1).join('/');

    return {
      projectName,
      repositoryPrefix,
    };
  }

  private getRepositoryInfo(imageName: string): HarborRepositoryInfo {
    const { projectName, repositoryPrefix } = this.getNamespaceParts();
    const repositoryName = repositoryPrefix
      ? `${repositoryPrefix}/${imageName}`
      : imageName;

    return {
      projectName,
      repositoryName,
      repositoryPath: `${projectName}/${repositoryName}`,
    };
  }

  private getHarborApiBaseUrl(): string {
    const registry = buildEnvironment.harborRegistry
      .trim()
      .replace(/\/+$/g, '');
    const hasProtocol =
      registry.startsWith('http://') || registry.startsWith('https://');
    const host = hasProtocol ? registry : `https://${registry}`;

    return `${host}/api/v2.0`;
  }

  private getAxiosInstance(): AxiosInstance {
    if (this.axiosInstance) {
      return this.axiosInstance;
    }

    const basicAuth = Buffer.from(
      `${buildEnvironment.harborUsername}:${buildEnvironment.harborPassword}`
    ).toString('base64');

    this.axiosInstance = axios.create({
      baseURL: this.getHarborApiBaseUrl(),
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
    });

    return this.axiosInstance;
  }

  private buildImageReference(imageName: string, version: string): string {
    return `${buildEnvironment.harborRegistry}/${buildEnvironment.harborNamespace}/${imageName}:${version}`;
  }

  private isVersionTag(tag: string): boolean {
    return /^v\d+$/.test(tag);
  }

  private sortVersionTagsDesc(
    tags: IHarborArtifactTag[]
  ): IHarborArtifactTag[] {
    return [...tags].sort((a, b) => {
      if (a.pushed_at && b.pushed_at && a.pushed_at !== b.pushed_at) {
        return b.pushed_at.localeCompare(a.pushed_at);
      }

      if (a.pushed_at && !b.pushed_at) {
        return -1;
      }

      if (!a.pushed_at && b.pushed_at) {
        return 1;
      }

      return b.tag.localeCompare(a.tag);
    });
  }

  async listRepositoryVersionTags(
    imageName: string
  ): Promise<IHarborArtifactTag[]> {
    const repository = this.getRepositoryInfo(imageName);
    const repositoryEncoded = encodeURIComponent(repository.repositoryName);
    const projectEncoded = encodeURIComponent(repository.projectName);

    const tagsByName = new Map<string, IHarborArtifactTag>();
    let page = 1;
    const pageSize = 100;

    while (true) {
      const response = await this.getAxiosInstance().get<HarborArtifactDto[]>(
        `/projects/${projectEncoded}/repositories/${repositoryEncoded}/artifacts`,
        {
          params: {
            with_tag: true,
            with_label: false,
            with_scan_overview: false,
            with_signature: false,
            with_immutable_status: false,
            page,
            page_size: pageSize,
          },
        }
      );

      const artifacts = Array.isArray(response.data) ? response.data : [];
      if (artifacts.length === 0) {
        break;
      }

      for (const artifact of artifacts) {
        const artifactPushTime =
          typeof artifact.push_time === 'string' ? artifact.push_time : null;
        const tags = Array.isArray(artifact.tags) ? artifact.tags : [];

        for (const tag of tags) {
          const tagName = typeof tag.name === 'string' ? tag.name.trim() : '';
          if (!tagName || !this.isVersionTag(tagName)) {
            continue;
          }

          const pushedAt =
            typeof tag.push_time === 'string'
              ? tag.push_time
              : artifactPushTime;
          const current = tagsByName.get(tagName);

          if (!current) {
            tagsByName.set(tagName, {
              tag: tagName,
              pushed_at: pushedAt,
            });
            continue;
          }

          const shouldReplace =
            (pushedAt && !current.pushed_at) ||
            (pushedAt &&
              current.pushed_at &&
              pushedAt.localeCompare(current.pushed_at) > 0);

          if (shouldReplace) {
            tagsByName.set(tagName, {
              tag: tagName,
              pushed_at: pushedAt,
            });
          }
        }
      }

      if (artifacts.length < pageSize) {
        break;
      }

      page += 1;
    }

    return this.sortVersionTagsDesc(Array.from(tagsByName.values()));
  }

  async listPairedBuildVersions(
    limit: number
  ): Promise<IHarborBuildVersionByType[]> {
    const buildTypes = [
      EServerBuildType.baileys,
      EServerBuildType.wwebjs,
      EServerBuildType.balance_api,
    ];

    const tagsByTypeEntries = await Promise.all(
      buildTypes.map(async (buildType) => {
        const imageName = this.buildImageByType[buildType];
        const tags = await this.listRepositoryVersionTags(imageName);

        return [buildType, tags] as const;
      })
    );

    const tagsByType = Object.fromEntries(tagsByTypeEntries) as Record<
      EServerBuildType,
      IHarborArtifactTag[]
    >;

    const versionSets = buildTypes.map(
      (buildType) => new Set(tagsByType[buildType].map((tag) => tag.tag))
    );
    const firstSet = versionSets[0] ?? new Set<string>();
    const restSets = versionSets.slice(1);
    const intersectedVersions = Array.from(firstSet).filter((version) =>
      restSets.every((set) => set.has(version))
    );

    const versions = intersectedVersions.map((version) => {
      const imageReferences = {} as Record<EServerBuildType, string>;
      const harborRepositories = {} as Record<EServerBuildType, string>;
      const pushedAtCandidates: string[] = [];

      for (const buildType of buildTypes) {
        const imageName = this.buildImageByType[buildType];
        const repositoryInfo = this.getRepositoryInfo(imageName);
        harborRepositories[buildType] = repositoryInfo.repositoryPath;
        imageReferences[buildType] = this.buildImageReference(
          imageName,
          version
        );

        const matchedTag =
          tagsByType[buildType].find((tag) => tag.tag === version) ?? null;
        if (matchedTag?.pushed_at) {
          pushedAtCandidates.push(matchedTag.pushed_at);
        }
      }

      return {
        version,
        created_at:
          pushedAtCandidates.sort((a, b) => b.localeCompare(a))[0] ?? null,
        image_references: imageReferences,
        harbor_repositories: harborRepositories,
      } as IHarborBuildVersionByType;
    });

    return versions
      .sort((a, b) => {
        if (a.created_at && b.created_at && a.created_at !== b.created_at) {
          return b.created_at.localeCompare(a.created_at);
        }

        if (a.created_at && !b.created_at) {
          return -1;
        }

        if (!a.created_at && b.created_at) {
          return 1;
        }

        return b.version.localeCompare(a.version);
      })
      .slice(0, limit);
  }

  async deleteBuildVersionArtifacts(version: string): Promise<void> {
    const buildTypes = [
      EServerBuildType.baileys,
      EServerBuildType.wwebjs,
      EServerBuildType.balance_api,
    ];

    for (const buildType of buildTypes) {
      const imageName = this.buildImageByType[buildType];
      const repository = this.getRepositoryInfo(imageName);
      const projectEncoded = encodeURIComponent(repository.projectName);
      const repositoryEncoded = encodeURIComponent(repository.repositoryName);
      const referenceEncoded = encodeURIComponent(version);

      try {
        await this.getAxiosInstance().delete(
          `/projects/${projectEncoded}/repositories/${repositoryEncoded}/artifacts/${referenceEncoded}`
        );
      } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 404) {
          continue;
        }

        throw error;
      }
    }
  }
}
