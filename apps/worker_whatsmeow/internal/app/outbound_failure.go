package app

import "errors"

// terminalizeOutboundProviderFailure keeps pre-provider failures and
// post-boundary ambiguity mutually exclusive. Once provider_invoked is
// durable, the same operation ID must never execute a "not sent" side effect
// or become eligible for another provider call.
func terminalizeOutboundProviderFailure(
	providerInvoked bool,
	onPreProviderFailure func() error,
	onAmbiguousFailure func() error,
) error {
	if providerInvoked {
		if onAmbiguousFailure == nil {
			return errors.New("ambiguous outbound failure handler is required")
		}
		return onAmbiguousFailure()
	}

	if onPreProviderFailure == nil {
		return errors.New("pre-provider outbound failure handler is required")
	}
	return onPreProviderFailure()
}
