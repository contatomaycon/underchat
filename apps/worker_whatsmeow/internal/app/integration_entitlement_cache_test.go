package app

import (
	"bytes"
	"context"
	"log"
	"strings"
	"testing"
)

func TestDecodeIntegrationEntitlementCacheRejectsStructuralCorruption(t *testing.T) {
	accountID := "account-1"
	invalidPayloads := []string{
		`{}`,
		`{"account_id":"account-1","plan_product_id":"` + integrationPlanProductID + `","allowed":true,"revision":"","valid_until":"2099-01-01T00:00:00Z","plan_is_active":true}`,
		`{"account_id":"another-account","plan_product_id":"` + integrationPlanProductID + `","allowed":true,"revision":"7","valid_until":"2099-01-01T00:00:00Z","plan_is_active":true}`,
		`{"account_id":"account-1","plan_product_id":"` + integrationPlanProductID + `","allowed":true,"revision":"7","valid_until":"not-a-date","plan_is_active":true}`,
		`{"account_id":"account-1","plan_product_id":"` + integrationPlanProductID + `","allowed":true,"revision":"7","valid_until":"2099-01-01T00:00:00Z","plan_is_active":true,"source":"unknown"}`,
		`{"account_id":"account-1","plan_product_id":"` + integrationPlanProductID + `","allowed":false,"revision":"7","valid_until":null,"plan_is_active":true,"source":"plan"}`,
	}

	for _, payload := range invalidPayloads {
		if _, err := decodeIntegrationEntitlementCacheEntry(payload, accountID); err == nil {
			t.Fatalf("expected structurally corrupt payload to fail: %s", payload)
		}
	}
}

func TestDecodeIntegrationEntitlementCachePreservesGrantSource(t *testing.T) {
	payload := `{"account_id":"account-1","plan_product_id":"` + integrationPlanProductID + `","allowed":true,"revision":"8","valid_until":"2099-01-01T00:00:00Z","plan_is_active":true,"source":"addon"}`
	entitlement, err := decodeIntegrationEntitlementCacheEntry(payload, "account-1")
	if err != nil {
		t.Fatalf("expected valid grant payload, got %v", err)
	}
	if entitlement.Source == nil || *entitlement.Source != "addon" {
		t.Fatalf("expected addon grant source, got %+v", entitlement)
	}
}

func TestDecodeIntegrationEntitlementCacheAcceptsExplicitDenial(t *testing.T) {
	payload := `{"account_id":"account-1","plan_product_id":"` + integrationPlanProductID + `","allowed":false,"revision":"8","valid_until":null,"plan_is_active":false}`
	entitlement, err := decodeIntegrationEntitlementCacheEntry(payload, "account-1")
	if err != nil {
		t.Fatalf("expected valid denial payload, got %v", err)
	}
	if entitlement.Allowed == nil || *entitlement.Allowed {
		t.Fatalf("expected explicit denial, got %+v", entitlement)
	}
}

func TestIntegrationEntitlementTelemetrySnapshotUsesBoundedCounters(t *testing.T) {
	worker := &Worker{}
	worker.integrationEntitlementAllowed.Add(2)
	worker.integrationEntitlementDenied.Add(1)
	worker.integrationEntitlementUnavailable.Add(3)
	worker.integrationEntitlementSuppressed.Add(1)

	snapshot := worker.integrationEntitlementTelemetrySnapshot()
	if snapshot["allowed"] != 2 || snapshot["denied"] != 1 || snapshot["unavailable"] != 3 || snapshot["suppressed"] != 1 {
		t.Fatalf("unexpected plan entitlement telemetry snapshot: %+v", snapshot)
	}
	if len(snapshot) != 4 {
		t.Fatalf("unexpected high-cardinality telemetry fields: %+v", snapshot)
	}
}

func TestIntegrationEntitlementSuppressionAuditIncludesRevisionSourceAndEvent(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previousWriter)

	worker := &Worker{cfg: Config{WorkerID: "worker-1"}}
	allowed, _, err := worker.readCurrentIntegrationEntitlement(
		context.Background(),
		"account-1",
		"",
		"received",
		"event-42",
	)
	if err != nil || allowed {
		t.Fatalf("expected terminal legacy suppression, allowed=%v err=%v", allowed, err)
	}

	line := output.String()
	for _, expected := range []string{
		"account_id=account-1",
		"expected_revision=",
		"actual_revision=",
		"source=",
		"event_id=event-42",
	} {
		if !strings.Contains(line, expected) {
			t.Fatalf("expected audit log to contain %q, got %q", expected, line)
		}
	}
}
