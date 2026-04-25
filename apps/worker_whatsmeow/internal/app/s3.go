package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"mime"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type StorageClient struct {
	cfg      Config
	primary  *minio.Client
	backup   *minio.Client
	balance  *BalanceGRPCClient
	verified sync.Map
}

type StoredObject struct {
	URL         string
	Bucket      string
	Key         string
	Name        string
	ContentType string
	Size        int64
	UsedBackup  bool
}

func NewStorageClient(cfg Config, balance *BalanceGRPCClient) (*StorageClient, error) {
	primary, err := newMinioClient(cfg.S3Endpoint, cfg.S3AccessKeyID, cfg.S3SecretAccessKey, cfg.S3Region)
	if err != nil && cfg.S3Endpoint != "" {
		return nil, err
	}
	backup, err := newMinioClient(cfg.S3EndpointBackup, cfg.S3AccessKeyIDBackup, cfg.S3SecretBackup, cfg.S3RegionBackup)
	if err != nil && cfg.S3EndpointBackup != "" {
		return nil, err
	}
	return &StorageClient{
		cfg:     cfg,
		primary: primary,
		backup:  backup,
		balance: balance,
	}, nil
}

func newMinioClient(endpoint, accessKey, secretKey, region string) (*minio.Client, error) {
	if endpoint == "" || accessKey == "" || secretKey == "" {
		return nil, nil
	}
	host, secure, err := parseS3Endpoint(endpoint)
	if err != nil {
		return nil, err
	}
	return minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
		Region: region,
	})
}

func parseS3Endpoint(endpoint string) (string, bool, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if trimmed == "" {
		return "", false, fmt.Errorf("empty S3 endpoint")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", false, err
	}
	if parsed.Scheme == "" {
		return trimmed, false, nil
	}
	return parsed.Host, parsed.Scheme == "https", nil
}

func (s *StorageClient) Upload(ctx context.Context, accountID string, data []byte, fileName, contentType string) (StoredObject, error) {
	if s.primary == nil && s.backup == nil {
		return StoredObject{}, fmt.Errorf("S3 is not configured")
	}
	bucket := s.bucketName(accountID, false)
	key := s.objectKey(fileName, contentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	primaryAttempts, primaryErr := s.uploadWithAttempts(ctx, s.primary, bucket, key, data, contentType)
	if primaryErr == nil {
		return StoredObject{
			URL:         s.publicURL(false, bucket, key),
			Bucket:      bucket,
			Key:         key,
			Name:        path.Base(key),
			ContentType: contentType,
			Size:        int64(len(data)),
		}, nil
	}

	backupBucket := s.bucketName(accountID, true)
	backupAttempts, backupErr := s.uploadWithAttempts(ctx, s.backup, backupBucket, key, data, contentType)
	if backupErr != nil {
		return StoredObject{}, fmt.Errorf("S3 upload failed on primary and backup: primary=%v; backup=%v", primaryErr, backupErr)
	}

	object := StoredObject{
		URL:         s.publicURL(true, backupBucket, key),
		Bucket:      backupBucket,
		Key:         key,
		Name:        path.Base(key),
		ContentType: contentType,
		Size:        int64(len(data)),
		UsedBackup:  true,
	}
	_ = s.balance.RegisterS3BackupFallbackUpload(ctx, S3BackupFallbackUpload{
		AccountID:       accountID,
		Bucket:          backupBucket,
		ObjectKey:       key,
		FileName:        object.Name,
		ContentType:     contentType,
		SizeBytes:       object.Size,
		PrimaryAttempts: int32(primaryAttempts),
		BackupAttempts:  int32(backupAttempts),
		PrimaryError:    primaryErr.Error(),
	})
	return object, nil
}

func (s *StorageClient) uploadWithAttempts(ctx context.Context, client *minio.Client, bucket, key string, data []byte, contentType string) (int, error) {
	if client == nil {
		return 0, fmt.Errorf("S3 client is not configured")
	}
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if err := s.ensureBucket(ctx, client, bucket); err != nil {
			lastErr = err
		} else {
			_, err := client.PutObject(ctx, bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
				ContentType: contentType,
			})
			if err == nil {
				return attempt, nil
			}
			lastErr = err
		}
		if attempt < 3 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
	}
	return 3, lastErr
}

func (s *StorageClient) ensureBucket(ctx context.Context, client *minio.Client, bucket string) error {
	if _, ok := s.verified.Load(bucket); ok {
		return nil
	}
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return err
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return err
		}
	}
	policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/*"]}]}`, bucket)
	_ = client.SetBucketPolicy(ctx, bucket, policy)
	s.verified.Store(bucket, true)
	return nil
}

func (s *StorageClient) bucketName(accountID string, backup bool) string {
	prefix := s.cfg.S3BucketPrefix
	if backup {
		prefix = s.cfg.S3BucketPrefixBackup
	}
	accountID = strings.ToLower(strings.TrimSpace(accountID))
	if prefix == "" {
		return accountID
	}
	return strings.Trim(strings.ToLower(prefix), "-.") + "-" + accountID
}

func (s *StorageClient) publicURL(backup bool, bucket, key string) string {
	base := strings.TrimRight(s.cfg.S3Endpoint, "/")
	if backup {
		base = strings.TrimRight(s.cfg.S3EndpointBackup, "/")
	}
	return base + "/" + bucket + "/" + strings.TrimLeft(key, "/")
}

func (s *StorageClient) objectKey(fileName, contentType string) string {
	ext := strings.ToLower(path.Ext(fileName))
	if ext == "" {
		if values, err := mime.ExtensionsByType(contentType); err == nil && len(values) > 0 {
			ext = values[0]
		}
	}
	if ext == "" {
		ext = ".bin"
	}
	return fmt.Sprintf("whatsmeow/%s/%s%s", time.Now().UTC().Format("2006/01/02"), randomHex(16), ext)
}

func randomHex(size int) string {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
