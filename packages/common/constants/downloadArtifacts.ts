export const downloadArtifactProducts = [
  'underchat_authenticator',
  'underchat_chrome_extension',
] as const;

export const downloadArtifactEnvironments = ['dev', 'prod'] as const;

export const downloadArtifactPlatforms = [
  'linux',
  'macos',
  'windows',
  'chrome',
] as const;

export type DownloadArtifactProduct = (typeof downloadArtifactProducts)[number];
export type DownloadArtifactEnvironment =
  (typeof downloadArtifactEnvironments)[number];
export type DownloadArtifactPlatform =
  (typeof downloadArtifactPlatforms)[number];

export type DownloadArtifactCatalogItem = {
  artifact_key: string;
  default_url: string;
  environment: DownloadArtifactEnvironment;
  filename: string;
  label: string;
  object_key: string;
  platform: DownloadArtifactPlatform;
  product: DownloadArtifactProduct;
};

const minioBaseUrl = 'https://minio.devunder.com/underchat';

const authenticatorArtifact = (
  environment: DownloadArtifactEnvironment,
  platform: Exclude<DownloadArtifactPlatform, 'chrome'>,
  variant: string,
  filename: string,
  label: string
): DownloadArtifactCatalogItem => {
  const objectKey = `downloads/underchat-authenticator/${environment}/${filename}`;

  return {
    artifact_key: `authenticator_${environment}_${platform}_${variant}`,
    default_url: `${minioBaseUrl}/${objectKey}`,
    environment,
    filename,
    label,
    object_key: objectKey,
    platform,
    product: 'underchat_authenticator',
  };
};

const chromeExtensionArtifact = (
  environment: DownloadArtifactEnvironment
): DownloadArtifactCatalogItem => {
  const filename = 'underchat-chrome-extension.zip';
  const objectKey = `downloads/underchat-chrome-extension/${environment}/${filename}`;

  return {
    artifact_key: `chrome_extension_${environment}_zip`,
    default_url: `${minioBaseUrl}/${objectKey}`,
    environment,
    filename,
    label: 'Extensao Google Chrome',
    object_key: objectKey,
    platform: 'chrome',
    product: 'underchat_chrome_extension',
  };
};

const authenticatorArtifactsFor = (
  environment: DownloadArtifactEnvironment
): DownloadArtifactCatalogItem[] => [
  authenticatorArtifact(environment, 'linux', 'deb', 'linux.deb', 'Linux .deb'),
  authenticatorArtifact(
    environment,
    'linux',
    'appimage',
    'linux.AppImage',
    'Linux AppImage'
  ),
  authenticatorArtifact(environment, 'macos', 'dmg', 'macos.dmg', 'macOS .dmg'),
  authenticatorArtifact(environment, 'macos', 'zip', 'macos.zip', 'macOS .zip'),
  authenticatorArtifact(
    environment,
    'windows',
    'exe',
    'windows.exe',
    'Windows .exe'
  ),
  authenticatorArtifact(
    environment,
    'windows',
    'blockmap',
    'windows.exe.blockmap',
    'Windows blockmap'
  ),
];

export const downloadArtifactCatalog = [
  ...authenticatorArtifactsFor('dev'),
  ...authenticatorArtifactsFor('prod'),
  chromeExtensionArtifact('dev'),
  chromeExtensionArtifact('prod'),
] as const satisfies readonly DownloadArtifactCatalogItem[];

export type DownloadArtifactKey =
  (typeof downloadArtifactCatalog)[number]['artifact_key'];

export const downloadArtifactKeys = downloadArtifactCatalog.map(
  (artifact) => artifact.artifact_key
);

export const downloadArtifactCatalogByKey = new Map(
  downloadArtifactCatalog.map((artifact) => [artifact.artifact_key, artifact])
);
