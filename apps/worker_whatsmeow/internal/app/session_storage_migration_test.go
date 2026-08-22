package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lib/pq"
)

func TestSnapshotLegacyVolumeIsDeterministicAndByteSensitive(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "z.db"), []byte("z"), 0o600); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(root, "nested", "a.db")
	if err := os.WriteFile(nested, []byte("one"), 0o600); err != nil {
		t.Fatal(err)
	}
	first, err := snapshotLegacyVolume(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := snapshotLegacyVolume(root)
	if err != nil {
		t.Fatal(err)
	}
	if first != second || first.Files != 2 || len(first.Checksum) != 64 {
		t.Fatalf("unexpected deterministic proof: first=%+v second=%+v", first, second)
	}
	if err := os.WriteFile(nested, []byte("two"), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, err := snapshotLegacyVolume(root)
	if err != nil {
		t.Fatal(err)
	}
	if changed.Checksum == first.Checksum {
		t.Fatal("snapshot checksum did not change with session bytes")
	}
}

func TestSnapshotLegacyVolumeRejectsSymlinks(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "store.db")
	if err := os.WriteFile(target, []byte("session"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "store-link.db")); err != nil {
		t.Fatal(err)
	}
	if _, err := snapshotLegacyVolume(root); err == nil || err.Error() != "legacy_session_snapshot_symlink_forbidden" {
		t.Fatalf("expected symlink rejection, got %v", err)
	}
}

func TestRunLegacyVolumeImportRetriesSerializableTransaction(t *testing.T) {
	attempts := 0
	err := runLegacyVolumeImportWithRetry(context.Background(), func(int) time.Duration {
		return 0
	}, func() error {
		attempts++
		if attempts < legacyVolumeImportMaxAttempts {
			return &pq.Error{Code: "40001", Message: "private database detail"}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if attempts != legacyVolumeImportMaxAttempts {
		t.Fatalf("attempts = %d, want %d", attempts, legacyVolumeImportMaxAttempts)
	}
}

func TestRunLegacyVolumeImportDoesNotRetryPermanentFailure(t *testing.T) {
	attempts := 0
	want := errors.New("permanent import failure")
	err := runLegacyVolumeImportWithRetry(context.Background(), func(int) time.Duration {
		return 0
	}, func() error {
		attempts++
		return want
	})
	if !errors.Is(err, want) {
		t.Fatalf("error = %v, want permanent failure", err)
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
}

func TestLegacyVolumeBootstrapSafeStageSurvivesOuterBoundary(t *testing.T) {
	inner := wrapSafeOperationalError(safeCodeStartupLegacyCaptureFailed, errors.New("private session detail"))
	outer := wrapSafeOperationalError(safeCodeStartupSessionRevisionOpenFailed, inner)
	if got := safeOperationalErrorCode(outer); got != safeCodeStartupLegacyCaptureFailed {
		t.Fatalf("safe stage = %q, want %q", got, safeCodeStartupLegacyCaptureFailed)
	}
}
