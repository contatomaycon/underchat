import fp from 'fastify-plugin';
import { S3Client } from '@aws-sdk/client-s3';
import { container } from 'tsyringe';
import { s3Environment } from '@core/config/environments';

const s3Plugin = async () => {
  const client = new S3Client({
    region: s3Environment.s3Region,
    credentials: {
      accessKeyId: s3Environment.s3AccessKeyId,
      secretAccessKey: s3Environment.s3SecretAccessKey,
    },
    endpoint: s3Environment.s3Endpoint,
    forcePathStyle: true,
  });

  const backupClient = new S3Client({
    region: s3Environment.s3RegionBackup,
    credentials: {
      accessKeyId: s3Environment.s3AccessKeyIdBackup,
      secretAccessKey: s3Environment.s3SecretAccessKeyBackup,
    },
    endpoint: s3Environment.s3EndpointBackup,
    forcePathStyle: true,
  });

  container.register<S3Client>('S3Client', {
    useValue: client,
  });

  container.register<S3Client>('S3ClientBackup', {
    useValue: backupClient,
  });
};

export default fp(s3Plugin, { name: 's3-plugin' });
