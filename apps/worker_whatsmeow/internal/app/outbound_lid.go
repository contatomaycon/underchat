package app

import (
	"context"
	"errors"
	"fmt"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

var (
	errOutboundTargetNotRegistered  = errors.New("WhatsApp target phone is not registered")
	errOutboundTargetInvalid        = errors.New("WhatsApp target phone is invalid")
	errOutboundTargetLIDUnavailable = errors.New("WhatsApp target LID is unavailable")
)

type outboundLIDCacheLookup func(context.Context, types.JID) (types.JID, error)

type outboundPNCacheLookup func(context.Context, types.JID) (types.JID, error)

type outboundPhoneRegistrationLookup func(context.Context, string) ([]types.IsOnWhatsAppResponse, error)

type outboundSendTargetResolution struct {
	providerTarget types.JID
	recipientPN    types.JID
}

func (m *WhatsAppManager) resolveOutboundSendTarget(
	ctx context.Context,
	client *whatsmeow.Client,
	target types.JID,
	authorize providerAuthorizationGuard,
) (outboundSendTargetResolution, error) {
	if target.Server != types.DefaultUserServer {
		return outboundSendTargetResolution{providerTarget: target}, nil
	}
	if client == nil || client.Store == nil || client.Store.LIDs == nil {
		return outboundSendTargetResolution{}, fmt.Errorf(
			"%w: LID store is not initialized",
			errOutboundTargetLIDUnavailable,
		)
	}
	return resolveOutboundPNToLIDTarget(
		ctx,
		target,
		client.Store.LIDs.GetLIDForPN,
		client.Store.LIDs.GetPNForLID,
		func(lookupCtx context.Context, phone string) ([]types.IsOnWhatsAppResponse, error) {
			return invokeProviderAuthorizedCall(
				lookupCtx,
				authorize,
				func(invokeCtx context.Context) ([]types.IsOnWhatsAppResponse, error) {
					return client.IsOnWhatsApp(invokeCtx, []string{phone})
				},
			)
		},
	)
}

func resolveOutboundPNToLIDTarget(
	ctx context.Context,
	target types.JID,
	lookupCachedLID outboundLIDCacheLookup,
	lookupCachedPN outboundPNCacheLookup,
	lookupRegistered outboundPhoneRegistrationLookup,
) (outboundSendTargetResolution, error) {
	if target.Server != types.DefaultUserServer {
		return outboundSendTargetResolution{providerTarget: target}, nil
	}
	pn := target.ToNonAD()
	if !isValidNonADNumericJID(pn, types.DefaultUserServer) {
		return outboundSendTargetResolution{}, fmt.Errorf("%w: invalid PN %q", errOutboundTargetInvalid, pn.User)
	}
	if lookupCachedLID == nil || lookupCachedPN == nil {
		return outboundSendTargetResolution{}, fmt.Errorf(
			"%w: bidirectional cache lookup is required",
			errOutboundTargetLIDUnavailable,
		)
	}
	cached, err := lookupCachedLID(ctx, pn)
	if err != nil {
		return outboundSendTargetResolution{}, fmt.Errorf(
			"%w: read mapping for %s: %w",
			errOutboundTargetLIDUnavailable,
			pn,
			err,
		)
	}
	if !cached.IsEmpty() {
		lid, mappingErr := validateOutboundLIDMapping(ctx, pn, cached, lookupCachedPN)
		if mappingErr != nil {
			return outboundSendTargetResolution{}, mappingErr
		}
		return outboundSendTargetResolution{
			providerTarget: lid,
			recipientPN:    pn,
		}, nil
	}
	if lookupRegistered == nil {
		return outboundSendTargetResolution{}, fmt.Errorf(
			"%w: registration lookup is required for %s",
			errOutboundTargetLIDUnavailable,
			pn,
		)
	}

	responses, err := lookupRegistered(ctx, "+"+pn.User)
	if err != nil {
		return outboundSendTargetResolution{}, fmt.Errorf(
			"%w: resolve WhatsApp LID for %s: %w",
			errOutboundTargetLIDUnavailable,
			pn,
			err,
		)
	}
	response, found, err := selectExactOutboundPNResponse(pn, responses)
	if err != nil {
		return outboundSendTargetResolution{}, err
	}
	if !found {
		return outboundSendTargetResolution{}, fmt.Errorf(
			"%w: provider returned no exact query result for %s",
			errOutboundTargetLIDUnavailable,
			pn,
		)
	}
	if !response.IsIn {
		return outboundSendTargetResolution{}, fmt.Errorf("%w: %s", errOutboundTargetNotRegistered, pn)
	}

	canonicalPN, err := validateOutboundCanonicalPN(pn, response.PhoneNumber)
	if err != nil {
		return outboundSendTargetResolution{}, err
	}
	responseLID, err := validateOutboundLID(canonicalPN, response.JID)
	if err != nil {
		return outboundSendTargetResolution{}, err
	}

	// IsOnWhatsApp persists PN↔LID mappings before it returns. Re-reading the
	// authoritative canonical PN verifies that direct LID sending can recover
	// the provider-returned PN without making another provider lookup after the
	// durable provider_invoked transition. The requested PN is deliberately not
	// mutated or retried as a manually guessed phone-number variant.
	mapped, err := lookupCachedLID(ctx, canonicalPN)
	if err != nil {
		return outboundSendTargetResolution{}, fmt.Errorf(
			"%w: verify mapping for canonical PN %s: %w",
			errOutboundTargetLIDUnavailable,
			canonicalPN,
			err,
		)
	}
	if mapped.IsEmpty() {
		return outboundSendTargetResolution{}, fmt.Errorf(
			"%w: provider registered %s as %s without a persisted LID",
			errOutboundTargetLIDUnavailable,
			pn,
			canonicalPN,
		)
	}
	mapped, err = validateOutboundLIDMapping(ctx, canonicalPN, mapped, lookupCachedPN)
	if err != nil {
		return outboundSendTargetResolution{}, err
	}

	if mapped != responseLID {
		return outboundSendTargetResolution{}, fmt.Errorf(
			"%w: provider/cache mismatch for %s (canonical=%s provider=%s cache=%s)",
			errOutboundTargetLIDUnavailable,
			pn,
			canonicalPN,
			responseLID,
			mapped,
		)
	}
	return outboundSendTargetResolution{
		providerTarget: mapped,
		recipientPN:    canonicalPN,
	}, nil
}

func validateOutboundLIDMapping(
	ctx context.Context,
	pn types.JID,
	lid types.JID,
	lookupCachedPN outboundPNCacheLookup,
) (types.JID, error) {
	lid, err := validateOutboundLID(pn, lid)
	if err != nil {
		return types.EmptyJID, err
	}
	reversePN, err := lookupCachedPN(ctx, lid)
	if err != nil {
		return types.EmptyJID, fmt.Errorf(
			"%w: verify reverse mapping for %s: %w",
			errOutboundTargetLIDUnavailable,
			lid,
			err,
		)
	}
	if !isValidNonADNumericJID(reversePN, types.DefaultUserServer) || reversePN.User != pn.User {
		return types.EmptyJID, fmt.Errorf(
			"%w: reverse mapping mismatch for %s (expected=%s got=%s)",
			errOutboundTargetLIDUnavailable,
			lid,
			pn,
			reversePN,
		)
	}
	return lid, nil
}

func validateOutboundLID(pn, lid types.JID) (types.JID, error) {
	if !isValidNonADNumericJID(lid, types.HiddenUserServer) {
		return types.EmptyJID, fmt.Errorf(
			"%w: invalid mapping for %s (got %s)",
			errOutboundTargetLIDUnavailable,
			pn,
			lid,
		)
	}
	return lid, nil
}

func validateOutboundCanonicalPN(requested, canonical types.JID) (types.JID, error) {
	if !isValidNonADNumericJID(canonical, types.DefaultUserServer) {
		return types.EmptyJID, fmt.Errorf(
			"%w: provider returned invalid canonical PN for %s (got %s)",
			errOutboundTargetLIDUnavailable,
			requested,
			canonical,
		)
	}
	if canonical.User != requested.User &&
		!isBrazilMobileNinthDigitAlias(requested.User, canonical.User) {
		return types.EmptyJID, fmt.Errorf(
			"%w: provider returned an unauthorized PN alias for %s (got %s)",
			errOutboundTargetLIDUnavailable,
			requested,
			canonical,
		)
	}
	return canonical, nil
}

func isValidNonADNumericJID(jid types.JID, server string) bool {
	return jid.Server == server &&
		jid.User != "" &&
		jid.RawAgent == 0 &&
		jid.Device == 0 &&
		jid.Integrator == 0 &&
		digits(jid.User) == jid.User
}

func isBrazilMobileNinthDigitAlias(left, right string) bool {
	shorter, longer := left, right
	if len(shorter) > len(longer) {
		shorter, longer = longer, shorter
	}
	if len(shorter) != 12 || len(longer) != 13 ||
		shorter[:2] != "55" || longer[:2] != "55" ||
		shorter[2:4] != longer[2:4] ||
		!isBrazilAreaCode(shorter[2:4]) {
		return false
	}
	return longer[4] == '9' &&
		shorter[4] >= '6' && shorter[4] <= '9' &&
		shorter[4:] == longer[5:]
}

func isBrazilAreaCode(areaCode string) bool {
	switch areaCode {
	case "11", "12", "13", "14", "15", "16", "17", "18", "19",
		"21", "22", "24", "27", "28",
		"31", "32", "33", "34", "35", "37", "38",
		"41", "42", "43", "44", "45", "46", "47", "48", "49",
		"51", "53", "54", "55",
		"61", "62", "63", "64", "65", "66", "67", "68", "69",
		"71", "73", "74", "75", "77", "79",
		"81", "82", "83", "84", "85", "86", "87", "88", "89",
		"91", "92", "93", "94", "95", "96", "97", "98", "99":
		return true
	default:
		return false
	}
}

func selectExactOutboundPNResponse(
	pn types.JID,
	responses []types.IsOnWhatsAppResponse,
) (types.IsOnWhatsAppResponse, bool, error) {
	var selected types.IsOnWhatsAppResponse
	found := false
	for _, response := range responses {
		if !outboundPNQueryMatches(pn, response.Query) {
			continue
		}
		if found && !equivalentOutboundPNResponses(selected, response) {
			return types.IsOnWhatsAppResponse{}, false, fmt.Errorf(
				"%w: provider returned conflicting exact results for %s",
				errOutboundTargetLIDUnavailable,
				pn,
			)
		}
		selected = response
		found = true
	}
	return selected, found, nil
}

func outboundPNQueryMatches(pn types.JID, query string) bool {
	return query == pn.User || query == "+"+pn.User
}

func equivalentOutboundPNResponses(left, right types.IsOnWhatsAppResponse) bool {
	return left.IsIn == right.IsIn &&
		left.JID == right.JID &&
		left.PhoneNumber == right.PhoneNumber
}
