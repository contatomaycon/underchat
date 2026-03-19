import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class S3Environment {
  public get s3AccessKeyId(): string {
    if (!process.env.S3_ACCESS_KEY_ID) {
      throw new InvalidConfigurationError('S3_ACCESS_KEY_ID is not defined.');
    }

    return process.env.S3_ACCESS_KEY_ID;
  }

  public get s3SecretAccessKey(): string {
    if (!process.env.S3_SECRET_ACCESS_KEY) {
      throw new InvalidConfigurationError(
        'S3_SECRET_ACCESS_KEY is not defined.'
      );
    }

    return process.env.S3_SECRET_ACCESS_KEY;
  }

  public get s3Region(): string {
    if (!process.env.S3_REGION) {
      throw new InvalidConfigurationError('S3_REGION is not defined.');
    }

    return process.env.S3_REGION;
  }

  public get s3Endpoint(): string {
    if (!process.env.S3_ENDPOINT) {
      throw new InvalidConfigurationError('S3_ENDPOINT is not defined.');
    }

    return process.env.S3_ENDPOINT;
  }

  public get s3NfseCertificateBucket(): string {
    return process.env.S3_NFSE_CERTIFICATE_BUCKET ?? 'nfs';
  }

  public get s3BucketPrefix(): string | undefined {
    return process.env.S3_BUCKET_PREFIX ?? undefined;
  }

  public get s3EndpointBackup(): string {
    if (!process.env.S3_ENDPOINT_BACKUP) {
      throw new InvalidConfigurationError('S3_ENDPOINT_BACKUP is not defined.');
    }

    return process.env.S3_ENDPOINT_BACKUP;
  }

  public get s3AccessKeyIdBackup(): string {
    if (!process.env.S3_ACCESS_KEY_ID_BACKUP) {
      throw new InvalidConfigurationError(
        'S3_ACCESS_KEY_ID_BACKUP is not defined.'
      );
    }

    return process.env.S3_ACCESS_KEY_ID_BACKUP;
  }

  public get s3SecretAccessKeyBackup(): string {
    if (!process.env.S3_SECRET_ACCESS_KEY_BACKUP) {
      throw new InvalidConfigurationError(
        'S3_SECRET_ACCESS_KEY_BACKUP is not defined.'
      );
    }

    return process.env.S3_SECRET_ACCESS_KEY_BACKUP;
  }

  public get s3RegionBackup(): string {
    if (!process.env.S3_REGION_BACKUP) {
      throw new InvalidConfigurationError('S3_REGION_BACKUP is not defined.');
    }

    return process.env.S3_REGION_BACKUP;
  }

  public get s3BucketPrefixBackup(): string | undefined {
    return process.env.S3_BUCKET_PREFIX_BACKUP ?? undefined;
  }
}
