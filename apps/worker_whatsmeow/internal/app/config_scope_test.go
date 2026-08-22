package app

import (
	"strings"
	"testing"
	"time"
)

func TestLoadConfigUsesPublicScopedEndpoints(t *testing.T) {
	t.Setenv("APP_ENVIRONMENT", "LOCAL")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("UNDERCHAT_ENV_SCOPE", "public")
	t.Setenv("WORKER_ID", "worker-1")
	t.Setenv("ACCOUNT_ID", "account-1")
	t.Setenv("KAFKA_PUBLIC_BROKER", "public-kafka:9093")
	t.Setenv("KAFKA_PRIVATE_BROKER", "private-kafka:9092")
	t.Setenv("KAFKA_PUBLIC_SECURITY_PROTOCOL", "SASL_SSL")
	t.Setenv("KAFKA_PRIVATE_SECURITY_PROTOCOL", "PLAINTEXT")
	t.Setenv("KAFKA_PUBLIC_USERNAME", "public-user")
	t.Setenv("KAFKA_PUBLIC_PASSWORD", "public-pass")
	t.Setenv("KAFKA_PUBLIC_SASL_MECHANISM", "SCRAM-SHA-512")
	t.Setenv("DB_CACHE_PUBLIC_HOST", "public-redis")
	t.Setenv("DB_CACHE_PRIVATE_HOST", "private-redis")
	t.Setenv("DB_CACHE_PUBLIC_PORT", "16379")
	t.Setenv("DB_CACHE_PRIVATE_PORT", "6379")
	t.Setenv("CENTRIFUGO_PUBLIC_HTTP_API_URL", "https://public-ws/api")
	t.Setenv("CENTRIFUGO_PRIVATE_HTTP_API_URL", "http://private-ws/api")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}

	if got := strings.Join(cfg.KafkaBrokers, ","); got != "public-kafka:9093" {
		t.Fatalf("KafkaBrokers = %q", got)
	}
	if cfg.KafkaProtocol != "sasl_ssl" {
		t.Fatalf("KafkaProtocol = %q", cfg.KafkaProtocol)
	}
	if cfg.KafkaUsername != "public-user" {
		t.Fatalf("KafkaUsername = %q", cfg.KafkaUsername)
	}
	if cfg.KafkaPassword != "public-pass" {
		t.Fatalf("KafkaPassword = %q", cfg.KafkaPassword)
	}
	if cfg.KafkaSASLMechanism != "SCRAM-SHA-512" {
		t.Fatalf("KafkaSASLMechanism = %q", cfg.KafkaSASLMechanism)
	}
	if cfg.RedisHost != "public-redis" {
		t.Fatalf("RedisHost = %q", cfg.RedisHost)
	}
	if cfg.RedisPort != 16379 {
		t.Fatalf("RedisPort = %d", cfg.RedisPort)
	}
	if cfg.CentrifugoHTTPAPIURL != "https://public-ws/api" {
		t.Fatalf("CentrifugoHTTPAPIURL = %q", cfg.CentrifugoHTTPAPIURL)
	}
}

func TestLoadConfigRejectsInvalidEnvScope(t *testing.T) {
	t.Setenv("UNDERCHAT_ENV_SCOPE", "external")

	_, err := LoadConfig()
	if err == nil {
		t.Fatal("LoadConfig() error = nil")
	}
	if !strings.Contains(err.Error(), "UNDERCHAT_ENV_SCOPE is invalid") {
		t.Fatalf("LoadConfig() error = %v", err)
	}
}

func TestLoadConfigUsesHistoryReconciliationDefaultsWithoutEnv(t *testing.T) {
	t.Setenv("APP_ENVIRONMENT", "LOCAL")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("UNDERCHAT_ENV_SCOPE", "private")
	t.Setenv("WORKER_ID", "worker-history-defaults")
	t.Setenv("ACCOUNT_ID", "account-history-defaults")
	t.Setenv("KAFKA_PRIVATE_BROKER", "private-kafka:9092")
	t.Setenv("KAFKA_PRIVATE_SECURITY_PROTOCOL", "SSL")
	t.Setenv("HISTORY_RECONCILIATION_ENABLED", "")
	t.Setenv("HISTORY_RECONCILIATION_WINDOW_MS", "")
	t.Setenv("HISTORY_RECONCILIATION_MESSAGE_LIMIT", "")
	t.Setenv("HISTORY_RECONCILIATION_CHAT_SCAN_LIMIT", "")
	t.Setenv("HISTORY_RECONCILIATION_PER_CHAT_LIMIT", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}

	if !cfg.HistoryReconciliationEnabled {
		t.Fatal("HistoryReconciliationEnabled = false, want true")
	}
	if cfg.HistoryReconciliationWindow != 6*time.Hour {
		t.Fatalf("HistoryReconciliationWindow = %s, want %s", cfg.HistoryReconciliationWindow, 6*time.Hour)
	}
	if cfg.HistoryReconciliationMessageLimit != 1000 {
		t.Fatalf("HistoryReconciliationMessageLimit = %d, want 1000", cfg.HistoryReconciliationMessageLimit)
	}
	if cfg.HistoryReconciliationChatScanLimit != 100 {
		t.Fatalf("HistoryReconciliationChatScanLimit = %d, want 100", cfg.HistoryReconciliationChatScanLimit)
	}
	if cfg.HistoryReconciliationPerChatLimit != 250 {
		t.Fatalf("HistoryReconciliationPerChatLimit = %d, want 250", cfg.HistoryReconciliationPerChatLimit)
	}
}

func TestLoadConfigRejectsMissingKafkaSecurityProtocol(t *testing.T) {
	t.Setenv("APP_ENVIRONMENT", "LOCAL")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("UNDERCHAT_ENV_SCOPE", "private")
	t.Setenv("WORKER_ID", "worker-security-missing")
	t.Setenv("ACCOUNT_ID", "account-security-missing")
	t.Setenv("KAFKA_PRIVATE_BROKER", "private-kafka:9092")
	t.Setenv("KAFKA_PRIVATE_SECURITY_PROTOCOL", "")
	t.Setenv("SECURITY_PROTOCOL", "")

	_, err := LoadConfig()
	if err == nil {
		t.Fatal("LoadConfig() accepted a missing Kafka security protocol")
	}
	if !strings.Contains(err.Error(), "security protocol is not defined") {
		t.Fatalf("LoadConfig() error = %v", err)
	}
}

func TestLoadConfigUsesSafeKafkaDefaultsWithoutNewEnv(t *testing.T) {
	t.Setenv("APP_ENVIRONMENT", "LOCAL")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("UNDERCHAT_ENV_SCOPE", "private")
	t.Setenv("WORKER_ID", "worker-plaintext")
	t.Setenv("ACCOUNT_ID", "account-plaintext")
	t.Setenv("KAFKA_PRIVATE_BROKER", "private-kafka:9092")
	t.Setenv("KAFKA_PRIVATE_SECURITY_PROTOCOL", "PLAINTEXT")
	t.Setenv("KAFKA_ALLOW_PLAINTEXT", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() default plaintext policy error = %v", err)
	}
	if !cfg.KafkaAllowPlaintext ||
		cfg.KafkaProtocol != "plaintext" {
		t.Fatalf("LoadConfig() plaintext policy = %+v", cfg)
	}

	t.Setenv("KAFKA_ALLOW_PLAINTEXT", "false")
	_, err = LoadConfig()
	if err == nil || !strings.Contains(err.Error(), "KAFKA_ALLOW_PLAINTEXT=true") {
		t.Fatalf("LoadConfig() explicit plaintext denial error = %v", err)
	}
}

func TestLoadConfigWarmStandbyDefersChannelDatabaseIdentity(t *testing.T) {
	t.Setenv("APP_ENVIRONMENT", "LOCAL")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("UNDERCHAT_ENV_SCOPE", "private")
	t.Setenv("WARM_STANDBY", "true")
	t.Setenv("WARM_POOL_ID", "warm-pool-1")
	t.Setenv("WORKER_ID", "")
	t.Setenv("ACCOUNT_ID", "")
	t.Setenv("WORKER_SESSION_STORAGE", SessionStoragePostgres)
	t.Setenv("WORKER_DATABASE_URL", "postgres://database.invalid/underchat")
	t.Setenv("WORKER_RUNTIME_CAPABILITY", "")
	t.Setenv("WORKER_WRITER_EPOCH", "")
	t.Setenv("RUNTIME_GENERATION", "0")
	t.Setenv("KAFKA_PRIVATE_BROKER", "private-kafka:9092")
	t.Setenv("KAFKA_PRIVATE_SECURITY_PROTOCOL", "SSL")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() warm standby error = %v", err)
	}
	if cfg.WorkerID != "" || cfg.AccountID != "" || !cfg.WarmStandby {
		t.Fatalf("warm standby unexpectedly fabricated a channel identity: worker=%q account=%q", cfg.WorkerID, cfg.AccountID)
	}
}

func TestLoadConfigPostgresSessionUsesSharedWorkerDatabase(t *testing.T) {
	t.Setenv("APP_ENVIRONMENT", "LOCAL")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("UNDERCHAT_ENV_SCOPE", "private")
	t.Setenv("WARM_STANDBY", "true")
	t.Setenv("WARM_POOL_ID", "warm-pool-shared-database")
	t.Setenv("WORKER_ID", "")
	t.Setenv("ACCOUNT_ID", "")
	t.Setenv("WORKER_SESSION_STORAGE", SessionStoragePostgres)
	t.Setenv("WORKER_DATABASE_URL", "postgres://database.invalid/underchat")
	t.Setenv("KAFKA_PRIVATE_BROKER", "private-kafka:9092")
	t.Setenv("KAFKA_PRIVATE_SECURITY_PROTOCOL", "SSL")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() shared PostgreSQL configuration error = %v", err)
	}
	if cfg.WorkerDatabaseURL == "" || !cfg.WhatsappSessionDebugEnabled {
		t.Fatalf("LoadConfig() did not enable shared session database defaults: %+v", cfg)
	}
}

func TestLoadConfigActiveLegacyDatabaseWorkerRequiresFenceIdentity(t *testing.T) {
	t.Setenv("APP_ENVIRONMENT", "LOCAL")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("UNDERCHAT_ENV_SCOPE", "private")
	t.Setenv("WARM_STANDBY", "false")
	t.Setenv("WORKER_ID", "worker-not-a-uuid")
	t.Setenv("ACCOUNT_ID", "account-not-a-uuid")
	t.Setenv("WORKER_SESSION_STORAGE", SessionStorageLegacyVolume)
	t.Setenv("WORKER_DATABASE_URL", "postgres://database.invalid/underchat")
	t.Setenv("KAFKA_PRIVATE_BROKER", "private-kafka:9092")
	t.Setenv("KAFKA_PRIVATE_SECURITY_PROTOCOL", "SSL")

	_, err := LoadConfig()
	if err == nil || !strings.Contains(err.Error(), "must be a UUID when WORKER_DATABASE_URL") {
		t.Fatalf("LoadConfig() active direct database identity error = %v", err)
	}
}
