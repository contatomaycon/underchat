package app

import (
	"errors"
	"testing"
)

func TestIntegrationWebhookEntitlementFailureIsTerminalForCentralIngress(t *testing.T) {
	t.Parallel()

	cause := errors.New("redis unavailable")
	err := terminalKafkaHandlerError(wrapSafeOperationalError(safeCodeWebhookIntegrationUnavailable, cause))
	if !shouldCommitTerminalKafkaHandlerError(err) {
		t.Fatalf("entitlement failure must be terminal for central ingress: %v", err)
	}
	classified := nonTerminalKafkaHandlerCause(err)
	if got := safeOperationalErrorCode(classified); got != safeCodeWebhookIntegrationUnavailable {
		t.Fatalf("failure code = %q, want %q", got, safeCodeWebhookIntegrationUnavailable)
	}
}

func TestOrdinaryKafkaHandlerErrorDoesNotRequestGenerationRestart(t *testing.T) {
	t.Parallel()

	if shouldRestartKafkaGenerationWithoutCommit(errors.New("ordinary handler failure")) {
		t.Fatal("ordinary handler errors must retain the existing terminal behavior")
	}
}
