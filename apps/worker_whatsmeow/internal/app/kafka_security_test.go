package app

import (
	"crypto/tls"
	"reflect"
	"strings"
	"testing"

	"github.com/segmentio/kafka-go"
)

func TestBuildKafkaSecurityAcceptsOnlyExplicitProtocolMatrix(t *testing.T) {
	t.Parallel()

	plainTLS, plainSASL, err := buildKafkaSecurity(
		"plaintext",
		"",
		"",
		"",
		true,
	)
	if err != nil {
		t.Fatalf("plaintext returned error: %v", err)
	}
	if plainTLS != nil || plainSASL != nil {
		t.Fatal("plaintext unexpectedly configured TLS or SASL")
	}

	sslTLS, sslSASL, err := buildKafkaSecurity("ssl", "", "", "", false)
	if err != nil {
		t.Fatalf("ssl returned error: %v", err)
	}
	if sslTLS == nil || sslTLS.MinVersion != tls.VersionTLS12 {
		t.Fatal("ssl did not enforce TLS 1.2 minimum")
	}
	if sslTLS.InsecureSkipVerify {
		t.Fatal("ssl disabled certificate or hostname verification")
	}
	if sslTLS.RootCAs != nil {
		t.Fatal("ssl should use the operating-system root store by default")
	}
	if sslSASL != nil {
		t.Fatal("ssl unexpectedly configured SASL")
	}

	saslPlainTLS, saslPlain, err := buildKafkaSecurity(
		"sasl_plaintext",
		"user",
		"password",
		"PLAIN",
		true,
	)
	if err != nil {
		t.Fatalf("sasl_plaintext returned error: %v", err)
	}
	if saslPlainTLS != nil || saslPlain == nil {
		t.Fatal("sasl_plaintext security configuration is incomplete")
	}

	saslSSLTLS, saslSSL, err := buildKafkaSecurity(
		"sasl_ssl",
		"user",
		"password",
		"SCRAM-SHA-512",
		false,
	)
	if err != nil {
		t.Fatalf("sasl_ssl returned error: %v", err)
	}
	if saslSSLTLS == nil ||
		saslSSLTLS.MinVersion != tls.VersionTLS12 ||
		saslSSLTLS.InsecureSkipVerify ||
		saslSSL == nil {
		t.Fatal("sasl_ssl did not enforce verified TLS and SASL")
	}
}

func TestBuildKafkaSecurityRejectsUnknownIncompleteAndMixedModes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		protocol  string
		username  string
		password  string
		mechanism string
	}{
		{
			name:     "unknown protocol",
			protocol: "tls",
		},
		{
			name:      "plaintext with SASL values",
			protocol:  "plaintext",
			username:  "user",
			password:  "password",
			mechanism: "PLAIN",
		},
		{
			name:      "ssl with SASL mechanism",
			protocol:  "ssl",
			mechanism: "PLAIN",
		},
		{
			name:      "SASL missing username",
			protocol:  "sasl_ssl",
			password:  "password",
			mechanism: "PLAIN",
		},
		{
			name:      "SASL missing password",
			protocol:  "sasl_ssl",
			username:  "user",
			mechanism: "PLAIN",
		},
		{
			name:     "SASL missing mechanism",
			protocol: "sasl_ssl",
			username: "user",
			password: "password",
		},
		{
			name:      "unsupported SASL mechanism",
			protocol:  "sasl_ssl",
			username:  "user",
			password:  "password",
			mechanism: "OAUTHBEARER",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if _, _, err := buildKafkaSecurity(
				test.protocol,
				test.username,
				test.password,
				test.mechanism,
				true,
			); err == nil {
				t.Fatal("expected invalid Kafka security configuration to fail")
			}
		})
	}
}

func TestBuildKafkaSecurityRequiresExplicitPlaintextOptIn(t *testing.T) {
	t.Parallel()

	for _, protocol := range []string{"plaintext", "sasl_plaintext"} {
		protocol := protocol
		t.Run(protocol, func(t *testing.T) {
			t.Parallel()
			username := ""
			password := ""
			mechanism := ""
			if protocol == "sasl_plaintext" {
				username = "user"
				password = "password"
				mechanism = "PLAIN"
			}
			if _, _, err := buildKafkaSecurity(
				protocol,
				username,
				password,
				mechanism,
				false,
			); err == nil || !strings.Contains(err.Error(), "KAFKA_ALLOW_PLAINTEXT=true") {
				t.Fatalf("buildKafkaSecurity(%q) error = %v", protocol, err)
			}
		})
	}
}

func TestKafkaWriterEnablesBrokerAutoTopicCreation(t *testing.T) {
	t.Parallel()

	client, err := NewKafkaClient(Config{
		KafkaBrokers:        []string{"127.0.0.1:9092"},
		KafkaProtocol:       "plaintext",
		KafkaAllowPlaintext: true,
	})
	if err != nil {
		t.Fatalf("NewKafkaClient returned error: %v", err)
	}
	defer client.Close()

	if !client.writer.AllowAutoTopicCreation {
		t.Fatal("Kafka writer must auto-create topics")
	}
}

func TestKafkaDependencyDisablesReadPartitionsAutoTopicCreation(t *testing.T) {
	t.Parallel()

	if kafka.ReadPartitionsAutoTopicCreationEnabled {
		t.Fatal(
			"kafka-go ReadPartitions would recreate a missing durable topic",
		)
	}
}

func TestKafkaRuntimeExposesNoAdministrativeSurface(t *testing.T) {
	t.Parallel()

	clientType := reflect.TypeOf((*KafkaClient)(nil))
	for _, method := range []string{"EnsureTopic", "CreateTopics", "DeleteTopics"} {
		if _, exists := clientType.MethodByName(method); exists {
			t.Fatalf("KafkaClient exposes administrative method %s", method)
		}
	}

	configType := reflect.TypeOf(Config{})
	for _, field := range []string{
		"KafkaProvisionerOperationsEnabled",
		"KafkaProvisionerAllowRuntimeCredentials",
		"KafkaProvisionerUsername",
		"KafkaProvisionerPassword",
		"KafkaProvisionerSASLMechanism",
	} {
		if _, exists := configType.FieldByName(field); exists {
			t.Fatalf("Config exposes administrative field %s", field)
		}
	}
}
