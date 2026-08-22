package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMediaDownloadDefaultsWhenEnvironmentIsAbsent(t *testing.T) {
	t.Setenv("MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS", "")
	t.Setenv("MEDIA_DOWNLOAD_MAX_BYTES", "")

	if got := resolveMediaDownloadRequestTimeout(); got != 45*time.Second {
		t.Fatalf("expected default timeout 45s, got %s", got)
	}
	if got := resolveMediaDownloadMaxBytes(); got != 128*1024*1024 {
		t.Fatalf("expected default maximum 128 MiB, got %d", got)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("media"))
	}))
	defer server.Close()

	body, contentType, _, err := downloadURL(context.Background(), server.URL+"/file.txt")
	if err != nil {
		t.Fatalf("download with default configuration failed: %v", err)
	}
	if string(body) != "media" || contentType != "text/plain" {
		t.Fatalf("unexpected download response body=%q content_type=%q", body, contentType)
	}
}

func TestMediaDownloadRejectsOversizedContentLengthBeforeReadingBody(t *testing.T) {
	t.Setenv("MEDIA_DOWNLOAD_MAX_BYTES", "4")
	bodyRead := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "5")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		select {
		case bodyRead <- struct{}{}:
		default:
		}
		<-r.Context().Done()
	}))
	defer server.Close()

	_, _, _, err := downloadURL(context.Background(), server.URL+"/oversized.bin")
	if !errors.Is(err, errMediaDownloadTooLarge) {
		t.Fatalf("expected oversized media error, got %v", err)
	}
	select {
	case <-bodyRead:
	case <-time.After(time.Second):
		t.Fatal("server did not receive media request")
	}
}

func TestMediaDownloadRejectsChunkedBodyThatCrossesLimit(t *testing.T) {
	t.Setenv("MEDIA_DOWNLOAD_MAX_BYTES", "4")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		_, _ = w.Write([]byte("12345"))
	}))
	defer server.Close()

	_, _, _, err := downloadURL(context.Background(), server.URL+"/chunked.bin")
	if !errors.Is(err, errMediaDownloadTooLarge) {
		t.Fatalf("expected chunked oversized media error, got %v", err)
	}
}

func TestMediaDownloadAppliesConfiguredRequestTimeout(t *testing.T) {
	t.Setenv("MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS", "20")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()

	startedAt := time.Now()
	_, _, _, err := downloadURL(context.Background(), server.URL+"/stalled.bin")
	if err == nil {
		t.Fatal("expected stalled media download to time out")
	}
	if !errors.Is(err, context.DeadlineExceeded) &&
		!strings.Contains(strings.ToLower(err.Error()), "deadline exceeded") {
		t.Fatalf("expected deadline error, got %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("download timeout took too long: %s", elapsed)
	}
	if isPermanentOutboundPreProviderFailure(err) {
		t.Fatalf("network timeout was classified as a permanent outbound failure: %v", err)
	}
}

func TestMediaDownloadHTTPFailureClassification(t *testing.T) {
	tests := []struct {
		name      string
		status    int
		permanent bool
	}{
		{name: "request_timeout", status: http.StatusRequestTimeout, permanent: false},
		{name: "too_early", status: http.StatusTooEarly, permanent: false},
		{name: "too_many_requests", status: http.StatusTooManyRequests, permanent: false},
		{name: "not_found", status: http.StatusNotFound, permanent: true},
		{name: "unauthorized", status: http.StatusUnauthorized, permanent: true},
		{name: "service_unavailable", status: http.StatusServiceUnavailable, permanent: false},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
			}))
			defer server.Close()

			_, _, _, err := downloadURL(context.Background(), server.URL+"/media")
			var httpErr *mediaDownloadHTTPError
			if !errors.As(err, &httpErr) {
				t.Fatalf("HTTP %d did not return typed download error: %v", test.status, err)
			}
			if httpErr.StatusCode != test.status {
				t.Fatalf("typed status=%d, want %d", httpErr.StatusCode, test.status)
			}
			if got := isPermanentOutboundPreProviderFailure(err); got != test.permanent {
				t.Fatalf("HTTP %d permanent=%t, want %t (error=%v)", test.status, got, test.permanent, err)
			}
		})
	}
}

func TestMediaDownloadInvalidURLAndOversizeArePermanent(t *testing.T) {
	_, _, _, invalidErr := downloadURL(context.Background(), "http://[::1")
	if !errors.Is(invalidErr, errMediaDownloadInvalidURL) {
		t.Fatalf("invalid URL did not preserve typed error: %v", invalidErr)
	}
	if !isPermanentOutboundPreProviderFailure(invalidErr) {
		t.Fatalf("invalid immutable URL was not classified as permanent: %v", invalidErr)
	}

	oversizeErr := fmt.Errorf("download image: %w", errMediaDownloadTooLarge)
	if !isPermanentOutboundPreProviderFailure(oversizeErr) {
		t.Fatalf("oversized immutable media was not classified as permanent: %v", oversizeErr)
	}
}
