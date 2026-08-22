package sqlstore

import (
	"errors"
	"testing"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/util/keys"
)

func validDeviceKeyMaterial() *store.Device {
	identity := keys.NewKeyPair()
	return &store.Device{
		NoiseKey:     keys.NewKeyPair(),
		IdentityKey:  identity,
		SignedPreKey: identity.CreateSignedPreKey(1),
	}
}

func TestValidateDeviceKeyMaterialAcceptsValidPairsAndSignature(t *testing.T) {
	device := validDeviceKeyMaterial()
	if err := ValidateDeviceKeyMaterial(device); err != nil {
		t.Fatalf("valid device key material was rejected: %v", err)
	}
	if err := ValidateCanonicalDeviceKeyMaterial(
		device.NoiseKey.Priv[:],
		device.IdentityKey.Priv[:],
		device.SignedPreKey.Priv[:],
		device.SignedPreKey.Signature[:],
	); err != nil {
		t.Fatalf("valid canonical key material was rejected: %v", err)
	}
}

func TestValidateDeviceKeyMaterialRejectsTamperedPrivateKeys(t *testing.T) {
	for _, fixture := range []struct {
		name string
		pair func(*store.Device) *keys.KeyPair
	}{
		{name: "noise", pair: func(device *store.Device) *keys.KeyPair { return device.NoiseKey }},
		{name: "identity", pair: func(device *store.Device) *keys.KeyPair { return device.IdentityKey }},
		{name: "signed pre-key", pair: func(device *store.Device) *keys.KeyPair { return &device.SignedPreKey.KeyPair }},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			device := validDeviceKeyMaterial()
			pair := fixture.pair(device)
			tampered := *pair.Priv
			tampered[10] ^= 0x01
			pair.Priv = &tampered
			if err := ValidateDeviceKeyMaterial(device); !errors.Is(err, ErrDeviceKeyPairMismatch) {
				t.Fatalf("tampered private key returned %v", err)
			}
		})
	}
}

func TestValidateDeviceKeyMaterialRejectsTamperedSignature(t *testing.T) {
	device := validDeviceKeyMaterial()
	tampered := *device.SignedPreKey.Signature
	tampered[10] ^= 0x01
	device.SignedPreKey.Signature = &tampered
	if err := ValidateDeviceKeyMaterial(device); !errors.Is(err, ErrSignedPreKeySignatureInvalid) {
		t.Fatalf("tampered signed pre-key signature returned %v", err)
	}
}
