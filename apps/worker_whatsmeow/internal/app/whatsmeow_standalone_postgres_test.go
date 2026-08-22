package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
)

func TestWorkerPostgresAtomicParametersAgainstPgBouncer(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_PGBOUNCER_PROTOCOL_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_PGBOUNCER_PROTOCOL_TEST_DATABASE_URL is not configured")
	}

	database, err := sql.Open("postgres", workerPostgresAtomicParametersDSN(databaseURL))
	if err != nil {
		t.Fatalf("open PgBouncer protocol test database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	database.SetMaxOpenConns(4)
	database.SetMaxIdleConns(4)

	ctx := context.Background()
	if err = database.PingContext(ctx); err != nil {
		t.Fatalf("ping PgBouncer protocol test database: %v", err)
	}

	const parallelism = 8
	const iterations = 40
	var wait sync.WaitGroup
	errorsFound := make(chan error, parallelism)
	for lane := 0; lane < parallelism; lane++ {
		lane := lane
		wait.Add(1)
		go func() {
			defer wait.Done()
			for iteration := 0; iteration < iterations; iteration++ {
				var number int64
				var identifier, provider string
				var jsonLane, jsonIteration int
				var byteaHex string
				var textArrayMatches, byteaArrayMatches bool
				jsonPayload, marshalErr := json.Marshal(map[string]int{
					"iteration": iteration,
					"lane":      lane,
				})
				if marshalErr != nil {
					errorsFound <- marshalErr
					return
				}
				err := database.QueryRowContext(ctx, `
					SELECT $1::bigint, $2::uuid::text, $3::text,
						($4::jsonb->>'lane')::int,
						($4::jsonb->>'iteration')::int,
						encode($5::bytea, 'hex'),
						$6::text[] = ARRAY['signal-a', 'signal-b']::text[],
						$7::bytea[] = ARRAY[decode('0001', 'hex'), decode('ff', 'hex')]::bytea[]
				`, int64(lane*iterations+iteration), "019fdc47-c4df-73e3-9b6b-1daa998b0a02", "whatsmeow",
					workerPostgresJSONText(jsonPayload), []byte{0, 1, 2, 255},
					pq.Array([]string{"signal-a", "signal-b"}), pq.Array([][]byte{{0, 1}, {255}})).
					Scan(&number, &identifier, &provider, &jsonLane, &jsonIteration, &byteaHex,
						&textArrayMatches, &byteaArrayMatches)
				if err != nil {
					errorsFound <- err
					return
				}
				if identifier == "" || provider != "whatsmeow" ||
					jsonLane != lane || jsonIteration != iteration || byteaHex != "000102ff" ||
					!textArrayMatches || !byteaArrayMatches {
					errorsFound <- errors.New("PgBouncer parameter values crossed query boundaries")
					return
				}
			}
		}()
	}
	wait.Wait()
	close(errorsFound)
	for err := range errorsFound {
		if err != nil {
			t.Fatalf("atomic lib/pq parameter batch failed: %v", err)
		}
	}
}

func TestWhatsmeowStandalonePostgresCompanionReservation(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_STANDALONE_POSTGRES_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_STANDALONE_POSTGRES_TEST_DATABASE_URL is not configured")
	}

	ctx := context.Background()
	sqlstore.PostgresArrayWrapper = pq.Array
	container, err := sqlstore.New(ctx, "postgres", databaseURL, nil)
	if err != nil {
		t.Fatalf("open standalone PostgreSQL store: %v", err)
	}
	t.Cleanup(func() { _ = container.Close() })

	newPairedDevice := func(sessionID string, revisionID int64) *store.Device {
		device := container.NewDeviceForSession(sessionID, revisionID)
		jid := types.NewADJID("5511999999999", 0, 1)
		device.ID = &jid
		device.Account = &waAdv.ADVSignedDeviceIdentity{
			Details:             []byte{1},
			AccountSignature:    make([]byte, 64),
			AccountSignatureKey: make([]byte, 32),
			DeviceSignature:     make([]byte, 64),
		}
		return device
	}

	sessionA, sessionB := uuid.NewString(), uuid.NewString()
	deviceA := newPairedDevice(sessionA, 1)
	if err = deviceA.Save(ctx); err != nil {
		t.Fatalf("save source companion: %v", err)
	}
	if err = container.ReserveCompanionIdentity(ctx, deviceA); err != nil {
		t.Fatalf("reserve source companion before connect: %v", err)
	}

	secondRevision := *deviceA
	secondRevision.RevisionID = 2
	secondRevision.Initialized = false
	if err = secondRevision.Save(ctx); err != nil {
		t.Fatalf("same session handoff revision was rejected: %v", err)
	}

	clonedSession := *deviceA
	clonedSession.SessionID = sessionB
	clonedSession.RevisionID = 1
	clonedSession.Initialized = false
	if err = clonedSession.Save(ctx); !errors.Is(err, sqlstore.ErrCompanionIdentityConflict) {
		t.Fatalf("second session opened cloned companion identity: %v", err)
	}

	if err = container.DeleteDevice(ctx, deviceA); err != nil {
		t.Fatalf("delete first source revision: %v", err)
	}
	if err = container.DeleteDevice(ctx, &secondRevision); err != nil {
		t.Fatalf("delete final source revision: %v", err)
	}
	if err = clonedSession.Save(ctx); err != nil {
		t.Fatalf("released companion identity remained globally reserved: %v", err)
	}
}
