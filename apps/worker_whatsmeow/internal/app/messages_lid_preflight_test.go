package app

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"go.mau.fi/whatsmeow/types"
)

func TestResolveOutboundPNToLIDLeavesNonPNTargetsUntouched(t *testing.T) {
	targets := []types.JID{
		types.NewJID("12345", types.HiddenUserServer),
		types.NewJID("12345-678", types.GroupServer),
		types.StatusBroadcastJID,
	}
	for _, target := range targets {
		t.Run(target.String(), func(t *testing.T) {
			got, err := resolveOutboundPNToLID(
				context.Background(),
				target,
				func(context.Context, types.JID) (types.JID, error) {
					t.Fatal("non-PN target unexpectedly read the LID cache")
					return types.EmptyJID, nil
				},
				func(context.Context, types.JID) (types.JID, error) {
					t.Fatal("non-PN target unexpectedly read the reverse LID cache")
					return types.EmptyJID, nil
				},
				func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
					t.Fatal("non-PN target unexpectedly queried the provider")
					return nil, nil
				},
			)
			if err != nil {
				t.Fatalf("resolve non-PN target: %v", err)
			}
			if got != target {
				t.Fatalf("non-PN target changed: want %s got %s", target, got)
			}
		})
	}
}

func TestResolveOutboundPNToLIDUsesValidatedCachedMapping(t *testing.T) {
	pn := types.NewADJID("5561995999040", types.WhatsAppDomain, 4)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	cacheCalls := 0
	got, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(_ context.Context, lookupPN types.JID) (types.JID, error) {
			cacheCalls++
			if lookupPN != pn.ToNonAD() {
				t.Fatalf("cache lookup must use non-AD PN: want %s got %s", pn.ToNonAD(), lookupPN)
			}
			return lid, nil
		},
		func(_ context.Context, lookupLID types.JID) (types.JID, error) {
			if lookupLID != lid.ToNonAD() {
				t.Fatalf("reverse cache lookup must use non-AD LID: want %s got %s", lid.ToNonAD(), lookupLID)
			}
			return pn.ToNonAD(), nil
		},
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			t.Fatal("cached mapping unexpectedly queried the provider")
			return nil, nil
		},
	)
	if err != nil {
		t.Fatalf("resolve cached LID: %v", err)
	}
	if got != lid.ToNonAD() {
		t.Fatalf("resolved LID must be non-AD: want %s got %s", lid.ToNonAD(), got)
	}
	if cacheCalls != 1 {
		t.Fatalf("unexpected cache lookup count: %d", cacheCalls)
	}
}

func TestResolveOutboundPNToLIDRejectsMalformedPNAsBusinessError(t *testing.T) {
	_, err := resolveOutboundPNToLID(
		context.Background(),
		types.NewJID("+55-invalid", types.DefaultUserServer),
		func(context.Context, types.JID) (types.JID, error) {
			t.Fatal("invalid PN unexpectedly read the LID cache")
			return types.EmptyJID, nil
		},
		func(context.Context, types.JID) (types.JID, error) {
			t.Fatal("invalid PN unexpectedly read the reverse LID cache")
			return types.EmptyJID, nil
		},
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			t.Fatal("invalid PN unexpectedly queried the provider")
			return nil, nil
		},
	)
	if !errors.Is(err, errOutboundTargetInvalid) {
		t.Fatalf("malformed PN must be classified as invalid, got %v", err)
	}
	if errors.Is(err, errOutboundTargetLIDUnavailable) {
		t.Fatalf("malformed PN must not be classified as transient LID unavailability: %v", err)
	}
}

func TestResolveOutboundPNToLIDRejectsIntegratorPNAsBusinessError(t *testing.T) {
	target := types.JID{
		User:       "5561995999040",
		Server:     types.DefaultUserServer,
		Integrator: 1,
	}
	_, err := resolveOutboundPNToLID(
		context.Background(),
		target,
		func(context.Context, types.JID) (types.JID, error) {
			t.Fatal("integrator PN unexpectedly read the LID cache")
			return types.EmptyJID, nil
		},
		func(context.Context, types.JID) (types.JID, error) {
			t.Fatal("integrator PN unexpectedly read the reverse LID cache")
			return types.EmptyJID, nil
		},
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			t.Fatal("integrator PN unexpectedly queried the provider")
			return nil, nil
		},
	)
	if !errors.Is(err, errOutboundTargetInvalid) {
		t.Fatalf("integrator PN must be classified as invalid, got %v", err)
	}
}

func TestResolveOutboundPNToLIDQueriesExactPhoneAndVerifiesPersistedMapping(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	otherPN := types.NewJID("5511888888888", types.DefaultUserServer)
	otherLID := types.NewJID("999999999999999", types.HiddenUserServer)
	cacheCalls := 0
	providerCalls := 0

	got, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(_ context.Context, lookupPN types.JID) (types.JID, error) {
			cacheCalls++
			if lookupPN != pn {
				t.Fatalf("unexpected cache PN: %s", lookupPN)
			}
			if cacheCalls == 1 {
				return types.EmptyJID, nil
			}
			return lid, nil
		},
		reverseOutboundPNLookup(pn),
		func(_ context.Context, phone string) ([]types.IsOnWhatsAppResponse, error) {
			providerCalls++
			if phone != "+5561995999040" {
				t.Fatalf("provider lookup used unexpected phone: %q", phone)
			}
			return []types.IsOnWhatsAppResponse{
				{Query: otherPN.User, PhoneNumber: otherPN, JID: otherLID, IsIn: true},
				{Query: pn.User, PhoneNumber: pn, JID: lid, IsIn: true},
			}, nil
		},
	)
	if err != nil {
		t.Fatalf("resolve provider LID: %v", err)
	}
	if got != lid {
		t.Fatalf("unexpected resolved LID: want %s got %s", lid, got)
	}
	if cacheCalls != 2 || providerCalls != 1 {
		t.Fatalf("unexpected calls cache=%d provider=%d", cacheCalls, providerCalls)
	}
}

func TestResolveOutboundPNToLIDAcceptsAuthoritativeBrazilNinthDigitAliases(t *testing.T) {
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	tests := []struct {
		name        string
		requested   types.JID
		canonical   types.JID
		responseQry string
	}{
		{
			name:        "real provider removes ninth digit",
			requested:   types.NewJID("5561995999040", types.DefaultUserServer),
			canonical:   types.NewJID("556195999040", types.DefaultUserServer),
			responseQry: "5561995999040",
		},
		{
			name:        "provider authoritatively adds ninth digit",
			requested:   types.NewJID("556195999040", types.DefaultUserServer),
			canonical:   types.NewJID("5561995999040", types.DefaultUserServer),
			responseQry: "+556195999040",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var forwardLookups []types.JID
			providerCalls := 0
			resolved, err := resolveOutboundPNToLIDTarget(
				context.Background(),
				test.requested,
				func(_ context.Context, lookupPN types.JID) (types.JID, error) {
					forwardLookups = append(forwardLookups, lookupPN)
					switch len(forwardLookups) {
					case 1:
						if lookupPN != test.requested {
							t.Fatalf("first cache lookup must use the exact requested PN: got %s", lookupPN)
						}
						return types.EmptyJID, nil
					case 2:
						if lookupPN != test.canonical {
							t.Fatalf("mapping verification must use provider canonical PN: got %s", lookupPN)
						}
						return lid, nil
					default:
						t.Fatalf("unexpected forward lookup %d for %s", len(forwardLookups), lookupPN)
						return types.EmptyJID, nil
					}
				},
				func(_ context.Context, lookupLID types.JID) (types.JID, error) {
					if lookupLID != lid {
						t.Fatalf("unexpected reverse LID lookup: %s", lookupLID)
					}
					return test.canonical, nil
				},
				func(_ context.Context, phone string) ([]types.IsOnWhatsAppResponse, error) {
					providerCalls++
					if phone != "+"+test.requested.User {
						t.Fatalf("provider query was not the exact requested phone: %q", phone)
					}
					return []types.IsOnWhatsAppResponse{{
						Query:       test.responseQry,
						PhoneNumber: test.canonical,
						JID:         lid,
						IsIn:        true,
					}}, nil
				},
			)
			if err != nil {
				t.Fatalf("resolve authoritative alias: %v", err)
			}
			if resolved.providerTarget != lid {
				t.Fatalf("unexpected provider target: want %s got %s", lid, resolved.providerTarget)
			}
			if resolved.recipientPN != test.canonical {
				t.Fatalf("unexpected canonical recipient PN: want %s got %s", test.canonical, resolved.recipientPN)
			}
			if providerCalls != 1 || len(forwardLookups) != 2 {
				t.Fatalf("unexpected lookup counts provider=%d forward=%d", providerCalls, len(forwardLookups))
			}
			extra, extraErr := sendRequestExtraForProviderTarget(test.requested, resolved)
			if extraErr != nil {
				t.Fatalf("build canonical pre-resolved send options: %v", extraErr)
			}
			if extra.PreResolvedRecipientPN != test.canonical {
				t.Fatalf(
					"pre-resolved send must use canonical PN: want %s got %s",
					test.canonical,
					extra.PreResolvedRecipientPN,
				)
			}
		})
	}
}

func TestResolveOutboundPNToLIDRejectsUnprovenOrUnsafeAliases(t *testing.T) {
	requested := types.NewJID("5561995999040", types.DefaultUserServer)
	validLID := types.NewJID("123456789012345", types.HiddenUserServer)
	tests := []struct {
		name      string
		query     string
		canonical types.JID
		lid       types.JID
	}{
		{
			name:      "query absent",
			canonical: types.NewJID("556195999040", types.DefaultUserServer),
			lid:       validLID,
		},
		{
			name:      "query differs",
			query:     "556195999040",
			canonical: types.NewJID("556195999040", types.DefaultUserServer),
			lid:       validLID,
		},
		{
			name:      "query punctuation is not normalized",
			query:     "(55) 61 99599-9040",
			canonical: types.NewJID("556195999040", types.DefaultUserServer),
			lid:       validLID,
		},
		{
			name:      "non Brazil alias",
			query:     requested.User,
			canonical: types.NewJID("1561995999040", types.DefaultUserServer),
			lid:       validLID,
		},
		{
			name:      "different subscriber digit",
			query:     requested.User,
			canonical: types.NewJID("556195999041", types.DefaultUserServer),
			lid:       validLID,
		},
		{
			name:      "different area code",
			query:     requested.User,
			canonical: types.NewJID("556295999040", types.DefaultUserServer),
			lid:       validLID,
		},
		{
			name:      "removed digit is not ninth digit",
			query:     requested.User,
			canonical: types.NewJID("556199599040", types.DefaultUserServer),
			lid:       validLID,
		},
		{
			name:      "canonical PN is AD",
			query:     requested.User,
			canonical: types.NewADJID("556195999040", types.WhatsAppDomain, 2),
			lid:       validLID,
		},
		{
			name:  "canonical PN has an integrator",
			query: requested.User,
			canonical: types.JID{
				User:       "556195999040",
				Server:     types.DefaultUserServer,
				Integrator: 1,
			},
			lid: validLID,
		},
		{
			name:      "provider JID is not LID",
			query:     requested.User,
			canonical: types.NewJID("556195999040", types.DefaultUserServer),
			lid:       types.NewJID("556195999040", types.DefaultUserServer),
		},
		{
			name:      "provider LID is AD",
			query:     requested.User,
			canonical: types.NewJID("556195999040", types.DefaultUserServer),
			lid:       types.NewADJID("123456789012345", types.LIDDomain, 2),
		},
		{
			name:      "provider LID has an integrator",
			query:     requested.User,
			canonical: types.NewJID("556195999040", types.DefaultUserServer),
			lid: types.JID{
				User:       "123456789012345",
				Server:     types.HiddenUserServer,
				Integrator: 1,
			},
		},
		{
			name:      "provider LID is non numeric",
			query:     requested.User,
			canonical: types.NewJID("556195999040", types.DefaultUserServer),
			lid:       types.NewJID("not-a-lid", types.HiddenUserServer),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cacheCalls := 0
			providerCalls := 0
			_, err := resolveOutboundPNToLIDTarget(
				context.Background(),
				requested,
				func(context.Context, types.JID) (types.JID, error) {
					cacheCalls++
					return types.EmptyJID, nil
				},
				func(context.Context, types.JID) (types.JID, error) {
					t.Fatal("unsafe response unexpectedly reached reverse mapping verification")
					return types.EmptyJID, nil
				},
				func(_ context.Context, phone string) ([]types.IsOnWhatsAppResponse, error) {
					providerCalls++
					if phone != "+"+requested.User {
						t.Fatalf("unexpected provider query: %q", phone)
					}
					return []types.IsOnWhatsAppResponse{{
						Query:       test.query,
						PhoneNumber: test.canonical,
						JID:         test.lid,
						IsIn:        true,
					}}, nil
				},
			)
			if !errors.Is(err, errOutboundTargetLIDUnavailable) {
				t.Fatalf("unsafe alias response must fail closed, got %v", err)
			}
			if providerCalls != 1 || cacheCalls != 1 {
				t.Fatalf(
					"unsafe alias must not trigger guessed variants: provider=%d cache=%d",
					providerCalls,
					cacheCalls,
				)
			}
		})
	}
}

func TestResolveOutboundPNToLIDRejectsAliasStoreMismatches(t *testing.T) {
	requested := types.NewJID("5561995999040", types.DefaultUserServer)
	canonical := types.NewJID("556195999040", types.DefaultUserServer)
	providerLID := types.NewJID("123456789012345", types.HiddenUserServer)
	otherLID := types.NewJID("999999999999999", types.HiddenUserServer)
	tests := []struct {
		name      string
		forward   types.JID
		reverse   types.JID
		reverseAD bool
	}{
		{
			name:    "forward LID differs from provider",
			forward: otherLID,
			reverse: canonical,
		},
		{
			name: "forward LID has an integrator",
			forward: types.JID{
				User:       providerLID.User,
				Server:     providerLID.Server,
				Integrator: 1,
			},
			reverse: canonical,
		},
		{
			name:    "reverse PN differs from canonical",
			forward: providerLID,
			reverse: requested,
		},
		{
			name:      "reverse PN is AD",
			forward:   providerLID,
			reverse:   canonical,
			reverseAD: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cacheCalls := 0
			_, err := resolveOutboundPNToLIDTarget(
				context.Background(),
				requested,
				func(_ context.Context, lookupPN types.JID) (types.JID, error) {
					cacheCalls++
					if cacheCalls == 1 {
						if lookupPN != requested {
							t.Fatalf("initial cache lookup must use requested PN, got %s", lookupPN)
						}
						return types.EmptyJID, nil
					}
					if lookupPN != canonical {
						t.Fatalf("post-USync lookup must use canonical PN, got %s", lookupPN)
					}
					return test.forward, nil
				},
				func(context.Context, types.JID) (types.JID, error) {
					if test.reverseAD {
						return types.NewADJID(test.reverse.User, types.WhatsAppDomain, 3), nil
					}
					return test.reverse, nil
				},
				func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
					return []types.IsOnWhatsAppResponse{{
						Query:       requested.User,
						PhoneNumber: canonical,
						JID:         providerLID,
						IsIn:        true,
					}}, nil
				},
			)
			if !errors.Is(err, errOutboundTargetLIDUnavailable) {
				t.Fatalf("alias store mismatch must fail closed, got %v", err)
			}
			if cacheCalls != 2 {
				t.Fatalf("unexpected forward lookup count: %d", cacheCalls)
			}
		})
	}
}

func TestBrazilMobileNinthDigitAliasValidation(t *testing.T) {
	tests := []struct {
		name  string
		left  string
		right string
		want  bool
	}{
		{
			name:  "real remove ninth digit",
			left:  "5561995999040",
			right: "556195999040",
			want:  true,
		},
		{
			name:  "real add ninth digit",
			left:  "556195999040",
			right: "5561995999040",
			want:  true,
		},
		{
			name:  "non Brazil",
			left:  "141595552671",
			right: "14155552671",
		},
		{
			name:  "inserted digit is not nine",
			left:  "5561895999040",
			right: "556195999040",
		},
		{
			name:  "subscriber differs",
			left:  "5561995999040",
			right: "556195999041",
		},
		{
			name:  "area code differs",
			left:  "5561995999040",
			right: "556295999040",
		},
		{
			name:  "landline cannot gain mobile ninth digit",
			left:  "5561933334444",
			right: "556133334444",
		},
		{
			name:  "invalid area code",
			left:  "5500995999040",
			right: "550095999040",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isBrazilMobileNinthDigitAlias(test.left, test.right); got != test.want {
				t.Fatalf("unexpected alias result for %q and %q: want %t got %t", test.left, test.right, test.want, got)
			}
		})
	}
}

func TestResolveOutboundPNToLIDDoesNotTrustQueryWhenResponsePNConflicts(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	otherPN := types.NewJID("5511888888888", types.DefaultUserServer)
	_, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(context.Context, types.JID) (types.JID, error) {
			return types.EmptyJID, nil
		},
		reverseOutboundPNLookup(pn),
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			return []types.IsOnWhatsAppResponse{{
				Query:       pn.User,
				PhoneNumber: otherPN,
				JID:         types.NewJID("123456789012345", types.HiddenUserServer),
				IsIn:        true,
			}}, nil
		},
	)
	if !errors.Is(err, errOutboundTargetLIDUnavailable) {
		t.Fatalf("mismatched provider response must fail closed, got %v", err)
	}
}

func TestResolveOutboundPNToLIDRejectsUnregisteredPhone(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	_, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(context.Context, types.JID) (types.JID, error) {
			return types.EmptyJID, nil
		},
		reverseOutboundPNLookup(pn),
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			return []types.IsOnWhatsAppResponse{{
				Query:       pn.User,
				PhoneNumber: pn,
				JID:         pn,
				IsIn:        false,
			}}, nil
		},
	)
	if !errors.Is(err, errOutboundTargetNotRegistered) {
		t.Fatalf("expected not-registered error, got %v", err)
	}
}

func TestResolveOutboundPNToLIDRejectsRegisteredPhoneWithoutPersistedLID(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	cacheCalls := 0
	_, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(_ context.Context, lookupPN types.JID) (types.JID, error) {
			cacheCalls++
			return types.EmptyJID, nil
		},
		reverseOutboundPNLookup(pn),
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			return []types.IsOnWhatsAppResponse{{
				Query:       pn.User,
				PhoneNumber: pn,
				JID:         lid,
				IsIn:        true,
			}}, nil
		},
	)
	if !errors.Is(err, errOutboundTargetLIDUnavailable) {
		t.Fatalf("registered PN without persisted LID must fail closed, got %v", err)
	}
	if cacheCalls != 2 {
		t.Fatalf("mapping was not verified after provider lookup: calls=%d", cacheCalls)
	}
}

func TestResolveOutboundPNToLIDRejectsProviderCacheMismatch(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	providerLID := types.NewJID("123456789012345", types.HiddenUserServer)
	cachedLID := types.NewJID("999999999999999", types.HiddenUserServer)
	cacheCalls := 0
	_, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(context.Context, types.JID) (types.JID, error) {
			cacheCalls++
			if cacheCalls == 1 {
				return types.EmptyJID, nil
			}
			return cachedLID, nil
		},
		reverseOutboundPNLookup(pn),
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			return []types.IsOnWhatsAppResponse{{
				Query:       pn.User,
				PhoneNumber: pn,
				JID:         providerLID,
				IsIn:        true,
			}}, nil
		},
	)
	if !errors.Is(err, errOutboundTargetLIDUnavailable) {
		t.Fatalf("provider/cache mismatch must fail closed, got %v", err)
	}
}

func TestResolveOutboundPNToLIDRejectsReverseCacheMismatch(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	wrongPN := types.NewJID("5511888888888", types.DefaultUserServer)
	_, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(context.Context, types.JID) (types.JID, error) {
			return lid, nil
		},
		func(context.Context, types.JID) (types.JID, error) {
			return wrongPN, nil
		},
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			t.Fatal("corrupt cached mapping unexpectedly queried the provider")
			return nil, nil
		},
	)
	if !errors.Is(err, errOutboundTargetLIDUnavailable) {
		t.Fatalf("reverse cache mismatch must fail closed, got %v", err)
	}
}

func TestResolveOutboundPNToLIDRejectsConflictingExactResponses(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	_, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(context.Context, types.JID) (types.JID, error) {
			return types.EmptyJID, nil
		},
		reverseOutboundPNLookup(pn),
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			return []types.IsOnWhatsAppResponse{
				{Query: pn.User, PhoneNumber: pn, JID: pn, IsIn: false},
				{Query: pn.User, PhoneNumber: pn, JID: lid, IsIn: true},
			}, nil
		},
	)
	if !errors.Is(err, errOutboundTargetLIDUnavailable) {
		t.Fatalf("conflicting exact responses must fail closed, got %v", err)
	}
}

func TestResolveOutboundPNToLIDPreservesLookupErrors(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	cacheErr := context.Canceled
	_, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(context.Context, types.JID) (types.JID, error) {
			return types.EmptyJID, cacheErr
		},
		func(context.Context, types.JID) (types.JID, error) {
			t.Fatal("forward cache failure unexpectedly queried the reverse cache")
			return types.EmptyJID, nil
		},
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			t.Fatal("cache failure unexpectedly queried the provider")
			return nil, nil
		},
	)
	if !errors.Is(err, errOutboundTargetLIDUnavailable) {
		t.Fatalf("cache failure must be classified as unavailable, got %v", err)
	}
	if !errors.Is(err, cacheErr) {
		t.Fatalf("cache failure cause was not preserved, got %v", err)
	}
}

func TestResolveOutboundPNToLIDPreservesProviderAndReverseLookupCauses(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	providerErr := errors.New("provider authorization revoked")
	cacheCalls := 0
	_, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(context.Context, types.JID) (types.JID, error) {
			cacheCalls++
			return types.EmptyJID, nil
		},
		reverseOutboundPNLookup(pn),
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			return nil, providerErr
		},
	)
	if !errors.Is(err, errOutboundTargetLIDUnavailable) || !errors.Is(err, providerErr) {
		t.Fatalf("provider lookup classification/cause was not preserved, got %v", err)
	}
	if cacheCalls != 1 {
		t.Fatalf("provider failure unexpectedly re-read the cache: calls=%d", cacheCalls)
	}

	reverseErr := errors.New("reverse cache unavailable")
	_, err = resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(context.Context, types.JID) (types.JID, error) {
			return lid, nil
		},
		func(context.Context, types.JID) (types.JID, error) {
			return types.EmptyJID, reverseErr
		},
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			t.Fatal("cached mapping unexpectedly queried the provider")
			return nil, nil
		},
	)
	if !errors.Is(err, errOutboundTargetLIDUnavailable) || !errors.Is(err, reverseErr) {
		t.Fatalf("reverse cache error classification/cause was not preserved, got %v", err)
	}
}

func TestOutboundPNResolutionCompletesBeforeIrreversibleBoundary(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	canonicalPN := types.NewJID("556195999040", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	var order []string
	cacheCalls := 0
	resolved, err := resolveOutboundPNToLID(
		context.Background(),
		pn,
		func(_ context.Context, lookupPN types.JID) (types.JID, error) {
			cacheCalls++
			order = append(order, "cache")
			if cacheCalls == 1 {
				return types.EmptyJID, nil
			}
			if lookupPN != canonicalPN {
				t.Fatalf("post-USync lookup must use canonical PN: got %s", lookupPN)
			}
			return lid, nil
		},
		func(context.Context, types.JID) (types.JID, error) {
			order = append(order, "reverse_cache")
			return canonicalPN, nil
		},
		func(context.Context, string) ([]types.IsOnWhatsAppResponse, error) {
			order = append(order, "usync")
			return []types.IsOnWhatsAppResponse{{
				Query:       pn.User,
				PhoneNumber: canonicalPN,
				JID:         lid,
				IsIn:        true,
			}}, nil
		},
	)
	if err != nil {
		t.Fatalf("preflight resolve: %v", err)
	}
	_, err = invokeProviderCallAtBoundary(
		context.Background(),
		func(context.Context) error {
			order = append(order, "provider_invoked")
			return nil
		},
		func(context.Context) (struct{}, error) {
			order = append(order, "send")
			if resolved.Server != types.HiddenUserServer {
				t.Fatalf("provider send received unresolved target %s", resolved)
			}
			return struct{}{}, nil
		},
	)
	if err != nil {
		t.Fatalf("invoke provider: %v", err)
	}
	want := []string{"cache", "usync", "cache", "reverse_cache", "provider_invoked", "send"}
	if !reflect.DeepEqual(order, want) {
		t.Fatalf("unexpected preflight/boundary order: want %v got %v", want, order)
	}
}

func TestResolvedOutboundTargetPreservesLogicalPNReadIdentity(t *testing.T) {
	pn := types.NewJID("5561995999040", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	key := sentChatReadMessageKey(
		ChatMessage{MessageKey: &MessageKey{RemoteJID: pn.String()}},
		pn,
		"message-id",
	)
	if key.RemoteJID != pn.String() {
		t.Fatalf("logical message identity changed: want %s got %s", pn, key.RemoteJID)
	}
	candidates := chatReadJIDCandidates(key, lid)
	want := []types.JID{pn, lid}
	if !reflect.DeepEqual(candidates, want) {
		t.Fatalf("mark-read candidates must include logical PN and provider LID: want %v got %v", want, candidates)
	}
}

func TestSendRequestExtraUsesCanonicalPNForPreResolvedLID(t *testing.T) {
	logicalPN := types.NewJID("5561995999040", types.DefaultUserServer)
	canonicalPN := types.NewJID("556195999040", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)

	extra, err := sendRequestExtraForProviderTarget(logicalPN, outboundSendTargetResolution{
		providerTarget: lid,
		recipientPN:    canonicalPN,
	})
	if err != nil {
		t.Fatalf("build pre-resolved send options: %v", err)
	}
	if extra.PreResolvedRecipientPN != canonicalPN {
		t.Fatalf(
			"canonical PN was not used for the pre-resolved identity: want %s got %s",
			canonicalPN,
			extra.PreResolvedRecipientPN,
		)
	}
}

func TestSendRequestExtraDoesNotInventLogicalPN(t *testing.T) {
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	targets := map[string]struct {
		logical  types.JID
		provider types.JID
	}{
		"direct LID": {
			logical:  lid,
			provider: lid,
		},
		"group": {
			logical:  types.NewJID("12345-678", types.GroupServer),
			provider: types.NewJID("12345-678", types.GroupServer),
		},
	}
	for name, target := range targets {
		t.Run(name, func(t *testing.T) {
			extra, err := sendRequestExtraForProviderTarget(target.logical, outboundSendTargetResolution{
				providerTarget: target.provider,
			})
			if err != nil {
				t.Fatalf("non-PN target must preserve legacy send behavior: %v", err)
			}
			if !extra.PreResolvedRecipientPN.IsEmpty() {
				t.Fatalf("unexpected pre-resolved PN %s", extra.PreResolvedRecipientPN)
			}
		})
	}
}

func TestSendRequestExtraFailsClosedForInconsistentPNResolution(t *testing.T) {
	logicalPN := types.NewJID("5561995999040", types.DefaultUserServer)
	canonicalPN := types.NewJID("556195999040", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	tests := map[string]outboundSendTargetResolution{
		"unresolved provider target": {
			providerTarget: logicalPN,
			recipientPN:    logicalPN,
		},
		"missing canonical PN": {
			providerTarget: lid,
		},
		"unrelated canonical PN": {
			providerTarget: lid,
			recipientPN:    types.NewJID("5511888888888", types.DefaultUserServer),
		},
		"integrator LID": {
			providerTarget: types.JID{
				User:       lid.User,
				Server:     lid.Server,
				Integrator: 1,
			},
			recipientPN: canonicalPN,
		},
		"integrator canonical PN": {
			providerTarget: lid,
			recipientPN: types.JID{
				User:       canonicalPN.User,
				Server:     canonicalPN.Server,
				Integrator: 1,
			},
		},
	}
	for name, resolved := range tests {
		t.Run(name, func(t *testing.T) {
			extra, err := sendRequestExtraForProviderTarget(logicalPN, resolved)
			if !errors.Is(err, errOutboundTargetLIDUnavailable) {
				t.Fatalf("inconsistent PN resolution must fail closed, got %v", err)
			}
			if !extra.PreResolvedRecipientPN.IsEmpty() {
				t.Fatalf("failed resolution unexpectedly produced send options: %s", extra.PreResolvedRecipientPN)
			}
		})
	}
}

func resolveOutboundPNToLID(
	ctx context.Context,
	target types.JID,
	lookupCachedLID outboundLIDCacheLookup,
	lookupCachedPN outboundPNCacheLookup,
	lookupRegistered outboundPhoneRegistrationLookup,
) (types.JID, error) {
	resolved, err := resolveOutboundPNToLIDTarget(
		ctx,
		target,
		lookupCachedLID,
		lookupCachedPN,
		lookupRegistered,
	)
	return resolved.providerTarget, err
}

func reverseOutboundPNLookup(pn types.JID) outboundPNCacheLookup {
	return func(context.Context, types.JID) (types.JID, error) {
		return pn.ToNonAD(), nil
	}
}
