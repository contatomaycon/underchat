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
	WorkerID  string
	AccountID string
	DataDir   string

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

	OTELEnabled          bool
	OTELServiceName      string
	OTELEnvironment      string
	OTELTraceSampleRate  float64
	OTELResourceAttrsRaw string

	ProxyProtocol string
	ProxyHost     string
	ProxyPort     int
	ProxyUsername string
	ProxyPassword string

	SendTimeout            time.Duration
	WhatsAppConnectTimeout time.Duration
	KafkaPollInterval      time.Duration

	OutboundFailureReconnectThreshold int
	OutboundFailureReconnectCooldown  time.Duration
	SendIdempotencyInProgressTTL      time.Duration
	SendIdempotencyFinalTTL           time.Duration

	HistoryReconciliationEnabled      bool
	HistoryReconciliationMessageLimit int
	HistoryReconciliationMaxAge       time.Duration

	MessageLifecycleDebugEnabled           bool
	MessageLifecycleDebugBodyLimit         int
	MessageLifecycleDebugRawLimit          int
	MessageLifecycleOutboundSuccessEnabled bool

	ConnectionLifecycleDebugEnabled    bool
	ConnectionLifecycleDebugValueLimit int
	ConnectionLifecycleDebugRawLimit   int
}

func LoadConfig() (Config, error) {
	cfg := Config{
		WorkerID:             strings.TrimSpace(os.Getenv("WORKER_ID")),
		AccountID:            strings.TrimSpace(os.Getenv("ACCOUNT_ID")),
		DataDir:              envDefault("WORKER_DATA_DIR", "/app/data"),
		HTTPAddr:             ":" + envDefault("WORKER_HTTP_PORT", "3005"),
		GRPCAddr:             ":" + envDefault("WORKER_WHATSMEOW_GRPC_PORT", "50054"),
		BalanceGRPCHost:      envDefault("BALANCER_GRPC_HOST", "under-balance-api"),
		BalanceGRPCPort:      envIntDefault("BALANCER_GRPC_PORT", 50051),
		KafkaBrokers:         splitCSV(os.Getenv("KAFKA_BROKER")),
		KafkaProtocol:        strings.ToLower(envDefault("SECURITY_PROTOCOL", "plaintext")),
		KafkaUsername:        os.Getenv("KAFKA_USERNAME"),
		KafkaPassword:        os.Getenv("KAFKA_PASSWORD"),
		KafkaSASLMechanism:   strings.ToUpper(envDefault("SASL_MECHANISM", "PLAIN")),
		RedisHost:            envDefault("DB_CACHE_HOST", "localhost"),
		RedisPort:            envIntDefault("DB_CACHE_PORT", 6379),
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
		CentrifugoHTTPAPIURL: os.Getenv("CENTRIFUGO_HTTP_API_URL"),
		CentrifugoHTTPAPIKey: os.Getenv("CENTRIFUGO_HTTP_API_KEY"),
		OTELEnabled:          envBoolDefault("OTEL_ENABLE", true),
		OTELServiceName:      envDefault("OTEL_SERVICE_NAME", "whatsmeow"),
		OTELEnvironment:      firstEnv("OTEL_ENVIRONMENT", "NODE_ENV", "LOCAL"),
		OTELTraceSampleRate:  envFloatDefault("OTEL_TRACE_SAMPLE_RATE", 1.0),
		OTELResourceAttrsRaw: os.Getenv("OTEL_RESOURCE_ATTRIBUTES"),
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
		KafkaPollInterval:                      250 * time.Millisecond,
		OutboundFailureReconnectThreshold:      envIntDefault("WORKER_OUTBOUND_FAILURE_RECONNECT_THRESHOLD", 3),
		OutboundFailureReconnectCooldown:       envDurationDefault("WORKER_OUTBOUND_FAILURE_RECONNECT_COOLDOWN", 2*time.Minute),
		SendIdempotencyInProgressTTL:           envDurationDefault("WORKER_SEND_IDEMPOTENCY_IN_PROGRESS_TTL", 10*time.Minute),
		SendIdempotencyFinalTTL:                envDurationDefault("WORKER_SEND_IDEMPOTENCY_FINAL_TTL", 24*time.Hour),
		HistoryReconciliationEnabled:           envBoolDefault("HISTORY_RECONCILIATION_ENABLED", true),
		HistoryReconciliationMessageLimit:      envIntDefault("HISTORY_RECONCILIATION_MESSAGE_LIMIT", 100),
		HistoryReconciliationMaxAge:            envMillisDurationDefault("HISTORY_RECONCILIATION_MAX_AGE_MS", time.Hour),
		MessageLifecycleDebugEnabled:           envBoolDefault("MESSAGE_LIFECYCLE_DEBUG_ENABLED", false),
		MessageLifecycleDebugBodyLimit:         envIntDefault("MESSAGE_LIFECYCLE_DEBUG_BODY_LIMIT", 500),
		MessageLifecycleDebugRawLimit:          envIntDefault("MESSAGE_LIFECYCLE_DEBUG_RAW_LIMIT", 4000),
		MessageLifecycleOutboundSuccessEnabled: envBoolDefault("MESSAGE_LIFECYCLE_OUTBOUND_SUCCESS_ENABLED", true),
		ConnectionLifecycleDebugEnabled:        envBoolDefault("CONNECTION_LIFECYCLE_DEBUG_ENABLED", false),
		ConnectionLifecycleDebugValueLimit: envIntDefault(
			"CONNECTION_LIFECYCLE_DEBUG_VALUE_LIMIT",
			500,
		),
		ConnectionLifecycleDebugRawLimit: envIntDefault(
			"CONNECTION_LIFECYCLE_DEBUG_RAW_LIMIT",
			4000,
		),
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
	if cfg.SendIdempotencyInProgressTTL <= 0 {
		cfg.SendIdempotencyInProgressTTL = 10 * time.Minute
	}
	if cfg.SendIdempotencyFinalTTL <= 0 {
		cfg.SendIdempotencyFinalTTL = 24 * time.Hour
	}
	if cfg.MessageLifecycleDebugBodyLimit <= 0 {
		cfg.MessageLifecycleDebugBodyLimit = 500
	}
	if cfg.MessageLifecycleDebugRawLimit <= 0 {
		cfg.MessageLifecycleDebugRawLimit = 4000
	}
	if cfg.ConnectionLifecycleDebugValueLimit <= 0 {
		cfg.ConnectionLifecycleDebugValueLimit = 500
	}
	if cfg.ConnectionLifecycleDebugRawLimit <= 0 {
		cfg.ConnectionLifecycleDebugRawLimit = 4000
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
