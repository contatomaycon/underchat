package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func TestSafeOperationalErrorCodeClassifiesPgBouncerProtocolFailures(t *testing.T) {
	tests := map[pq.ErrorCode]string{
		"26000": "postgres_invalid_statement",
		"08P01": "postgres_connection_failure",
		"22P02": "postgres_parameter_invalid",
		"40001": "postgres_serialization_failure",
	}
	for code, want := range tests {
		err := &pq.Error{Code: code, Message: "private database detail"}
		if got := safeOperationalErrorCode(err); got != want {
			t.Fatalf("SQLSTATE %s = %q, want %q", code, got, want)
		}
	}
}

func TestSafeOperationalErrorCodeClassifiesJSONBBinaryEncodingFailure(t *testing.T) {
	err := &pq.Error{
		Code:    "XX000",
		Message: "unsupported jsonb version number 123",
	}
	if got := safeOperationalErrorCode(err); got != "postgres_jsonb_binary_encoding_invalid" {
		t.Fatalf("JSONB binary encoding code = %q", got)
	}

	otherInternal := &pq.Error{Code: "XX000", Message: "private internal detail"}
	if got := safeOperationalErrorCode(otherInternal); got != "operation_failed" {
		t.Fatalf("unrelated internal error code = %q", got)
	}
}

type panicOnErrorString struct{}

func (panicOnErrorString) Error() string {
	panic("safeOperationalErrorCode called Error()")
}

func TestSafeOperationalErrorCodeNeverIncludesSensitiveErrorContent(t *testing.T) {
	sensitive := errors.New("postgres://worker:password@database/session capability=secret qr=credential")
	code := safeOperationalErrorCode(sensitive)
	if code != "operation_failed" {
		t.Fatalf("safeOperationalErrorCode() = %q", code)
	}
	for _, secret := range []string{"postgres", "password", "session", "capability", "qr"} {
		if strings.Contains(strings.ToLower(code), secret) {
			t.Fatalf("safeOperationalErrorCode() leaked %q in %q", secret, code)
		}
	}
}

func TestSafeOperationalErrorCodePreservesOnlySafeContextCategories(t *testing.T) {
	if got := safeOperationalErrorCode(context.Canceled); got != "context_canceled" {
		t.Fatalf("canceled code = %q", got)
	}
	if got := safeOperationalErrorCode(context.DeadlineExceeded); got != "deadline_exceeded" {
		t.Fatalf("deadline code = %q", got)
	}
}

func TestSafeOperationalErrorCodePreservesWhitelistedStartupBoundary(t *testing.T) {
	sensitive := panicOnErrorString{}
	err := wrapSafeOperationalError(safeCodeStartupHandoffHydrateFailed, sensitive)
	if got := safeOperationalErrorCode(err); got != safeCodeStartupHandoffHydrateFailed {
		t.Fatalf("startup boundary code = %q", got)
	}
	if got := err.Error(); got != safeCodeStartupHandoffHydrateFailed {
		t.Fatalf("startup boundary Error() = %q", got)
	}
	if got := safeOperationalErrorCode(errors.New("startup_handoff_hydrate_failed: secret")); got != "operation_failed" {
		t.Fatalf("untyped error code = %q", got)
	}
}

func TestSafeOperationalErrorCodeRejectsUnknownBoundary(t *testing.T) {
	err := wrapSafeOperationalError("postgres://secret", errors.New("password"))
	if got := safeOperationalErrorCode(err); got != "operation_failed" {
		t.Fatalf("unknown boundary code = %q", got)
	}
}

func TestSafeWhatsmeowHandoffErrorCodeKeepsOnlyTypedStage(t *testing.T) {
	sensitive := errors.New("postgres://worker:password@database/session-key")
	err := wrapSafeOperationalError(
		safeCodeHandoffSourceCompatibilityFailed,
		sensitive,
	)
	if got := safeWhatsmeowHandoffErrorCode(err); got != safeCodeHandoffSourceCompatibilityFailed {
		t.Fatalf("handoff stage code = %q", got)
	}
	if got := safeWhatsmeowHandoffErrorCode(sensitive); got != safeCodeHandoffUnknownFailed {
		t.Fatalf("uncategorized handoff code = %q", got)
	}
}

func TestSafeWhatsmeowHandoffErrorCodePreservesResyncGateStage(t *testing.T) {
	err := wrapSafeOperationalError(
		safeCodeHandoffTargetResyncGateFailed,
		errors.New("driver detail must remain private"),
	)
	if got := safeWhatsmeowHandoffErrorCode(err); got != safeCodeHandoffTargetResyncGateFailed {
		t.Fatalf("resync gate stage code = %q", got)
	}
}

func TestSafeOperationalErrorWrappingPreservesInnerSpecificCategory(t *testing.T) {
	inner := wrapSafeOperationalError(
		safeCodeHandoffSourceStateConflict,
		errors.New("private source state"),
	)
	outer := wrapSafeOperationalError(safeCodeHandoffSourceSnapshotFailed, inner)
	if got := safeOperationalErrorCode(outer); got != safeCodeHandoffSourceStateConflict {
		t.Fatalf("nested category = %q, want %q", got, safeCodeHandoffSourceStateConflict)
	}
}

func TestSafeWhatsmeowHandoffRuntimeRollbackCodeCategorizesKnownBoundaries(t *testing.T) {
	tests := map[string]string{
		"candidate_open_failed":              safeCodeHandoffCandidateOpenFailed,
		"bootstrap_connect_failed":           safeCodeHandoffBootstrapFailed,
		"readiness_validation_failed":        safeCodeHandoffReadinessFailed,
		"atomic_promotion_validation_failed": safeCodeHandoffPromotionFailed,
		"fresh_login_qrcode":                 safeCodeHandoffRuntimeRollback,
	}
	for reason, want := range tests {
		if got := safeWhatsmeowHandoffRuntimeRollbackCode(reason); got != want {
			t.Fatalf("rollback reason %q code = %q, want %q", reason, got, want)
		}
	}
}
