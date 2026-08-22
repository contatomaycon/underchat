package app

import (
	"errors"
	"testing"
)

func TestTerminalizeOutboundProviderFailureKeepsAmbiguousSendTerminal(t *testing.T) {
	preProviderCalls := 0
	ambiguousCalls := 0

	err := terminalizeOutboundProviderFailure(
		true,
		func() error {
			preProviderCalls++
			return errors.New("must not mark not-sent")
		},
		func() error {
			ambiguousCalls++
			return nil
		},
	)
	if err != nil {
		t.Fatalf("terminalize ambiguous failure: %v", err)
	}
	if preProviderCalls != 0 {
		t.Fatalf("ambiguous provider call ran %d pre-provider side effects", preProviderCalls)
	}
	if ambiguousCalls != 1 {
		t.Fatalf("ambiguous provider call terminalized %d times", ambiguousCalls)
	}
}

func TestTerminalizeOutboundProviderFailureAllowsProvenPreProviderFailure(t *testing.T) {
	preProviderCalls := 0
	ambiguousCalls := 0

	err := terminalizeOutboundProviderFailure(
		false,
		func() error {
			preProviderCalls++
			return nil
		},
		func() error {
			ambiguousCalls++
			return errors.New("must not mark ambiguous")
		},
	)
	if err != nil {
		t.Fatalf("terminalize pre-provider failure: %v", err)
	}
	if preProviderCalls != 1 {
		t.Fatalf("pre-provider failure terminalized %d times", preProviderCalls)
	}
	if ambiguousCalls != 0 {
		t.Fatalf("pre-provider failure ran %d ambiguous side effects", ambiguousCalls)
	}
}
