package app

import (
	"context"
	"errors"
	"strings"

	"github.com/lib/pq"
)

const (
	safeCodeStartupPostgresOpenFailed          = "startup_postgres_open_failed"
	safeCodeStartupWarmHydrateFailed           = "startup_warm_hydrate_failed"
	safeCodeStartupRuntimeFenceActivateFailed  = "startup_runtime_fence_activate_failed"
	safeCodeStartupKafkaCreateFailed           = "startup_kafka_create_failed"
	safeCodeStartupStorageCreateFailed         = "startup_storage_create_failed"
	safeCodeStartupSessionLeaseAcquireFailed   = "startup_session_lease_acquire_failed"
	safeCodeStartupSessionSchemaValidateFailed = "startup_session_schema_validate_failed"
	safeCodeStartupSessionRecoveryFailed       = "startup_session_recovery_failed"
	safeCodeStartupSessionRevisionOpenFailed   = "startup_session_revision_open_failed"
	safeCodeStartupLegacySnapshotFailed        = "startup_legacy_volume_snapshot_failed"
	safeCodeStartupLegacyCaptureFailed         = "startup_legacy_volume_capture_failed"
	safeCodeStartupLegacyValidationFailed      = "startup_legacy_volume_validation_failed"
	safeCodeStartupLegacyImportFailed          = "startup_legacy_volume_import_failed"
	safeCodeStartupHandoffHydrateFailed        = "startup_handoff_hydrate_failed"
	safeCodeStartupHandoffRollbackFailed       = "startup_handoff_rollback_failed"
	safeCodeStartupHandoffScopeChanged         = "startup_handoff_scope_changed"
	safeCodeStartupSessionDeviceOpenFailed     = "startup_session_device_open_failed"
	safeCodeStartupGRPCBridgeCreateFailed      = "startup_grpc_bridge_create_failed"
	safeCodeWebhookIntegrationUnavailable      = "webhook_integration_entitlement_unavailable"
	safeCodeHandoffInputFailed                 = "whatsapp_whatsmeow_handoff_input_failed"
	safeCodeHandoffSourceScopeFailed           = "whatsapp_whatsmeow_handoff_source_scope_failed"
	safeCodeHandoffSourceStateConflict         = "whatsapp_whatsmeow_handoff_source_state_conflict"
	safeCodeHandoffSourceCompatibilityFailed   = "whatsapp_whatsmeow_handoff_source_compatibility_failed"
	safeCodeHandoffSourceSnapshotFailed        = "whatsapp_whatsmeow_handoff_source_snapshot_failed"
	safeCodeHandoffProjectionConversionFailed  = "whatsapp_whatsmeow_handoff_projection_conversion_failed"
	safeCodeHandoffTargetScopeFailed           = "whatsapp_whatsmeow_handoff_target_scope_failed"
	safeCodeHandoffTargetImportFailed          = "whatsapp_whatsmeow_handoff_target_import_failed"
	safeCodeHandoffTargetResyncGateFailed      = "whatsapp_whatsmeow_handoff_target_resync_gate_failed"
	safeCodeHandoffTargetFinalizeFailed        = "whatsapp_whatsmeow_handoff_target_finalize_failed"
	safeCodeHandoffCandidateOpenFailed         = "whatsapp_whatsmeow_handoff_candidate_open_failed"
	safeCodeHandoffBootstrapFailed             = "whatsapp_whatsmeow_handoff_bootstrap_failed"
	safeCodeHandoffReadinessFailed             = "whatsapp_whatsmeow_handoff_readiness_failed"
	safeCodeHandoffPromotionFailed             = "whatsapp_whatsmeow_handoff_promotion_failed"
	safeCodeHandoffUnknownFailed               = "whatsapp_whatsmeow_handoff_unknown_failed"
	safeCodeHandoffRuntimeRollback             = "whatsapp_whatsmeow_handoff_runtime_rollback"
)

var safeOperationalCodes = map[string]struct{}{
	safeCodeStartupPostgresOpenFailed:          {},
	safeCodeStartupWarmHydrateFailed:           {},
	safeCodeStartupRuntimeFenceActivateFailed:  {},
	safeCodeStartupKafkaCreateFailed:           {},
	safeCodeStartupStorageCreateFailed:         {},
	safeCodeStartupSessionLeaseAcquireFailed:   {},
	safeCodeStartupSessionSchemaValidateFailed: {},
	safeCodeStartupSessionRecoveryFailed:       {},
	safeCodeStartupSessionRevisionOpenFailed:   {},
	safeCodeStartupLegacySnapshotFailed:        {},
	safeCodeStartupLegacyCaptureFailed:         {},
	safeCodeStartupLegacyValidationFailed:      {},
	safeCodeStartupLegacyImportFailed:          {},
	safeCodeStartupHandoffHydrateFailed:        {},
	safeCodeStartupHandoffRollbackFailed:       {},
	safeCodeStartupHandoffScopeChanged:         {},
	safeCodeStartupSessionDeviceOpenFailed:     {},
	safeCodeStartupGRPCBridgeCreateFailed:      {},
	safeCodeWebhookIntegrationUnavailable:      {},
	safeCodeHandoffInputFailed:                 {},
	safeCodeHandoffSourceScopeFailed:           {},
	safeCodeHandoffSourceStateConflict:         {},
	safeCodeHandoffSourceCompatibilityFailed:   {},
	safeCodeHandoffSourceSnapshotFailed:        {},
	safeCodeHandoffProjectionConversionFailed:  {},
	safeCodeHandoffTargetScopeFailed:           {},
	safeCodeHandoffTargetImportFailed:          {},
	safeCodeHandoffTargetResyncGateFailed:      {},
	safeCodeHandoffTargetFinalizeFailed:        {},
	safeCodeHandoffCandidateOpenFailed:         {},
	safeCodeHandoffBootstrapFailed:             {},
	safeCodeHandoffReadinessFailed:             {},
	safeCodeHandoffPromotionFailed:             {},
	safeCodeHandoffUnknownFailed:               {},
	safeCodeHandoffRuntimeRollback:             {},
}

type safeOperationalError struct {
	code string
	err  error
}

func (e *safeOperationalError) Error() string { return e.code }
func (e *safeOperationalError) Unwrap() error { return e.err }

func wrapSafeOperationalError(code string, err error) error {
	if err == nil {
		return nil
	}
	var existing *safeOperationalError
	if errors.As(err, &existing) {
		return err
	}
	if _, allowed := safeOperationalCodes[code]; !allowed {
		return err
	}
	return &safeOperationalError{code: code, err: err}
}

func safeWhatsmeowHandoffErrorCode(err error) string {
	var categorized *safeOperationalError
	if errors.As(err, &categorized) {
		switch categorized.code {
		case safeCodeHandoffInputFailed,
			safeCodeHandoffSourceScopeFailed,
			safeCodeHandoffSourceStateConflict,
			safeCodeHandoffSourceCompatibilityFailed,
			safeCodeHandoffSourceSnapshotFailed,
			safeCodeHandoffProjectionConversionFailed,
			safeCodeHandoffTargetScopeFailed,
			safeCodeHandoffTargetImportFailed,
			safeCodeHandoffTargetResyncGateFailed,
			safeCodeHandoffTargetFinalizeFailed:
			return categorized.code
		}
	}
	return safeCodeHandoffUnknownFailed
}

func safeWhatsmeowHandoffRuntimeRollbackCode(reason string) string {
	switch reason {
	case "candidate_open_failed":
		return safeCodeHandoffCandidateOpenFailed
	case "bootstrap_connect_failed":
		return safeCodeHandoffBootstrapFailed
	case "readiness_validation_failed":
		return safeCodeHandoffReadinessFailed
	case "atomic_promotion_validation_failed":
		return safeCodeHandoffPromotionFailed
	default:
		return safeCodeHandoffRuntimeRollback
	}
}

// safeOperationalErrorCode deliberately never calls Error(). Database driver
// messages may contain endpoint or credential material and session/import
// errors may contain authentication data. Logs only need a stable operational
// category; the original error remains available to the caller.
func safeOperationalErrorCode(err error) string {
	switch {
	case err == nil:
		return "none"
	case errors.Is(err, context.Canceled):
		return "context_canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline_exceeded"
	}
	var categorized *safeOperationalError
	if errors.As(err, &categorized) {
		if _, allowed := safeOperationalCodes[categorized.code]; allowed {
			return categorized.code
		}
	}
	var postgresError *pq.Error
	if errors.As(err, &postgresError) {
		if postgresError.Code == "XX000" && strings.HasPrefix(postgresError.Message, "unsupported jsonb version number") {
			return "postgres_jsonb_binary_encoding_invalid"
		}
		switch postgresError.Code {
		case "26000":
			return "postgres_invalid_statement"
		case "40001":
			return "postgres_serialization_failure"
		case "53300":
			return "postgres_connection_limit"
		case "57P01", "57P02", "57P03":
			return "postgres_shutdown"
		}
		switch postgresError.Code.Class() {
		case "08":
			return "postgres_connection_failure"
		case "22":
			return "postgres_parameter_invalid"
		}
	}
	return "operation_failed"
}

// SafeOperationalErrorCode exposes the sanitized classification to the worker
// entrypoint without allowing startup logs to serialize connection strings or
// session material carried by a driver error.
func SafeOperationalErrorCode(err error) string {
	return safeOperationalErrorCode(err)
}
