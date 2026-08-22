package app

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
)

func unsetEnvironmentForTest(t *testing.T, key string) {
	t.Helper()
	value, existed := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("unset %s: %v", key, err)
	}
	t.Cleanup(func() {
		if existed {
			_ = os.Setenv(key, value)
			return
		}
		_ = os.Unsetenv(key)
	})
}

func assertDirectoryEmpty(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read temporary media directory: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("temporary media files were not cleaned up: %v", entries)
	}
}

func TestIncomingMediaDownloadDefaultsWithoutEnvironmentAndCleansUp(t *testing.T) {
	unsetEnvironmentForTest(t, "MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS")
	unsetEnvironmentForTest(t, "MEDIA_DOWNLOAD_MAX_BYTES")
	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)

	client := &whatsmeow.Client{}
	manager := &WhatsAppManager{
		cfg:    Config{WorkerID: "worker-media-defaults"},
		client: client,
	}
	data, err := downloadIncomingMediaWithInvoker(
		context.Background(),
		manager,
		client,
		"inbound_media_download:defaults",
		func(ctx context.Context, file whatsmeow.File) error {
			deadline, ok := ctx.Deadline()
			if !ok {
				return errors.New("media provider context has no deadline")
			}
			remaining := time.Until(deadline)
			if remaining < 40*time.Second || remaining > 46*time.Second {
				return errors.New("media provider context did not use the default deadline")
			}
			_, writeErr := file.Write([]byte("media"))
			return writeErr
		},
	)
	if err != nil {
		t.Fatalf("download with absent optional environment failed: %v", err)
	}
	if string(data) != "media" {
		t.Fatalf("unexpected downloaded media %q", data)
	}
	assertDirectoryEmpty(t, tempDir)
}

func TestIncomingMediaDownloadRejectsEveryFileGrowthBeyondLimit(t *testing.T) {
	t.Setenv("MEDIA_DOWNLOAD_MAX_BYTES", "4")
	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)

	tests := []struct {
		name   string
		invoke incomingMediaDownloadInvoker
	}{
		{
			name: "write",
			invoke: func(_ context.Context, file whatsmeow.File) error {
				_, err := file.Write([]byte("12345"))
				return err
			},
		},
		{
			name: "write_at",
			invoke: func(_ context.Context, file whatsmeow.File) error {
				_, err := file.WriteAt([]byte("5"), 4)
				return err
			},
		},
		{
			name: "truncate",
			invoke: func(_ context.Context, file whatsmeow.File) error {
				return file.Truncate(5)
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := &whatsmeow.Client{}
			manager := &WhatsAppManager{
				cfg:    Config{WorkerID: "worker-media-limit-" + test.name},
				client: client,
			}
			_, err := downloadIncomingMediaWithInvoker(
				context.Background(),
				manager,
				client,
				"inbound_media_download:limit:"+test.name,
				test.invoke,
			)
			if !errors.Is(err, errMediaDownloadTooLarge) {
				t.Fatalf("expected media size limit error, got %v", err)
			}
			assertDirectoryEmpty(t, tempDir)
		})
	}
}

func TestIncomingMediaDownloadTimeoutReturnsCleansUpAndFencesClient(t *testing.T) {
	t.Setenv("MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS", "20")
	t.Setenv("MEDIA_DOWNLOAD_MAX_BYTES", "64")
	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)

	client := &whatsmeow.Client{}
	manager := &WhatsAppManager{
		cfg:    Config{WorkerID: "worker-media-timeout"},
		client: client,
	}
	started := make(chan struct{})
	release := make(chan struct{})
	lateWrite := make(chan error, 1)

	startedAt := time.Now()
	_, err := downloadIncomingMediaWithInvoker(
		context.Background(),
		manager,
		client,
		"inbound_media_download:timeout",
		func(_ context.Context, file whatsmeow.File) error {
			close(started)
			<-release // Deliberately ignores the provider context.
			_, writeErr := file.Write([]byte("late"))
			lateWrite <- writeErr
			return writeErr
		},
	)
	if !errors.Is(err, errOutboundProviderCallStalled) {
		t.Fatalf("expected bounded provider timeout, got %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("media handler remained blocked for %s", elapsed)
	}
	select {
	case <-started:
	default:
		t.Fatal("media provider invocation was not started")
	}
	if !manager.isProviderClientStalled(client) {
		t.Fatal("context-ignoring media client was not quarantined")
	}
	assertDirectoryEmpty(t, tempDir)

	close(release)
	select {
	case writeErr := <-lateWrite:
		if writeErr == nil {
			t.Fatal("late provider invocation wrote to the cleaned temporary file")
		}
	case <-time.After(time.Second):
		t.Fatal("late media provider invocation was not observed")
	}
	assertDirectoryEmpty(t, tempDir)
}

func TestIncomingMediaGateBoundsConcurrentDownloadsAndRecovers(t *testing.T) {
	manager := &WhatsAppManager{
		cfg: Config{WorkerID: "worker-media-gate"},
	}
	releases := make([]func(), 0, maxConcurrentIncomingMediaDownloads)
	for range maxConcurrentIncomingMediaDownloads {
		release, err := manager.acquireIncomingMediaDownload(
			context.Background(),
		)
		if err != nil {
			t.Fatalf("acquire media slot: %v", err)
		}
		releases = append(releases, release)
	}

	waitCtx, cancelWait := context.WithTimeout(
		context.Background(),
		20*time.Millisecond,
	)
	defer cancelWait()
	if _, err := manager.acquireIncomingMediaDownload(waitCtx); !errors.Is(
		err,
		context.DeadlineExceeded,
	) {
		t.Fatalf("concurrency gate admitted an unbounded download: %v", err)
	}

	releases[0]()
	releaseRecovered, err := manager.acquireIncomingMediaDownload(
		context.Background(),
	)
	if err != nil {
		t.Fatalf("media gate did not recover after release: %v", err)
	}
	releaseRecovered()
	for _, release := range releases[1:] {
		release()
	}
}
