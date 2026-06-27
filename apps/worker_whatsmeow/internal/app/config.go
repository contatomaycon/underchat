package app

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	WorkerID          string
	AccountID         string
	RuntimeGeneration int
	DataDir           string
	WarmStandby       bool
	WarmPoolID        string

	HTTPAddr string
	GRPCAddr string

	BalanceGRPCHost string
	BalanceGRPCPort int

	KafkaBrokers       []string
	KafkaProtocol      string
	KafkaUsername      string
	KafkaPassword      string
	KafkaSASLMechanism string

	RedisHost     string
	RedisPort     int
	RedisPassword string

	S3Endpoint           string
	S3AccessKeyID        string
	S3SecretAccessKey    string
	S3Region             string
	S3BucketPrefix       string
	S3EndpointBackup     string
	S3AccessKeyIDBackup  string
	S3SecretBackup       string
	S3RegionBackup       string
	S3BucketPrefixBackup string

	CentrifugoHTTPAPIURL string
	CentrifugoHTTPAPIKey string

	ProxyProtocol string
	ProxyHost     string
	ProxyPort     int
	ProxyUsername string
	ProxyPassword string

	SendTimeout                          time.Duration
	WhatsAppConnectTimeout               time.Duration
	ConnectionQRFirstQRTimeout           time.Duration
	KafkaPollInterval                    time.Duration
	OutboundReadyTimeout                 time.Duration
	SendMaxInFlight                      int
	KafkaConsumerMaxInFlight             int
	SendQueueTimeout                     time.Duration
	ConnectionHealthFailOnKafkaUnhealthy bool
	ConnectionLifecycleDebugEnabled      bool
	SelfMonitorInterval                  time.Duration
	SelfMonitorInitialDelay              time.Duration
	SelfMonitorFailureThreshold          int
	SelfHealRecoveryWindow               time.Duration
	DailyMaintenanceHour                 int

	KafkaSendConsumerIdleRecreateInterval time.Duration
	KafkaHandlerErrorBackoff              time.Duration
	KafkaConsumerStallTimeout             time.Duration
	KafkaConsumerStallCheckInterval       time.Duration
	KafkaConsumerMaxStallRestarts         int

	OutboundFailureReconnectThreshold int
	OutboundFailureReconnectCooldown  time.Duration
	SendIdempotencyInProgressTTL      time.Duration
	SendIdempotencyFinalTTL           time.Duration
	SendIdempotencyStaleAfter         time.Duration

	HistoryReconciliationEnabled      bool
	HistoryReconciliationMessageLimit int
}

func LoadConfig() (Config, error) {
	envScope, err := resolveUnderchatEnvScope()
	if err != nil {
		return Config{}, err
	}
	kafkaConsumerStallTimeout := envMillisDurationDefault("KAFKA_CONSUMER_STALL_MS", 5*time.Minute)

	cfg := Config{
		WorkerID:          strings.TrimSpace(os.Getenv("WORKER_ID")),
		AccountID:         strings.TrimSpace(os.Getenv("ACCOUNT_ID")),
		RuntimeGeneration: envIntDefault("RUNTIME_GENERATION", 0),
		DataDir:           envDefault("WORKER_DATA_DIR", "/app/data"),
		WarmStandby:       envBoolDefault("WARM_STANDBY", false),
		WarmPoolID:        strings.TrimSpace(os.Getenv("WARM_POOL_ID")),
		HTTPAddr:          ":" + envDefault("WORKER_HTTP_PORT", "3005"),
		GRPCAddr:          ":" + envDefault("WORKER_WHATSMEOW_GRPC_PORT", "50054"),
		BalanceGRPCHost:   envDefault("BALANCER_GRPC_HOST", "under-balance-api"),
		BalanceGRPCPort:   envIntDefault("BALANCER_GRPC_PORT", 50051),
		KafkaBrokers: splitCSV(scopedEnvDefault(
			envScope,
			"KAFKA_PUBLIC_BROKER",
			"KAFKA_PRIVATE_BROKER",
			"KAFKA_BROKER",
			"",
		)),
		KafkaProtocol: strings.ToLower(scopedEnvDefault(
			envScope,
			"KAFKA_PUBLIC_SECURITY_PROTOCOL",
			"KAFKA_PRIVATE_SECURITY_PROTOCOL",
			"SECURITY_PROTOCOL",
			"plaintext",
		)),
		KafkaUsername: scopedEnvDefault(
			envScope,
			"KAFKA_PUBLIC_USERNAME",
			"KAFKA_PRIVATE_USERNAME",
			"KAFKA_USERNAME",
			"",
		),
		KafkaPassword: scopedEnvDefault(
			envScope,
			"KAFKA_PUBLIC_PASSWORD",
			"KAFKA_PRIVATE_PASSWORD",
			"KAFKA_PASSWORD",
			"",
		),
		KafkaSASLMechanism: strings.ToUpper(scopedEnvDefault(
			envScope,
			"KAFKA_PUBLIC_SASL_MECHANISM",
			"KAFKA_PRIVATE_SASL_MECHANISM",
			"SASL_MECHANISM",
			"PLAIN",
		)),
		RedisHost: scopedEnvDefault(
			envScope,
			"DB_CACHE_PUBLIC_HOST",
			"DB_CACHE_PRIVATE_HOST",
			"DB_CACHE_HOST",
			"localhost",
		),
		RedisPort: envScopedIntDefault(
			envScope,
			"DB_CACHE_PUBLIC_PORT",
			"DB_CACHE_PRIVATE_PORT",
			"DB_CACHE_PORT",
			6379,
		),
		RedisPassword:        os.Getenv("DB_CACHE_PASSWORD"),
		S3Endpoint:           os.Getenv("S3_ENDPOINT"),
		S3AccessKeyID:        os.Getenv("S3_ACCESS_KEY_ID"),
		S3SecretAccessKey:    os.Getenv("S3_SECRET_ACCESS_KEY"),
		S3Region:             envDefault("S3_REGION", "us-east-1"),
		S3BucketPrefix:       os.Getenv("S3_BUCKET_PREFIX"),
		S3EndpointBackup:     os.Getenv("S3_ENDPOINT_BACKUP"),
		S3AccessKeyIDBackup:  os.Getenv("S3_ACCESS_KEY_ID_BACKUP"),
		S3SecretBackup:       os.Getenv("S3_SECRET_ACCESS_KEY_BACKUP"),
		S3RegionBackup:       envDefault("S3_REGION_BACKUP", "us-east-1"),
		S3BucketPrefixBackup: os.Getenv("S3_BUCKET_PREFIX_BACKUP"),
		CentrifugoHTTPAPIURL: scopedEnvDefault(
			envScope,
			"CENTRIFUGO_PUBLIC_HTTP_API_URL",
			"CENTRIFUGO_PRIVATE_HTTP_API_URL",
			"CENTRIFUGO_HTTP_API_URL",
			"",
		),
		CentrifugoHTTPAPIKey: os.Getenv("CENTRIFUGO_HTTP_API_KEY"),
		ProxyProtocol:        strings.ToLower(envDefault("PROXY_PROTOCOL", "http")),
		ProxyHost:            os.Getenv("PROXY_HOST"),
		ProxyPort:            envIntDefault("PROXY_PORT", 0),
		ProxyUsername:        os.Getenv("PROXY_USERNAME"),
		ProxyPassword:        os.Getenv("PROXY_PASSWORD"),
		SendTimeout:          envDurationDefault("WORKER_SEND_TIMEOUT", 90*time.Second),
		WhatsAppConnectTimeout: envDurationDefault(
			"WORKER_WHATSAPP_CONNECT_TIMEOUT",
			45*time.Second,
		),
		ConnectionQRFirstQRTimeout:            envMillisDurationDefault("CONNECTION_QR_FIRST_QR_TIMEOUT_MS", 75*time.Second),
		KafkaPollInterval:                     250 * time.Millisecond,
		OutboundReadyTimeout:                  envDurationDefault("WORKER_OUTBOUND_READY_TIMEOUT", 60*time.Second),
		SendMaxInFlight:                       envIntDefault("WORKER_SEND_MAX_IN_FLIGHT", 256),
		KafkaConsumerMaxInFlight:              envIntDefault("WORKER_KAFKA_MAX_IN_FLIGHT", 32),
		SendQueueTimeout:                      envDurationDefault("WORKER_SEND_QUEUE_TIMEOUT", kafkaConsumerStallTimeout),
		ConnectionHealthFailOnKafkaUnhealthy:  envBoolDefault("WORKER_CONNECTION_HEALTH_FAIL_ON_KAFKA_UNHEALTHY", false),
		ConnectionLifecycleDebugEnabled:       envBoolDefault("CONNECTION_LIFECYCLE_DEBUG_ENABLED", false),
		SelfMonitorInterval:                   envMillisDurationDefault("WORKER_SELF_MONITOR_INTERVAL_MS", 30*time.Second),
		SelfMonitorInitialDelay:               envMillisDurationDefault("WORKER_SELF_MONITOR_INITIAL_DELAY_MS", 15*time.Second),
		SelfMonitorFailureThreshold:           envIntDefault("WORKER_SELF_MONITOR_FAILURE_THRESHOLD", 3),
		SelfHealRecoveryWindow:                time.Duration(envIntDefault("WORKER_SELF_HEAL_RECOVERY_WINDOW_SECONDS", 10*60)) * time.Second,
		DailyMaintenanceHour:                  envIntDefault("WORKER_DAILY_MAINTENANCE_HOUR", 2),
		KafkaSendConsumerIdleRecreateInterval: envDurationDefault("WORKER_KAFKA_SEND_CONSUMER_IDLE_RECREATE_INTERVAL", 0),
		KafkaHandlerErrorBackoff:              envDurationDefault("WORKER_KAFKA_HANDLER_ERROR_BACKOFF", time.Second),
		KafkaConsumerStallTimeout:             kafkaConsumerStallTimeout,
		KafkaConsumerStallCheckInterval:       envMillisDurationDefault("KAFKA_CONSUMER_STALL_CHECK_MS", 30*time.Second),
		KafkaConsumerMaxStallRestarts:         envIntDefault("KAFKA_CONSUMER_MAX_RESTARTS_BEFORE_UNHEALTHY", 3),
		OutboundFailureReconnectThreshold:     envIntDefault("WORKER_OUTBOUND_FAILURE_RECONNECT_THRESHOLD", 3),
		OutboundFailureReconnectCooldown:      envDurationDefault("WORKER_OUTBOUND_FAILURE_RECONNECT_COOLDOWN", 2*time.Minute),
		SendIdempotencyInProgressTTL:          envDurationDefault("WORKER_SEND_IDEMPOTENCY_IN_PROGRESS_TTL", 10*time.Minute),
		SendIdempotencyFinalTTL:               envDurationDefault("WORKER_SEND_IDEMPOTENCY_FINAL_TTL", 24*time.Hour),
		SendIdempotencyStaleAfter:             envDurationDefault("WORKER_SEND_IDEMPOTENCY_STALE_AFTER", 0),
		HistoryReconciliationEnabled:          envBoolDefault("HISTORY_RECONCILIATION_ENABLED", true),
		HistoryReconciliationMessageLimit:     envIntDefault("HISTORY_RECONCILIATION_MESSAGE_LIMIT", 100),
	}

	if cfg.WarmStandby {
		if cfg.WorkerID == "" {
			if cfg.WarmPoolID != "" {
				cfg.WorkerID = cfg.WarmPoolID
			} else {
				cfg.WorkerID = "warm-standby"
			}
		}
		if cfg.AccountID == "" {
			cfg.AccountID = "warm-standby"
		}
	}

	if cfg.WorkerID == "" {
		return cfg, fmt.Errorf("WORKER_ID is not defined")
	}
	if cfg.AccountID == "" {
		return cfg, fmt.Errorf("ACCOUNT_ID is not defined")
	}
	if len(cfg.KafkaBrokers) == 0 {
		return cfg, fmt.Errorf("KAFKA_BROKER is not defined")
	}
	if cfg.RedisPort <= 0 {
		return cfg, fmt.Errorf("DB_CACHE_PORT is invalid")
	}
	if cfg.BalanceGRPCPort <= 0 {
		return cfg, fmt.Errorf("BALANCER_GRPC_PORT is invalid")
	}
	if cfg.HistoryReconciliationMessageLimit <= 0 {
		cfg.HistoryReconciliationMessageLimit = 100
	}
	if cfg.OutboundFailureReconnectThreshold <= 0 {
		cfg.OutboundFailureReconnectThreshold = 3
	}
	if cfg.OutboundFailureReconnectCooldown <= 0 {
		cfg.OutboundFailureReconnectCooldown = 2 * time.Minute
	}
	if cfg.OutboundReadyTimeout <= 0 {
		cfg.OutboundReadyTimeout = 60 * time.Second
	}
	if cfg.SendMaxInFlight <= 0 {
		cfg.SendMaxInFlight = 256
	}
	if cfg.KafkaConsumerMaxInFlight <= 0 {
		cfg.KafkaConsumerMaxInFlight = 32
	}
	if cfg.SendQueueTimeout <= 0 {
		cfg.SendQueueTimeout = cfg.KafkaConsumerStallTimeout
	}
	if cfg.KafkaHandlerErrorBackoff <= 0 {
		cfg.KafkaHandlerErrorBackoff = time.Second
	}
	if cfg.KafkaConsumerStallTimeout <= 0 {
		cfg.KafkaConsumerStallTimeout = 5 * time.Minute
	}
	if cfg.KafkaConsumerStallCheckInterval <= 0 {
		cfg.KafkaConsumerStallCheckInterval = 30 * time.Second
	}
	if cfg.KafkaConsumerMaxStallRestarts <= 0 {
		cfg.KafkaConsumerMaxStallRestarts = 3
	}
	if cfg.SelfMonitorInterval <= 0 {
		cfg.SelfMonitorInterval = 30 * time.Second
	}
	if cfg.SelfMonitorInitialDelay < 0 {
		cfg.SelfMonitorInitialDelay = 15 * time.Second
	}
	if cfg.SelfMonitorFailureThreshold <= 0 {
		cfg.SelfMonitorFailureThreshold = 3
	}
	if cfg.SelfHealRecoveryWindow <= 0 {
		cfg.SelfHealRecoveryWindow = 10 * time.Minute
	}
	if cfg.DailyMaintenanceHour < 0 || cfg.DailyMaintenanceHour > 23 {
		cfg.DailyMaintenanceHour = 2
	}
	if cfg.SendIdempotencyInProgressTTL <= 0 {
		cfg.SendIdempotencyInProgressTTL = 10 * time.Minute
	}
	if cfg.SendIdempotencyFinalTTL <= 0 {
		cfg.SendIdempotencyFinalTTL = 24 * time.Hour
	}
	if cfg.SendIdempotencyStaleAfter <= 0 {
		cfg.SendIdempotencyStaleAfter = cfg.SendTimeout + 30*time.Second
	}
	if cfg.SendIdempotencyStaleAfter < cfg.SendTimeout {
		cfg.SendIdempotencyStaleAfter = cfg.SendTimeout
	}
	return cfg, nil
}

func (c Config) BalanceGRPCAddress() string {
	return net.JoinHostPort(c.BalanceGRPCHost, strconv.Itoa(c.BalanceGRPCPort))
}

func (c Config) ProxyURL() string {
	if c.ProxyHost == "" || c.ProxyPort <= 0 {
		return ""
	}
	auth := ""
	if c.ProxyUsername != "" {
		auth = c.ProxyUsername
		if c.ProxyPassword != "" {
			auth += ":" + c.ProxyPassword
		}
		auth += "@"
	}
	return fmt.Sprintf("%s://%s%s:%d", c.ProxyProtocol, auth, c.ProxyHost, c.ProxyPort)
}

func envDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envIntDefault(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func envFloatDefault(key string, fallback float64) float64 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return fallback
	}
	return value
}

func envBoolDefault(key string, fallback bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if raw == "" {
		return fallback
	}
	return raw == "true" || raw == "1" || raw == "yes" || raw == "on"
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func resolveUnderchatEnvScope() (string, error) {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv("UNDERCHAT_ENV_SCOPE")))
	if raw != "" {
		if raw == "public" || raw == "private" {
			return raw, nil
		}
		return "", fmt.Errorf("UNDERCHAT_ENV_SCOPE is invalid: %s", os.Getenv("UNDERCHAT_ENV_SCOPE"))
	}

	candidates := []string{os.Args[0]}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, cwd)
	}
	if executable, err := os.Executable(); err == nil {
		candidates = append(candidates, executable)
	}
	for _, candidate := range candidates {
		normalized := strings.ReplaceAll(candidate, "\\", "/")
		if strings.Contains(normalized, "/apps/worker_whatsmeow/") ||
			strings.HasSuffix(normalized, "/apps/worker_whatsmeow") {
			return "public", nil
		}
	}

	return "private", nil
}

func scopedEnvDefault(scope, publicKey, privateKey, legacyKey, fallback string) string {
	scopedKey := privateKey
	if scope == "public" {
		scopedKey = publicKey
	}
	if value := strings.TrimSpace(os.Getenv(scopedKey)); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv(legacyKey)); value != "" {
		return value
	}
	return fallback
}

func envScopedIntDefault(scope, publicKey, privateKey, legacyKey string, fallback int) int {
	raw := scopedEnvDefault(scope, publicKey, privateKey, legacyKey, "")
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func envDurationDefault(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err == nil {
		return value
	}
	seconds, err := strconv.Atoi(raw)
	if err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	return fallback
}

func envMillisDurationDefault(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err == nil {
		return value
	}
	millis, err := strconv.Atoi(raw)
	if err == nil && millis > 0 {
		return time.Duration(millis) * time.Millisecond
	}
	return fallback
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
