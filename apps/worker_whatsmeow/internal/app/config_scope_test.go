package app

import (
	"strings"
	"testing"
)

func TestLoadConfigUsesPublicScopedEndpoints(t *testing.T) {
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
