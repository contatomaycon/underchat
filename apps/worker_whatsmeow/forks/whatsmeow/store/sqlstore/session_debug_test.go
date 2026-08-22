package sqlstore

import (
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func TestOperationGuardDebugIsAggregatedAndSanitized(t *testing.T) {
	container := &Container{log: waLog.Noop}
	var lines []string
	container.SetSessionDebugOutput(func(line string) { lines = append(lines, line) })
	scope := SessionScope{SessionID: uuid.NewString(), RevisionID: 41}
	fence := OperationFence{FencingToken: 9, Generation: 7}

	for index := 0; index < 100; index++ {
		container.recordSessionOperation(scope, fence, time.Millisecond, 2*time.Millisecond, nil)
	}
	if len(lines) != 1 || !strings.Contains(lines[0], "operation_guard_active") {
		t.Fatalf("hot-path operations were not aggregated: %#v", lines)
	}
	if strings.Contains(strings.Join(lines, "\n"), "operation_complete") {
		t.Fatal("per-transaction completion log remained enabled")
	}

	container.operationDebugMu.Lock()
	container.operationDebug[scope].windowStarted = time.Now().Add(-time.Minute)
	container.operationDebugMu.Unlock()
	container.recordSessionOperation(scope, fence, time.Millisecond, 3*time.Millisecond, nil)
	if !strings.Contains(strings.Join(lines, "\n"), "operation_guard_summary") ||
		!strings.Contains(strings.Join(lines, "\n"), `"operation_count":101`) {
		t.Fatalf("operation summary was not emitted: %#v", lines)
	}

	container.recordSessionOperation(
		scope,
		fence,
		time.Millisecond,
		4*time.Millisecond,
		errors.New("postgresql://user:password@database.invalid secret-error"),
	)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "operation_failed") {
		t.Fatalf("failed operation was not visible: %s", joined)
	}
	for _, forbidden := range []string{"user:password", "secret-error"} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("failed operation leaked %q: %s", forbidden, joined)
		}
	}
}

func TestOperationGuardDebugClassifiesMissingProtocolRowsAsExpectedMisses(t *testing.T) {
	container := &Container{log: waLog.Noop}
	var lines []string
	container.SetSessionDebugOutput(func(line string) { lines = append(lines, line) })
	scope := SessionScope{SessionID: uuid.NewString(), RevisionID: 42}
	fence := OperationFence{FencingToken: 10, Generation: 8}

	container.recordSessionOperation(scope, fence, time.Millisecond, 2*time.Millisecond, sql.ErrNoRows)
	container.operationDebugMu.Lock()
	container.operationDebug[scope].windowStarted = time.Now().Add(-time.Minute)
	container.operationDebugMu.Unlock()
	container.recordSessionOperation(scope, fence, time.Millisecond, 2*time.Millisecond, nil)

	joined := strings.Join(lines, "\n")
	if strings.Contains(joined, `"event":"operation_failed"`) {
		t.Fatalf("expected protocol row miss was logged as a failure: %s", joined)
	}
	if !strings.Contains(joined, `"not_found_count":1`) ||
		!strings.Contains(joined, `"error_count":0`) {
		t.Fatalf("expected protocol row miss was not aggregated separately: %s", joined)
	}
}

func TestOperationGuardDebugKeepsFenceFailuresVisible(t *testing.T) {
	tests := map[string]error{
		"fence unavailable": ErrOperationFenceUnavailable,
		"guard rejected":    ErrOperationGuardRejected,
	}
	for name, operationErr := range tests {
		t.Run(name, func(t *testing.T) {
			container := &Container{log: waLog.Noop}
			var lines []string
			container.SetSessionDebugOutput(func(line string) { lines = append(lines, line) })
			scope := SessionScope{SessionID: uuid.NewString(), RevisionID: 43}
			fence := OperationFence{FencingToken: 11, Generation: 9}

			container.recordSessionOperation(scope, fence, time.Millisecond, 2*time.Millisecond, operationErr)
			container.operationDebugMu.Lock()
			container.operationDebug[scope].windowStarted = time.Now().Add(-time.Minute)
			container.operationDebugMu.Unlock()
			container.recordSessionOperation(scope, fence, time.Millisecond, 2*time.Millisecond, nil)

			joined := strings.Join(lines, "\n")
			if !strings.Contains(joined, `"event":"operation_failed"`) {
				t.Fatalf("fence failure was not logged immediately: %s", joined)
			}
			if !strings.Contains(joined, `"error_count":1`) ||
				!strings.Contains(joined, `"not_found_count":0`) {
				t.Fatalf("fence failure was not included in the error aggregate: %s", joined)
			}
		})
	}
}
