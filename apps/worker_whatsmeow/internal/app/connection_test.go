package app

import (
	"errors"
	"testing"
)

func TestFreshLoginFallbackIsConsumedOnce(t *testing.T) {
	manager := &WhatsAppManager{}

	manager.armFreshLoginFallback(freshLoginRequest{Type: "phone", Phone: "5511999999999"})

	req, ok := manager.consumeFreshLoginFallback()
	if !ok {
		t.Fatal("expected fallback request")
	}
	if req.Type != "phone" || req.Phone != "5511999999999" {
		t.Fatalf("unexpected fallback request %#v", req)
	}

	if _, ok := manager.consumeFreshLoginFallback(); ok {
		t.Fatal("expected fallback request to be consumed only once")
	}
}

func TestStoredSessionInvalidErrorDetection(t *testing.T) {
	invalidErrors := []error{
		errors.New("logged out from another device"),
		errors.New("invalid use of deleted device"),
		errors.New("primary device was logged out"),
	}
	for _, err := range invalidErrors {
		if !isStoredSessionInvalidError(err) {
			t.Fatalf("expected invalid session error for %q", err)
		}
	}

	if isStoredSessionInvalidError(errors.New("dial tcp timeout")) {
		t.Fatal("network errors should not be treated as invalid session errors")
	}
}
