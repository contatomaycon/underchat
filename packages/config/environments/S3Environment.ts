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

  public get s3BucketName(): string {
    if (!process.env.S3_BUCKET_NAME) {
      throw new InvalidConfigurationError('S3_BUCKET_NAME is not defined.');
    }

    return process.env.S3_BUCKET_NAME;
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
}
