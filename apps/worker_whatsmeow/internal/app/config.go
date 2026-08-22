package app

import (
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	defaultHistoryReconciliationWindow        = 6 * time.Hour
	defaultHistoryReconciliationMessageLimit  = 1000
	defaultHistoryReconciliationChatScanLimit = 100
	defaultHistoryReconciliationPerChatLimit  = 250
	defaultSendQueueTimeout                   = 45 * time.Second
	defaultTypingSimulationMaxDelay           = 15 * time.Second
	defaultTypingSimulationProviderReserve    = 20 * time.Second
	defaultTypingSimulationMaxOrphans         = 8
	maxTypingSimulationMaxOrphans             = 64
	defaultProviderSendMaxInFlight            = 4
	maxProviderSendMaxInFlight                = 64
	minTypingSimulationMaxDelay               = time.Second
	maxTypingSimulationMaxDelay               = 60 * time.Second
	defaultRuntimeEffectLeaseTTL              = 45 * time.Second
	defaultRuntimeEffectLeaseHeartbeat        = 5 * time.Second
)

type Config struct {
	AppEnvironment            string
	WorkerID                  string
	AccountID                 string
	RuntimeGeneration         int
	DataDir                   string
	SessionStorage            string
	WorkerDatabaseURL         string
	SessionStorageMigrationID string
	LegacySessionVolumeName   string
	LegacySessionChecksum     string
	RuntimeCapability         string
	WriterEpoch               string
	// OwnedConnectionEpoch and OwnedConnectionAttemptID are resolved from the
	// durable pairing grant during same-generation bootstrap. They are never
	// accepted from environment input.
	OwnedConnectionEpoch     string
	OwnedConnectionAttemptID string
	// DeferAuthStoreInitialization is set only by the runtime bootstrap when the
	// durable connection fence rejects an unowned/stale activation (for example
	// after an explicit disconnect tombstone). The process remains available to
	// consume a newly authorized QR grant, but must not open the provider auth
	// store before that grant is durably activated.
	DeferAuthStoreInitialization bool
	ElasticURL                   string
	ElasticUsername              string
	ElasticPassword              string
	WarmStandby                  bool
	WarmPoolID                   string

	HTTPAddr string
	GRPCAddr string

	KafkaBrokers        []string
	KafkaProtocol       string
	KafkaUsername       string
	KafkaPassword       string
	KafkaSASLMechanism  string
	KafkaAllowPlaintext bool

	NATSURLs     []string
	NATSUser     string
	NATSPassword string
	NATSTLS      bool

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
	OutboundReadyTimeout                 time.Duration
	SendMaxInFlight                      int
	ProviderSendMaxInFlight              int
	KafkaConsumerMaxInFlight             int
	SendQueueTimeout                     time.Duration
	TypingSimulationMaxDelay             time.Duration
	TypingSimulationProviderReserve      time.Duration
	TypingSimulationMaxOrphans           int
	RuntimeEffectLeaseTTL                time.Duration
	RuntimeEffectLeaseHeartbeat          time.Duration
	ConnectionHealthFailOnKafkaUnhealthy bool
	ConnectionLifecycleDebugEnabled      bool
	WhatsappSessionDebugEnabled          bool
	SelfMonitorInterval                  time.Duration
	SelfMonitorInitialDelay              time.Duration
	SelfMonitorFailureThreshold          int
	SelfHealRecoveryWindow               time.Duration
	DailyMaintenanceEnabled              bool
	DailyMaintenanceHour                 int
	DailyMaintenanceMinute               int

	KafkaConsumerRepairCooldown  time.Duration
	KafkaConsumerMaxLocalRepairs int

	OutboundFailureReconnectThreshold int
	OutboundFailureReconnectCooldown  time.Duration

	HistoryReconciliationEnabled       bool
	HistoryReconciliationWindow        time.Duration
	HistoryReconciliationMessageLimit  int
	HistoryReconciliationChatScanLimit int
	HistoryReconciliationPerChatLimit  int
}

func LoadConfig() (Config, error) {
	envScope, err := resolveUnderchatEnvScope()
	if err != nil {
		return Config{}, err
	}
	dailyMaintenanceHour, dailyMaintenanceMinute := envDailyMaintenanceSchedule()
	kafkaProtocol := strings.ToLower(scopedEnvDefault(
		envScope,
		"KAFKA_PUBLIC_SECURITY_PROTOCOL",
		"KAFKA_PRIVATE_SECURITY_PROTOCOL",
		"SECURITY_PROTOCOL",
		"",
	))
	cfg := Config{
		AppEnvironment:            strings.ToUpper(strings.TrimSpace(os.Getenv("APP_ENVIRONMENT"))),
		WorkerID:                  strings.TrimSpace(os.Getenv("WORKER_ID")),
		AccountID:                 strings.TrimSpace(os.Getenv("ACCOUNT_ID")),
		RuntimeGeneration:         envIntDefault("RUNTIME_GENERATION", 0),
		DataDir:                   envDefault("WORKER_DATA_DIR", "/app/data"),
		SessionStorage:            normalizeSessionStorage(os.Getenv("WORKER_SESSION_STORAGE")),
		WorkerDatabaseURL:         strings.TrimSpace(os.Getenv("WORKER_DATABASE_URL")),
		SessionStorageMigrationID: strings.TrimSpace(os.Getenv("SESSION_STORAGE_MIGRATION_ID")),
		LegacySessionVolumeName:   strings.TrimSpace(os.Getenv("LEGACY_SESSION_VOLUME_NAME")),
		LegacySessionChecksum:     strings.ToLower(strings.TrimSpace(os.Getenv("LEGACY_SESSION_CHECKSUM_SHA256"))),
		RuntimeCapability:         strings.TrimSpace(os.Getenv("WORKER_RUNTIME_CAPABILITY")),
		WriterEpoch:               strings.TrimSpace(os.Getenv("WORKER_WRITER_EPOCH")),
		ElasticURL: scopedEnvDefault(
			envScope,
			"DB_ELASTIC_PUBLIC_HOST",
			"DB_ELASTIC_PRIVATE_HOST",
			"DB_ELASTIC_HOST",
			"",
		),
		ElasticUsername: strings.TrimSpace(os.Getenv("DB_ELASTIC_USER")),
		ElasticPassword: os.Getenv("DB_ELASTIC_PASSWORD"),
		WarmStandby:     envBoolDefault("WARM_STANDBY", false),
		WarmPoolID:      strings.TrimSpace(os.Getenv("WARM_POOL_ID")),
		HTTPAddr:        ":" + envDefault("WORKER_HTTP_PORT", "3005"),
		GRPCAddr:        ":" + envDefault("WORKER_WHATSMEOW_GRPC_PORT", "50054"),
		KafkaBrokers: splitCSV(scopedEnvDefault(
			envScope,
			"KAFKA_PUBLIC_BROKER",
			"KAFKA_PRIVATE_BROKER",
			"KAFKA_BROKER",
			"",
		)),
		KafkaProtocol: kafkaProtocol,
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
			"",
		)),
		KafkaAllowPlaintext: envBoolDefault("KAFKA_ALLOW_PLAINTEXT", kafkaProtocolUsesPlaintext(kafkaProtocol)),
		NATSURLs: splitCSV(scopedEnvDefault(
			envScope,
			"NATS_PUBLIC_URL",
			"NATS_PRIVATE_URL",
			"NATS_URL",
			"nats://localhost:4222",
		)),
		NATSUser:     strings.TrimSpace(os.Getenv("NATS_USER")),
		NATSPassword: os.Getenv("NATS_PASSWORD"),
		NATSTLS:      envBoolDefault("NATS_TLS", false),
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
		SendTimeout:          envDurationDefault("WORKER_SEND_TIMEOUT", 45*time.Second),
		WhatsAppConnectTimeout: envDurationDefault(
			"WORKER_WHATSAPP_CONNECT_TIMEOUT",
			45*time.Second,
		),
		ConnectionQRFirstQRTimeout:           envMillisDurationDefault("CONNECTION_QR_FIRST_QR_TIMEOUT_MS", 75*time.Second),
		OutboundReadyTimeout:                 envDurationDefault("WORKER_OUTBOUND_READY_TIMEOUT", 60*time.Second),
		SendMaxInFlight:                      envIntDefault("WORKER_SEND_MAX_IN_FLIGHT", 256),
		ProviderSendMaxInFlight:              envIntDefault("WORKER_PROVIDER_SEND_MAX_IN_FLIGHT", defaultProviderSendMaxInFlight),
		KafkaConsumerMaxInFlight:             envIntDefault("WORKER_KAFKA_MAX_IN_FLIGHT", 32),
		SendQueueTimeout:                     envDurationDefault("WORKER_SEND_QUEUE_TIMEOUT", defaultSendQueueTimeout),
		TypingSimulationMaxDelay:             resolveTypingSimulationMaxDelay(os.Getenv("TYPING_SIMULATION_MAX_DELAY_MS")),
		TypingSimulationProviderReserve:      envMillisDurationDefault("WORKER_SEND_PROVIDER_RESERVE_MS", defaultTypingSimulationProviderReserve),
		TypingSimulationMaxOrphans:           envIntDefault("WORKER_TYPING_MAX_ORPHANS", defaultTypingSimulationMaxOrphans),
		RuntimeEffectLeaseTTL:                envMillisDurationDefault("WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS", defaultRuntimeEffectLeaseTTL),
		RuntimeEffectLeaseHeartbeat:          envMillisDurationDefault("WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS", defaultRuntimeEffectLeaseHeartbeat),
		ConnectionHealthFailOnKafkaUnhealthy: envBoolDefault("WORKER_CONNECTION_HEALTH_FAIL_ON_KAFKA_UNHEALTHY", false),
		ConnectionLifecycleDebugEnabled:      envBoolDefault("CONNECTION_LIFECYCLE_DEBUG_ENABLED", false),
		WhatsappSessionDebugEnabled:          envBoolDefault("WHATSAPP_SESSION_DEBUG_ENABLED", true),
		SelfMonitorInterval:                  envMillisDurationDefault("WORKER_SELF_MONITOR_INTERVAL_MS", 30*time.Second),
		SelfMonitorInitialDelay:              envMillisDurationDefault("WORKER_SELF_MONITOR_INITIAL_DELAY_MS", 15*time.Second),
		SelfMonitorFailureThreshold:          envIntDefault("WORKER_SELF_MONITOR_FAILURE_THRESHOLD", 3),
		SelfHealRecoveryWindow:               time.Duration(envIntDefault("WORKER_SELF_HEAL_RECOVERY_WINDOW_SECONDS", 10*60)) * time.Second,
		DailyMaintenanceEnabled:              envBoolDefault("WORKER_DAILY_MAINTENANCE_ENABLED", false),
		DailyMaintenanceHour:                 dailyMaintenanceHour,
		DailyMaintenanceMinute:               dailyMaintenanceMinute,
		KafkaConsumerRepairCooldown:          envMillisDurationDefault("KAFKA_CONSUMER_REPAIR_COOLDOWN_MS", 30*time.Second),
		KafkaConsumerMaxLocalRepairs:         envIntDefault("KAFKA_CONSUMER_MAX_LOCAL_REPAIRS", 3),
		OutboundFailureReconnectThreshold:    envIntDefault("WORKER_OUTBOUND_FAILURE_RECONNECT_THRESHOLD", 3),
		OutboundFailureReconnectCooldown:     envDurationDefault("WORKER_OUTBOUND_FAILURE_RECONNECT_COOLDOWN", 2*time.Minute),
		HistoryReconciliationEnabled:         envBoolDefault("HISTORY_RECONCILIATION_ENABLED", true),
		HistoryReconciliationWindow:          envMillisDurationDefault("HISTORY_RECONCILIATION_WINDOW_MS", defaultHistoryReconciliationWindow),
		HistoryReconciliationMessageLimit:    envIntDefault("HISTORY_RECONCILIATION_MESSAGE_LIMIT", defaultHistoryReconciliationMessageLimit),
		HistoryReconciliationChatScanLimit:   envIntDefault("HISTORY_RECONCILIATION_CHAT_SCAN_LIMIT", defaultHistoryReconciliationChatScanLimit),
		HistoryReconciliationPerChatLimit:    envIntDefault("HISTORY_RECONCILIATION_PER_CHAT_LIMIT", defaultHistoryReconciliationPerChatLimit),
	}

	if cfg.SessionStorage != SessionStorageLegacyVolume && cfg.SessionStorage != SessionStoragePostgres {
		return cfg, fmt.Errorf("WORKER_SESSION_STORAGE must be %q or %q", SessionStorageLegacyVolume, SessionStoragePostgres)
	}
	if !cfg.WarmStandby {
		if cfg.WorkerID == "" {
			return cfg, fmt.Errorf("WORKER_ID is not defined")
		}
		if cfg.AccountID == "" {
			return cfg, fmt.Errorf("ACCOUNT_ID is not defined")
		}
	}
	if cfg.SessionStorage == SessionStoragePostgres {
		if cfg.WorkerDatabaseURL == "" {
			return cfg, fmt.Errorf("WORKER_DATABASE_URL is required for postgres session storage")
		}
	}
	migrationFieldCount := 0
	for _, value := range []string{cfg.SessionStorageMigrationID, cfg.LegacySessionVolumeName, cfg.LegacySessionChecksum} {
		if value != "" {
			migrationFieldCount++
		}
	}
	if migrationFieldCount != 0 && migrationFieldCount != 3 {
		return cfg, fmt.Errorf("session storage migration environment is incomplete")
	}
	if migrationFieldCount == 3 {
		if cfg.SessionStorage != SessionStoragePostgres {
			return cfg, fmt.Errorf("session storage migration requires postgres storage")
		}
		if _, err := uuid.Parse(cfg.SessionStorageMigrationID); err != nil {
			return cfg, fmt.Errorf("SESSION_STORAGE_MIGRATION_ID must be a UUID")
		}
		if len(cfg.LegacySessionVolumeName) > 255 || strings.ContainsAny(cfg.LegacySessionVolumeName, "\\/\x00") {
			return cfg, fmt.Errorf("LEGACY_SESSION_VOLUME_NAME is invalid")
		}
		if len(cfg.LegacySessionChecksum) != 64 {
			return cfg, fmt.Errorf("LEGACY_SESSION_CHECKSUM_SHA256 is invalid")
		}
		if _, err := hex.DecodeString(cfg.LegacySessionChecksum); err != nil {
			return cfg, fmt.Errorf("LEGACY_SESSION_CHECKSUM_SHA256 is invalid")
		}
	}
	// Every active worker with direct database access participates in the same
	// canonical runtime fence, including legacy-volume workers. A warm standby
	// deliberately has no channel identity until ActivateRuntime assigns it.
	if cfg.WorkerDatabaseURL != "" && !cfg.WarmStandby {
		if _, err := uuid.Parse(cfg.WorkerID); err != nil {
			return cfg, fmt.Errorf("WORKER_ID must be a UUID when WORKER_DATABASE_URL is configured")
		}
		if _, err := uuid.Parse(cfg.AccountID); err != nil {
			return cfg, fmt.Errorf("ACCOUNT_ID must be a UUID when WORKER_DATABASE_URL is configured")
		}
		if cfg.RuntimeGeneration <= 0 {
			return cfg, fmt.Errorf("RUNTIME_GENERATION must be positive when WORKER_DATABASE_URL is configured")
		}
		if len(cfg.RuntimeCapability) < 32 {
			return cfg, fmt.Errorf("WORKER_RUNTIME_CAPABILITY is required when WORKER_DATABASE_URL is configured")
		}
		if _, err := uuid.Parse(cfg.WriterEpoch); err != nil {
			return cfg, fmt.Errorf("WORKER_WRITER_EPOCH must be a UUID when WORKER_DATABASE_URL is configured")
		}
	}
	if len(cfg.KafkaBrokers) == 0 {
		return cfg, fmt.Errorf("KAFKA_BROKER is not defined")
	}
	if len(cfg.NATSURLs) == 0 {
		return cfg, fmt.Errorf("NATS_URL is not defined")
	}
	if (cfg.NATSUser == "") != (cfg.NATSPassword == "") {
		return cfg, fmt.Errorf("NATS_USER and NATS_PASSWORD must be configured together")
	}
	if strings.TrimSpace(os.Getenv("NATS_TOKEN")) != "" || strings.TrimSpace(os.Getenv("NATS_CREDS_BASE64")) != "" {
		return cfg, fmt.Errorf("NATS workers support only NATS_USER and NATS_PASSWORD authentication")
	}
	if raw := strings.TrimSpace(os.Getenv("NATS_TLS")); raw != "" &&
		!strings.EqualFold(raw, "true") && !strings.EqualFold(raw, "false") {
		return cfg, fmt.Errorf("NATS_TLS must be true or false")
	}
	if strings.TrimSpace(cfg.KafkaProtocol) == "" {
		return cfg, fmt.Errorf("Kafka security protocol is not defined")
	}
	if kafkaProtocolUsesPlaintext(cfg.KafkaProtocol) && !cfg.KafkaAllowPlaintext {
		return cfg, fmt.Errorf(
			"Kafka plaintext transport requires KAFKA_ALLOW_PLAINTEXT=true",
		)
	}
	if cfg.RedisPort <= 0 {
		return cfg, fmt.Errorf("DB_CACHE_PORT is invalid")
	}
	if cfg.HistoryReconciliationWindow <= 0 {
		cfg.HistoryReconciliationWindow = defaultHistoryReconciliationWindow
	}
	if cfg.HistoryReconciliationMessageLimit <= 0 {
		cfg.HistoryReconciliationMessageLimit = defaultHistoryReconciliationMessageLimit
	}
	if cfg.HistoryReconciliationChatScanLimit <= 0 {
		cfg.HistoryReconciliationChatScanLimit = defaultHistoryReconciliationChatScanLimit
	}
	if cfg.HistoryReconciliationPerChatLimit <= 0 {
		cfg.HistoryReconciliationPerChatLimit = defaultHistoryReconciliationPerChatLimit
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
	cfg.ProviderSendMaxInFlight = normalizeProviderSendMaxInFlight(
		cfg.ProviderSendMaxInFlight,
	)
	if cfg.KafkaConsumerMaxInFlight <= 0 {
		cfg.KafkaConsumerMaxInFlight = 32
	}
	if cfg.SendQueueTimeout <= 0 {
		cfg.SendQueueTimeout = defaultSendQueueTimeout
	}
	cfg.TypingSimulationMaxDelay = normalizeTypingSimulationMaxDelay(cfg.TypingSimulationMaxDelay)
	if cfg.TypingSimulationProviderReserve <= 0 {
		cfg.TypingSimulationProviderReserve = defaultTypingSimulationProviderReserve
	}
	cfg.TypingSimulationMaxOrphans = normalizeTypingSimulationMaxOrphans(
		cfg.TypingSimulationMaxOrphans,
	)
	cfg.RuntimeEffectLeaseTTL, cfg.RuntimeEffectLeaseHeartbeat =
		normalizeRuntimeEffectLeaseDurations(
			cfg.RuntimeEffectLeaseTTL,
			cfg.RuntimeEffectLeaseHeartbeat,
		)
	if cfg.KafkaConsumerRepairCooldown <= 0 {
		cfg.KafkaConsumerRepairCooldown = 30 * time.Second
	}
	if cfg.KafkaConsumerMaxLocalRepairs <= 0 {
		cfg.KafkaConsumerMaxLocalRepairs = 3
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
	if cfg.DailyMaintenanceMinute < 0 || cfg.DailyMaintenanceMinute > 59 {
		cfg.DailyMaintenanceMinute = 0
	}
	return cfg, nil
}

func withoutNATSAuthentication(cfg Config) Config {
	cfg.NATSUser = ""
	cfg.NATSPassword = ""
	return cfg
}

func hasNATSAuthentication(cfg Config) bool {
	return cfg.NATSUser != "" && cfg.NATSPassword != ""
}

func warmStandbyNATSConfig(cfg Config) Config {
	return cfg
}

func workerRuntimeNATSConfig(cfg Config) (Config, error) {
	if !hasNATSAuthentication(cfg) {
		return cfg, errors.New("NATS_USER and NATS_PASSWORD are required")
	}
	return cfg, nil
}

const (
	SessionStorageLegacyVolume = "legacy_volume"
	SessionStoragePostgres     = "postgres"
)

func normalizeSessionStorage(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return SessionStorageLegacyVolume
	}
	return value
}

func normalizeProviderSendMaxInFlight(limit int) int {
	if limit <= 0 {
		return defaultProviderSendMaxInFlight
	}
	if limit > maxProviderSendMaxInFlight {
		return maxProviderSendMaxInFlight
	}
	return limit
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

func envDailyMaintenanceSchedule() (int, int) {
	raw := strings.TrimSpace(os.Getenv("WORKER_DAILY_MAINTENANCE_TIME"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("WORKER_DAILY_MAINTENANCE_HOUR"))
	}
	if raw == "" {
		return 2, 0
	}

	parts := strings.Split(raw, ":")
	if len(parts) > 2 {
		return 2, 0
	}

	hour, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || hour < 0 || hour > 23 {
		return 2, 0
	}

	minute := 0
	if len(parts) == 2 {
		minute, err = strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil || minute < 0 || minute > 59 {
			return 2, 0
		}
	}

	return hour, minute
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

// resolveTypingSimulationMaxDelay mirrors the shared Node worker contract:
// integer values are milliseconds, duration strings remain accepted by the Go
// worker, invalid/non-positive values use the safe default, and the result is
// constrained to one through sixty seconds.
func resolveTypingSimulationMaxDelay(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultTypingSimulationMaxDelay
	}
	if value, err := time.ParseDuration(raw); err == nil {
		return normalizeTypingSimulationMaxDelay(value)
	}
	millis, err := strconv.Atoi(raw)
	if err != nil || millis <= 0 {
		return defaultTypingSimulationMaxDelay
	}
	return normalizeTypingSimulationMaxDelay(time.Duration(millis) * time.Millisecond)
}

func normalizeTypingSimulationMaxDelay(value time.Duration) time.Duration {
	if value <= 0 {
		return defaultTypingSimulationMaxDelay
	}
	if value < minTypingSimulationMaxDelay {
		return minTypingSimulationMaxDelay
	}
	if value > maxTypingSimulationMaxDelay {
		return maxTypingSimulationMaxDelay
	}
	return value
}

func normalizeTypingSimulationMaxOrphans(value int) int {
	if value <= 0 {
		return defaultTypingSimulationMaxOrphans
	}
	if value > maxTypingSimulationMaxOrphans {
		return maxTypingSimulationMaxOrphans
	}
	return value
}

func normalizeRuntimeEffectLeaseDurations(
	ttl time.Duration,
	heartbeat time.Duration,
) (time.Duration, time.Duration) {
	if ttl <= 0 {
		ttl = defaultRuntimeEffectLeaseTTL
	}
	if heartbeat <= 0 {
		heartbeat = defaultRuntimeEffectLeaseHeartbeat
	}
	// Require six missed heartbeats before an orphan expires. A live provider
	// effect remains fenced through short Redis/network stalls while a hard
	// crash no longer blocks replacement for the previous five minutes.
	minimumTTL := heartbeat * 6
	if ttl < minimumTTL {
		ttl = minimumTTL
	}
	return ttl, heartbeat
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
