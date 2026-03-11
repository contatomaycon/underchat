import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class BuildEnvironment {
  public get harborRegistry(): string {
    const registry = process.env.HARBOR_REGISTRY?.trim();
    if (!registry) {
      throw new InvalidConfigurationError('HARBOR_REGISTRY is not defined.');
    }

    return registry;
  }

  public get harborNamespace(): string {
    const namespace = process.env.HARBOR_NAMESPACE?.trim();
    if (!namespace) {
      throw new InvalidConfigurationError('HARBOR_NAMESPACE is not defined.');
    }

    return namespace.replace(/^\/+|\/+$/g, '');
  }

  public get harborUsername(): string {
    const username = process.env.HARBOR_USERNAME;
    if (!username) {
      throw new InvalidConfigurationError('HARBOR_USERNAME is not defined.');
    }

    return username;
  }

  public get harborPassword(): string {
    const password = process.env.HARBOR_PASSWORD;
    if (!password) {
      throw new InvalidConfigurationError('HARBOR_PASSWORD is not defined.');
    }

    return password;
  }

  public get buildGitCloneDir(): string {
    const cloneDir = process.env.BUILD_GIT_CLONE_DIR?.trim();
    if (cloneDir) {
      return cloneDir;
    }

    return '/tmp/underchat-build-source';
  }
}
