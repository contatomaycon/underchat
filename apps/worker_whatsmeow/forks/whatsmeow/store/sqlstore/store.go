// Copyright (c) 2025 Tulir Asokan
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Package sqlstore contains an SQL-backed implementation of the interfaces in the store package.
package sqlstore

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.mau.fi/util/dbutil"
	"go.mau.fi/util/exslices"
	"go.mau.fi/util/exsync"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
)

// ErrInvalidLength is returned by some database getters if the database returned a byte array with an unexpected length.
// This should be impossible, as the database schema contains CHECK()s for all the relevant columns.
var ErrInvalidLength = errors.New("database returned byte array with illegal length")

// PostgresArrayWrapper is a function to wrap array values before passing them to the sql package.
//
// When using github.com/lib/pq, you should set
//
//	whatsmeow.PostgresArrayWrapper = pq.Array
var PostgresArrayWrapper func(any) interface {
	driver.Valuer
	sql.Scanner
}

type SQLStore struct {
	*Container
	SessionID  string
	RevisionID int64
	LIDMap     *CachedLIDMap

	preKeyLock sync.Mutex

	contactCache     map[types.JID]*types.ContactInfo
	contactCacheLock sync.Mutex

	migratedPNSessionsCache *exsync.Set[string]
}

// NewSQLStore creates a store for exactly one stable session revision.
// It contains implementations of all the different stores in the store package.
//
// In general, shared databases should use Container.GetDeviceForSession.
func NewSQLStore(c *Container, sessionID string, revisionID int64) *SQLStore {
	if sessionID == "" {
		panic(ErrSessionIDRequired)
	} else if _, err := uuid.Parse(sessionID); err != nil {
		panic(ErrInvalidSessionID)
	} else if revisionID <= 0 {
		panic(ErrRevisionIDRequired)
	}
	return &SQLStore{
		Container:    c,
		SessionID:    sessionID,
		RevisionID:   revisionID,
		LIDMap:       NewCachedLIDMap(c, sessionID, revisionID),
		contactCache: make(map[types.JID]*types.ContactInfo),

		migratedPNSessionsCache: exsync.NewSet[string](),
	}
}

var _ store.AllSessionSpecificStores = (*SQLStore)(nil)
var _ store.TransportStore = (*SQLStore)(nil)

type operationScopeContextKey struct{}

type scopedRow struct {
	store *SQLStore
	ctx   context.Context
	query string
	args  []any
	write bool
}

func (row *scopedRow) Scan(dest ...any) error {
	operation := row.store.DoSessionOperation
	if row.write {
		operation = row.store.DoSessionMutation
	}
	return operation(row.ctx, func(txCtx context.Context) error {
		return row.store.db.QueryRow(txCtx, row.query, row.args...).Scan(dest...)
	})
}

// DoSessionOperation runs a read-only function in a short transaction after
// installing the optional lease/RLS guard for this exact session revision.
func (s *SQLStore) DoSessionOperation(ctx context.Context, fn func(context.Context) error) error {
	scope := SessionScope{SessionID: s.SessionID, RevisionID: s.RevisionID}
	return s.Container.doSessionOperation(ctx, scope, fn)
}

// DoSessionMutation runs DML in a short transaction whose PostgreSQL entry
// point acquires the final session/revision lock modes before protocol rows.
func (s *SQLStore) DoSessionMutation(ctx context.Context, fn func(context.Context) error) error {
	scope := SessionScope{SessionID: s.SessionID, RevisionID: s.RevisionID}
	return s.Container.doSessionMutation(ctx, scope, fn)
}

func (s *SQLStore) exec(ctx context.Context, query string, args ...any) (result sql.Result, err error) {
	err = s.DoSessionMutation(ctx, func(txCtx context.Context) error {
		result, err = s.db.Exec(txCtx, query, args...)
		return err
	})
	return
}

func (s *SQLStore) queryRow(ctx context.Context, query string, args ...any) dbutil.Scannable {
	return &scopedRow{store: s, ctx: ctx, query: query, args: args}
}

func (s *SQLStore) queryMutationRow(ctx context.Context, query string, args ...any) dbutil.Scannable {
	return &scopedRow{store: s, ctx: ctx, query: query, args: args, write: true}
}

func (s *SQLStore) queryRows(ctx context.Context, query string, args []any, consume func(dbutil.Rows, error) error) error {
	return s.DoSessionOperation(ctx, func(txCtx context.Context) error {
		rows, err := s.db.Query(txCtx, query, args...)
		return consume(rows, err)
	})
}

// InvalidateCaches drops all revision-local positive and negative caches.
// Lease loss, handoff and logout paths must call this before discarding or
// reusing the store.
func (s *SQLStore) InvalidateCaches() {
	s.contactCacheLock.Lock()
	s.contactCache = make(map[types.JID]*types.ContactInfo)
	s.contactCacheLock.Unlock()
	s.migratedPNSessionsCache = exsync.NewSet[string]()
	s.LIDMap.Invalidate()
}

const (
	putTransportRoutingInfoQuery = `
		INSERT INTO whatsapp_provider_record (
			session_id, revision_id, namespace, record_key, codec_version, payload
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (session_id, revision_id, namespace, record_key) DO UPDATE SET
			codec_version=excluded.codec_version,
			payload=excluded.payload,
			updated_at=CURRENT_TIMESTAMP
		WHERE whatsapp_provider_record.codec_version<>excluded.codec_version
		   OR whatsapp_provider_record.payload<>excluded.payload
	`
	getTransportRoutingInfoQuery = `
		SELECT codec_version, payload
		FROM whatsapp_provider_record
		WHERE session_id=$1 AND revision_id=$2 AND namespace=$3 AND record_key=$4
	`
	deleteTransportRoutingInfoQuery = `
		DELETE FROM whatsapp_provider_record
		WHERE session_id=$1 AND revision_id=$2 AND namespace=$3 AND record_key=$4
	`
)

// PutTransportRoutingInfo atomically replaces the exact opaque route for this
// session revision. Unchanged values do not update the tuple, reducing WAL and
// preserving HOT-update headroom in the shared provider-record table.
func (s *SQLStore) PutTransportRoutingInfo(ctx context.Context, routingInfo []byte) error {
	if err := store.ValidateWhatsAppTransportRoutingInfo(routingInfo); err != nil {
		return err
	}
	if s.operationGuard == nil && s.mutationGuard == nil {
		if err := s.ensureStandaloneSessionRevision(ctx, s.SessionID, s.RevisionID); err != nil {
			return err
		}
	}
	_, err := s.exec(ctx, putTransportRoutingInfoQuery,
		s.SessionID, s.RevisionID,
		store.WhatsAppTransportNamespace,
		store.WhatsAppTransportRoutingInfoKey,
		store.WhatsAppTransportCodecVersion,
		routingInfo,
	)
	return err
}

// GetTransportRoutingInfo loads only the common route owned by this exact
// session revision and returns a defensive copy to callers.
func (s *SQLStore) GetTransportRoutingInfo(ctx context.Context) ([]byte, error) {
	var codecVersion int
	var routingInfo []byte
	err := s.queryRow(ctx, getTransportRoutingInfoQuery,
		s.SessionID, s.RevisionID,
		store.WhatsAppTransportNamespace,
		store.WhatsAppTransportRoutingInfoKey,
	).Scan(&codecVersion, &routingInfo)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	} else if codecVersion != store.WhatsAppTransportCodecVersion {
		return nil, fmt.Errorf("%w: unsupported codec version", store.ErrInvalidWhatsAppTransportRoutingInfo)
	} else if err = store.ValidateWhatsAppTransportRoutingInfo(routingInfo); err != nil {
		return nil, err
	}
	return append([]byte(nil), routingInfo...), nil
}

func (s *SQLStore) DeleteTransportRoutingInfo(ctx context.Context) error {
	_, err := s.exec(ctx, deleteTransportRoutingInfoQuery,
		s.SessionID, s.RevisionID,
		store.WhatsAppTransportNamespace,
		store.WhatsAppTransportRoutingInfoKey,
	)
	return err
}

const (
	putIdentityQuery = `
		INSERT INTO whatsapp_identity_keys (session_id, revision_id, their_id, identity) VALUES ($1, $2, $3, $4)
		ON CONFLICT (session_id, revision_id, their_id) DO UPDATE SET identity=excluded.identity
	`
	deleteAllIdentitiesQuery = `DELETE FROM whatsapp_identity_keys WHERE session_id=$1 AND revision_id=$2 AND their_id LIKE $3`
	deleteIdentityQuery      = `DELETE FROM whatsapp_identity_keys WHERE session_id=$1 AND revision_id=$2 AND their_id=$3`
	getIdentityQuery         = `SELECT identity FROM whatsapp_identity_keys WHERE session_id=$1 AND revision_id=$2 AND their_id=$3`
)

func (s *SQLStore) PutIdentity(ctx context.Context, address string, key [32]byte) error {
	_, err := s.exec(ctx, putIdentityQuery, s.SessionID, s.RevisionID, address, key[:])
	return err
}

func (s *SQLStore) DeleteAllIdentities(ctx context.Context, phone string) error {
	_, err := s.exec(ctx, deleteAllIdentitiesQuery, s.SessionID, s.RevisionID, phone+":%")
	return err
}

func (s *SQLStore) DeleteIdentity(ctx context.Context, address string) error {
	_, err := s.exec(ctx, deleteIdentityQuery, s.SessionID, s.RevisionID, address)
	return err
}

func (s *SQLStore) IsTrustedIdentity(ctx context.Context, address string, key [32]byte) (bool, error) {
	var existingIdentity []byte
	err := s.queryRow(ctx, getIdentityQuery, s.SessionID, s.RevisionID, address).Scan(&existingIdentity)
	if errors.Is(err, sql.ErrNoRows) {
		// Trust if not known, it'll be saved automatically later
		return true, nil
	} else if err != nil {
		return false, err
	} else if len(existingIdentity) != 32 {
		return false, ErrInvalidLength
	}
	return *(*[32]byte)(existingIdentity) == key, nil
}

const (
	getSessionQuery             = `SELECT session FROM whatsapp_signal_sessions WHERE session_id=$1 AND revision_id=$2 AND their_id=$3 AND scope='default'`
	hasSessionQuery             = `SELECT true FROM whatsapp_signal_sessions WHERE session_id=$1 AND revision_id=$2 AND their_id=$3 AND scope='default'`
	getManySessionQueryPostgres = `SELECT their_id, session FROM whatsapp_signal_sessions WHERE session_id=$1 AND revision_id=$2 AND scope='default' AND their_id = ANY($3)`
	getManySessionQueryGeneric  = `SELECT their_id, session FROM whatsapp_signal_sessions WHERE session_id=$1 AND revision_id=$2 AND scope='default' AND their_id IN (%s)`
	putSessionQuery             = `
		INSERT INTO whatsapp_signal_sessions (session_id, revision_id, their_id, scope, session) VALUES ($1, $2, $3, 'default', $4)
		ON CONFLICT (session_id, revision_id, their_id, scope) DO UPDATE SET session=excluded.session
	`
	deleteAllSessionsQuery = `DELETE FROM whatsapp_signal_sessions WHERE session_id=$1 AND revision_id=$2 AND scope='default' AND their_id LIKE $3`
	deleteSessionQuery     = `DELETE FROM whatsapp_signal_sessions WHERE session_id=$1 AND revision_id=$2 AND scope='default' AND their_id=$3`

	migratePNToLIDSessionsQuery = `
		INSERT INTO whatsapp_signal_sessions (session_id, revision_id, their_id, scope, session)
		SELECT session_id, revision_id, replace(their_id, $3, $4), scope, session
		FROM whatsapp_signal_sessions
		WHERE session_id=$1 AND revision_id=$2 AND scope='default' AND their_id LIKE $3 || ':%'
		ON CONFLICT (session_id, revision_id, their_id, scope) DO UPDATE SET session=excluded.session
	`
	deleteAllIdentityKeysQuery      = `DELETE FROM whatsapp_identity_keys WHERE session_id=$1 AND revision_id=$2 AND their_id LIKE $3`
	migratePNToLIDIdentityKeysQuery = `
		INSERT INTO whatsapp_identity_keys (session_id, revision_id, their_id, identity)
		SELECT session_id, revision_id, replace(their_id, $3, $4), identity
		FROM whatsapp_identity_keys
		WHERE session_id=$1 AND revision_id=$2 AND their_id LIKE $3 || ':%'
		ON CONFLICT (session_id, revision_id, their_id) DO UPDATE SET identity=excluded.identity
	`
	deleteAllSenderKeysQuery      = `DELETE FROM whatsapp_sender_keys WHERE session_id=$1 AND revision_id=$2 AND sender_id LIKE $3`
	migratePNToLIDSenderKeysQuery = `
		INSERT INTO whatsapp_sender_keys (session_id, revision_id, chat_id, sender_id, sender_key)
		SELECT session_id, revision_id, chat_id, replace(sender_id, $3, $4), sender_key
		FROM whatsapp_sender_keys
		WHERE session_id=$1 AND revision_id=$2 AND sender_id LIKE $3 || ':%'
		ON CONFLICT (session_id, revision_id, chat_id, sender_id) DO UPDATE SET sender_key=excluded.sender_key
	`
)

func (s *SQLStore) GetSession(ctx context.Context, address string) (session []byte, err error) {
	err = s.queryRow(ctx, getSessionQuery, s.SessionID, s.RevisionID, address).Scan(&session)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return
}

func (s *SQLStore) HasSession(ctx context.Context, address string) (has bool, err error) {
	err = s.queryRow(ctx, hasSessionQuery, s.SessionID, s.RevisionID, address).Scan(&has)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return
}

type addressSessionTuple struct {
	Address string
	Session []byte
}

var sessionScanner = dbutil.ConvertRowFn[addressSessionTuple](func(row dbutil.Scannable) (out addressSessionTuple, err error) {
	err = row.Scan(&out.Address, &out.Session)
	return
})

func (s *SQLStore) GetManySessions(ctx context.Context, addresses []string) (map[string][]byte, error) {
	if len(addresses) == 0 {
		return nil, nil
	}

	var query string
	var args []any
	if s.db.Dialect == dbutil.Postgres && PostgresArrayWrapper != nil {
		query = getManySessionQueryPostgres
		args = []any{s.SessionID, s.RevisionID, PostgresArrayWrapper(addresses)}
	} else {
		args = make([]any, len(addresses)+2)
		placeholders := make([]string, len(addresses))
		args[0] = s.SessionID
		args[1] = s.RevisionID
		for i, addr := range addresses {
			args[i+2] = addr
			placeholders[i] = fmt.Sprintf("$%d", i+3)
		}
		query = fmt.Sprintf(getManySessionQueryGeneric, strings.Join(placeholders, ","))
	}
	result := make(map[string][]byte, len(addresses))
	for _, addr := range addresses {
		result[addr] = nil
	}
	err := s.queryRows(ctx, query, args, func(rows dbutil.Rows, queryErr error) error {
		return sessionScanner.NewRowIter(rows, queryErr).Iter(func(tuple addressSessionTuple) (bool, error) {
			result[tuple.Address] = tuple.Session
			return true, nil
		})
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *SQLStore) PutManySessions(ctx context.Context, sessions map[string][]byte) error {
	return s.DoSessionMutation(ctx, func(ctx context.Context) error {
		for addr, sess := range sessions {
			err := s.PutSession(ctx, addr, sess)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *SQLStore) PutSession(ctx context.Context, address string, session []byte) error {
	_, err := s.exec(ctx, putSessionQuery, s.SessionID, s.RevisionID, address, session)
	return err
}

func (s *SQLStore) DeleteAllSessions(ctx context.Context, phone string) error {
	return s.deleteAllSessions(ctx, phone)
}

func (s *SQLStore) deleteAllSessions(ctx context.Context, phone string) error {
	_, err := s.exec(ctx, deleteAllSessionsQuery, s.SessionID, s.RevisionID, phone+":%")
	return err
}

func (s *SQLStore) deleteAllSenderKeys(ctx context.Context, phone string) error {
	_, err := s.exec(ctx, deleteAllSenderKeysQuery, s.SessionID, s.RevisionID, phone+":%")
	return err
}

func (s *SQLStore) deleteAllIdentityKeys(ctx context.Context, phone string) error {
	_, err := s.exec(ctx, deleteAllIdentityKeysQuery, s.SessionID, s.RevisionID, phone+":%")
	return err
}

func (s *SQLStore) DeleteSession(ctx context.Context, address string) error {
	_, err := s.exec(ctx, deleteSessionQuery, s.SessionID, s.RevisionID, address)
	return err
}

func (s *SQLStore) MigratePNToLID(ctx context.Context, pn, lid types.JID) error {
	pnSignal := pn.SignalAddressUser()
	if !s.migratedPNSessionsCache.Add(pnSignal) {
		return nil
	}
	var sessionsUpdated, identityKeysUpdated, senderKeysUpdated int64
	lidSignal := lid.SignalAddressUser()
	err := s.DoSessionMutation(ctx, func(ctx context.Context) error {
		res, err := s.exec(ctx, migratePNToLIDSessionsQuery, s.SessionID, s.RevisionID, pnSignal, lidSignal)
		if err != nil {
			return fmt.Errorf("failed to migrate sessions: %w", err)
		}
		sessionsUpdated, err = res.RowsAffected()
		if err != nil {
			return fmt.Errorf("failed to get rows affected for sessions: %w", err)
		}
		err = s.deleteAllSessions(ctx, pnSignal)
		if err != nil {
			return fmt.Errorf("failed to delete extra sessions: %w", err)
		}

		res, err = s.exec(ctx, migratePNToLIDIdentityKeysQuery, s.SessionID, s.RevisionID, pnSignal, lidSignal)
		if err != nil {
			return fmt.Errorf("failed to migrate identity keys: %w", err)
		}
		identityKeysUpdated, err = res.RowsAffected()
		if err != nil {
			return fmt.Errorf("failed to get rows affected for identity keys: %w", err)
		}
		err = s.deleteAllIdentityKeys(ctx, pnSignal)
		if err != nil {
			return fmt.Errorf("failed to delete extra identity keys: %w", err)
		}

		res, err = s.exec(ctx, migratePNToLIDSenderKeysQuery, s.SessionID, s.RevisionID, pnSignal, lidSignal)
		if err != nil {
			return fmt.Errorf("failed to migrate sender keys: %w", err)
		}
		senderKeysUpdated, err = res.RowsAffected()
		if err != nil {
			return fmt.Errorf("failed to get rows affected for sender keys: %w", err)
		}
		err = s.deleteAllSenderKeys(ctx, pnSignal)
		if err != nil {
			return fmt.Errorf("failed to delete extra sender keys: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	scope := SessionScope{SessionID: s.SessionID, RevisionID: s.RevisionID}
	if sessionsUpdated > 0 || senderKeysUpdated > 0 || identityKeysUpdated > 0 {
		s.logSessionDebug("info", "signal_scope_migrated", scope, map[string]any{
			"sessions":       sessionsUpdated,
			"identities":     identityKeysUpdated,
			"sender_records": senderKeysUpdated,
		})
	} else {
		s.logSessionDebug("debug", "signal_scope_migration_noop", scope, nil)
	}
	return nil
}

const (
	reservePreKeyIDsQuery = `
		UPDATE whatsapp_device SET next_pre_key_id=next_pre_key_id+$3
		WHERE session_id=$1 AND revision_id=$2 AND next_pre_key_id+$3 <= 16777216
		RETURNING next_pre_key_id-$3
	`
	insertPreKeyQuery           = `INSERT INTO whatsapp_pre_keys (session_id, revision_id, key_id, key, uploaded) VALUES ($1, $2, $3, $4, $5)`
	getUnuploadedPreKeysQuery   = `SELECT key_id, key FROM whatsapp_pre_keys WHERE session_id=$1 AND revision_id=$2 AND uploaded=false ORDER BY key_id LIMIT $3`
	getPreKeyQuery              = `SELECT key_id, key FROM whatsapp_pre_keys WHERE session_id=$1 AND revision_id=$2 AND key_id=$3`
	deletePreKeyQuery           = `DELETE FROM whatsapp_pre_keys WHERE session_id=$1 AND revision_id=$2 AND key_id=$3`
	markPreKeysAsUploadedQuery  = `UPDATE whatsapp_pre_keys SET uploaded=true WHERE session_id=$1 AND revision_id=$2 AND key_id<=$3`
	getUploadedPreKeyCountQuery = `SELECT COUNT(*) FROM whatsapp_pre_keys WHERE session_id=$1 AND revision_id=$2 AND uploaded=true`
)

func (s *SQLStore) genOnePreKey(ctx context.Context, id uint32, markUploaded bool) (*keys.PreKey, error) {
	key := keys.NewPreKey(id)
	_, err := s.exec(ctx, insertPreKeyQuery, s.SessionID, s.RevisionID, key.KeyID, key.Priv[:], markUploaded)
	return key, err
}

func (s *SQLStore) reservePreKeyIDs(ctx context.Context, count uint32) (uint32, error) {
	var firstKeyID uint32
	err := s.queryMutationRow(ctx, reservePreKeyIDsQuery, s.SessionID, s.RevisionID, count).Scan(&firstKeyID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, errors.New("prekey ID range exhausted or device revision missing")
	} else if err != nil {
		return 0, fmt.Errorf("failed to reserve prekey IDs: %w", err)
	}
	return firstKeyID, nil
}

func (s *SQLStore) GenOnePreKey(ctx context.Context) (*keys.PreKey, error) {
	s.preKeyLock.Lock()
	defer s.preKeyLock.Unlock()
	nextKeyID, err := s.reservePreKeyIDs(ctx, 1)
	if err != nil {
		return nil, err
	}
	return s.genOnePreKey(ctx, nextKeyID, true)
}

func (s *SQLStore) GetOrGenPreKeys(ctx context.Context, count uint32) ([]*keys.PreKey, error) {
	s.preKeyLock.Lock()
	defer s.preKeyLock.Unlock()

	var newKeys []*keys.PreKey
	err := s.queryRows(ctx, getUnuploadedPreKeysQuery, []any{s.SessionID, s.RevisionID, count}, func(rows dbutil.Rows, queryErr error) error {
		var scanErr error
		newKeys, scanErr = scanPreKey.NewRowIter(rows, queryErr).AsList()
		return scanErr
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query existing prekeys: %w", err)
	}

	alreadyGeneratedCount := uint32(len(newKeys))
	if count > alreadyGeneratedCount {
		var nextKeyID uint32
		nextKeyID, err = s.reservePreKeyIDs(ctx, count-alreadyGeneratedCount)
		if err != nil {
			return nil, err
		}
		newKeys = slices.Grow(newKeys, int(count)-len(newKeys))[:count]
		for i := alreadyGeneratedCount; i < count; i++ {
			newKeys[i], err = s.genOnePreKey(ctx, nextKeyID, false)
			if err != nil {
				return nil, fmt.Errorf("failed to generate prekey: %w", err)
			}
			nextKeyID++
		}
	}

	return newKeys, nil
}

var scanPreKey = dbutil.ConvertRowFn[*keys.PreKey](func(row dbutil.Scannable) (*keys.PreKey, error) {
	var priv []byte
	var id uint32
	err := row.Scan(&id, &priv)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	} else if len(priv) != 32 {
		return nil, ErrInvalidLength
	}
	return &keys.PreKey{
		KeyPair: *keys.NewKeyPairFromPrivateKey(*(*[32]byte)(priv)),
		KeyID:   id,
	}, nil
})

func (s *SQLStore) GetPreKey(ctx context.Context, id uint32) (*keys.PreKey, error) {
	return scanPreKey(s.queryRow(ctx, getPreKeyQuery, s.SessionID, s.RevisionID, id))
}

func (s *SQLStore) RemovePreKey(ctx context.Context, id uint32) error {
	_, err := s.exec(ctx, deletePreKeyQuery, s.SessionID, s.RevisionID, id)
	return err
}

func (s *SQLStore) MarkPreKeysAsUploaded(ctx context.Context, upToID uint32) error {
	_, err := s.exec(ctx, markPreKeysAsUploadedQuery, s.SessionID, s.RevisionID, upToID)
	return err
}

func (s *SQLStore) UploadedPreKeyCount(ctx context.Context) (count int, err error) {
	err = s.queryRow(ctx, getUploadedPreKeyCountQuery, s.SessionID, s.RevisionID).Scan(&count)
	return
}

const (
	getSenderKeyQuery = `SELECT sender_key FROM whatsapp_sender_keys WHERE session_id=$1 AND revision_id=$2 AND chat_id=$3 AND sender_id=$4`
	putSenderKeyQuery = `
		INSERT INTO whatsapp_sender_keys (session_id, revision_id, chat_id, sender_id, sender_key) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (session_id, revision_id, chat_id, sender_id) DO UPDATE SET sender_key=excluded.sender_key
	`
)

func (s *SQLStore) PutSenderKey(ctx context.Context, group, user string, session []byte) error {
	_, err := s.exec(ctx, putSenderKeyQuery, s.SessionID, s.RevisionID, group, user, session)
	return err
}

func (s *SQLStore) GetSenderKey(ctx context.Context, group, user string) (key []byte, err error) {
	err = s.queryRow(ctx, getSenderKeyQuery, s.SessionID, s.RevisionID, group, user).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return
}

const (
	putAppStateSyncKeyQuery = `
		INSERT INTO whatsapp_app_state_sync_keys (session_id, revision_id, key_id, key_data, timestamp, fingerprint) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (session_id, revision_id, key_id) DO UPDATE
			SET key_data=excluded.key_data, timestamp=excluded.timestamp, fingerprint=excluded.fingerprint
			WHERE excluded.timestamp > whatsapp_app_state_sync_keys.timestamp
	`
	getAllAppStateSyncKeysQuery     = `SELECT key_data, timestamp, fingerprint FROM whatsapp_app_state_sync_keys WHERE session_id=$1 AND revision_id=$2 ORDER BY timestamp DESC`
	getAppStateSyncKeyQuery         = `SELECT key_data, timestamp, fingerprint FROM whatsapp_app_state_sync_keys WHERE session_id=$1 AND revision_id=$2 AND key_id=$3`
	getLatestAppStateSyncKeyIDQuery = `SELECT key_id FROM whatsapp_app_state_sync_keys WHERE session_id=$1 AND revision_id=$2 ORDER BY timestamp DESC LIMIT 1`
)

func (s *SQLStore) PutAppStateSyncKey(ctx context.Context, id []byte, key store.AppStateSyncKey) error {
	_, err := s.exec(ctx, putAppStateSyncKeyQuery, s.SessionID, s.RevisionID, id, key.Data, key.Timestamp, key.Fingerprint)
	return err
}

var convertAppStateSyncKeyRow = dbutil.ConvertRowFn[*store.AppStateSyncKey](func(rows dbutil.Scannable) (*store.AppStateSyncKey, error) {
	var item store.AppStateSyncKey
	err := rows.Scan(&item.Data, &item.Timestamp, &item.Fingerprint)
	if err != nil {
		return nil, err
	}
	return &item, nil
})

func (s *SQLStore) GetAllAppStateSyncKeys(ctx context.Context) ([]*store.AppStateSyncKey, error) {
	var keys []*store.AppStateSyncKey
	err := s.queryRows(ctx, getAllAppStateSyncKeysQuery, []any{s.SessionID, s.RevisionID}, func(rows dbutil.Rows, queryErr error) error {
		var scanErr error
		keys, scanErr = convertAppStateSyncKeyRow.NewRowIter(rows, queryErr).AsList()
		return scanErr
	})
	return keys, err
}

func (s *SQLStore) GetAppStateSyncKey(ctx context.Context, id []byte) (*store.AppStateSyncKey, error) {
	key, err := convertAppStateSyncKeyRow(s.queryRow(ctx, getAppStateSyncKeyQuery, s.SessionID, s.RevisionID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return key, err
}

func (s *SQLStore) GetLatestAppStateSyncKeyID(ctx context.Context) ([]byte, error) {
	var keyID []byte
	err := s.queryRow(ctx, getLatestAppStateSyncKeyIDQuery, s.SessionID, s.RevisionID).Scan(&keyID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return keyID, err
}

const (
	putAppStateVersionQuery = `
		INSERT INTO whatsapp_app_state_version (session_id, revision_id, name, version, hash) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (session_id, revision_id, name) DO UPDATE SET version=excluded.version, hash=excluded.hash
	`
	getAppStateVersionQuery                 = `SELECT version, hash FROM whatsapp_app_state_version WHERE session_id=$1 AND revision_id=$2 AND name=$3`
	deleteAppStateVersionQuery              = `DELETE FROM whatsapp_app_state_version WHERE session_id=$1 AND revision_id=$2 AND name=$3`
	putAppStateMutationMACsQuery            = `INSERT INTO whatsapp_app_state_mutation_macs (session_id, revision_id, name, version, index_mac, value_mac) VALUES `
	deleteAppStateMutationMACsQueryPostgres = `DELETE FROM whatsapp_app_state_mutation_macs WHERE session_id=$1 AND revision_id=$2 AND name=$3 AND index_mac=ANY($4::bytea[])`
	deleteAppStateMutationMACsQueryGeneric  = `DELETE FROM whatsapp_app_state_mutation_macs WHERE session_id=$1 AND revision_id=$2 AND name=$3 AND index_mac IN `
	getAppStateMutationMACQuery             = `SELECT value_mac FROM whatsapp_app_state_mutation_macs WHERE session_id=$1 AND revision_id=$2 AND name=$3 AND index_mac=$4 ORDER BY version DESC LIMIT 1`
)

func (s *SQLStore) PutAppStateVersion(ctx context.Context, name string, version uint64, hash [128]byte) error {
	_, err := s.exec(ctx, putAppStateVersionQuery, s.SessionID, s.RevisionID, name, version, hash[:])
	return err
}

func (s *SQLStore) GetAppStateVersion(ctx context.Context, name string) (version uint64, hash [128]byte, err error) {
	var uncheckedHash []byte
	err = s.queryRow(ctx, getAppStateVersionQuery, s.SessionID, s.RevisionID, name).Scan(&version, &uncheckedHash)
	if errors.Is(err, sql.ErrNoRows) {
		// version will be 0 and hash will be an empty array, which is the correct initial state
		err = nil
	} else if err != nil {
		// There's an error, just return it
	} else if len(uncheckedHash) != 128 {
		// This shouldn't happen
		err = ErrInvalidLength
	} else if version == 0 {
		err = fmt.Errorf("invalid saved app state version 0 for name %s (hash %x)", name, uncheckedHash)
	} else {
		// No errors, convert hash slice to array
		hash = *(*[128]byte)(uncheckedHash)
	}
	return
}

func (s *SQLStore) DeleteAppStateVersion(ctx context.Context, name string) error {
	_, err := s.exec(ctx, deleteAppStateVersionQuery, s.SessionID, s.RevisionID, name)
	return err
}

func (s *SQLStore) putAppStateMutationMACs(ctx context.Context, name string, version uint64, mutations []store.AppStateMutationMAC) error {
	values := make([]any, 4+len(mutations)*2)
	queryParts := make([]string, len(mutations))
	values[0] = s.SessionID
	values[1] = s.RevisionID
	values[2] = name
	values[3] = version
	placeholderSyntax := "($1, $2, $3, $4, $%d, $%d)"
	if s.db.Dialect == dbutil.SQLite {
		placeholderSyntax = "(?1, ?2, ?3, ?4, ?%d, ?%d)"
	}
	for i, mutation := range mutations {
		baseIndex := 4 + i*2
		values[baseIndex] = mutation.IndexMAC
		values[baseIndex+1] = mutation.ValueMAC
		queryParts[i] = fmt.Sprintf(placeholderSyntax, baseIndex+1, baseIndex+2)
	}
	_, err := s.exec(ctx, putAppStateMutationMACsQuery+strings.Join(queryParts, ","), values...)
	return err
}

const mutationBatchSize = 400

func (s *SQLStore) PutAppStateMutationMACs(ctx context.Context, name string, version uint64, mutations []store.AppStateMutationMAC) error {
	if len(mutations) == 0 {
		return nil
	}
	return s.DoSessionMutation(ctx, func(ctx context.Context) error {
		for slice := range slices.Chunk(mutations, mutationBatchSize) {
			err := s.putAppStateMutationMACs(ctx, name, version, slice)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *SQLStore) DeleteAppStateMutationMACs(ctx context.Context, name string, indexMACs [][]byte) (err error) {
	if len(indexMACs) == 0 {
		return
	}
	if s.db.Dialect == dbutil.Postgres && PostgresArrayWrapper != nil {
		_, err = s.exec(ctx, deleteAppStateMutationMACsQueryPostgres, s.SessionID, s.RevisionID, name, PostgresArrayWrapper(indexMACs))
	} else {
		args := make([]any, 3+len(indexMACs))
		args[0] = s.SessionID
		args[1] = s.RevisionID
		args[2] = name
		queryParts := make([]string, len(indexMACs))
		for i, item := range indexMACs {
			args[3+i] = item
			queryParts[i] = fmt.Sprintf("$%d", i+4)
		}
		_, err = s.exec(ctx, deleteAppStateMutationMACsQueryGeneric+"("+strings.Join(queryParts, ",")+")", args...)
	}
	return
}

func (s *SQLStore) GetAppStateMutationMAC(ctx context.Context, name string, indexMAC []byte) (valueMAC []byte, err error) {
	err = s.queryRow(ctx, getAppStateMutationMACQuery, s.SessionID, s.RevisionID, name, indexMAC).Scan(&valueMAC)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return
}

const (
	putContactNameQuery = `
		INSERT INTO whatsapp_contacts (session_id, revision_id, their_jid, first_name, full_name) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (session_id, revision_id, their_jid) DO UPDATE SET first_name=excluded.first_name, full_name=excluded.full_name
	`
	putRedactedPhoneQuery = `
		INSERT INTO whatsapp_contacts (session_id, revision_id, their_jid, redacted_phone)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (session_id, revision_id, their_jid) DO UPDATE SET redacted_phone=excluded.redacted_phone
	`
	putPushNameQuery = `
		INSERT INTO whatsapp_contacts (session_id, revision_id, their_jid, push_name) VALUES ($1, $2, $3, $4)
		ON CONFLICT (session_id, revision_id, their_jid) DO UPDATE SET push_name=excluded.push_name
	`
	putBusinessNameQuery = `
		INSERT INTO whatsapp_contacts (session_id, revision_id, their_jid, business_name) VALUES ($1, $2, $3, $4)
		ON CONFLICT (session_id, revision_id, their_jid) DO UPDATE SET business_name=excluded.business_name
	`
	getContactQuery = `
		SELECT first_name, full_name, push_name, business_name, redacted_phone FROM whatsapp_contacts WHERE session_id=$1 AND revision_id=$2 AND their_jid=$3
	`
	getAllContactsQuery = `
		SELECT their_jid, first_name, full_name, push_name, business_name, redacted_phone FROM whatsapp_contacts WHERE session_id=$1 AND revision_id=$2
	`
)

var putContactNamesMassInsertBuilder = dbutil.NewMassInsertBuilder[store.ContactEntry, [2]any](
	putContactNameQuery, "($1, $2, $%d, $%d, $%d)",
)

var putRedactedPhonesMassInsertBuilder = dbutil.NewMassInsertBuilder[store.RedactedPhoneEntry, [2]any](
	putRedactedPhoneQuery, "($1, $2, $%d, $%d)",
)

func (s *SQLStore) PutPushName(ctx context.Context, user types.JID, pushName string) (bool, string, error) {
	s.contactCacheLock.Lock()
	defer s.contactCacheLock.Unlock()

	cached, err := s.getContact(ctx, user)
	if err != nil {
		return false, "", err
	}
	if cached.PushName != pushName {
		_, err = s.exec(ctx, putPushNameQuery, s.SessionID, s.RevisionID, user, pushName)
		if err != nil {
			return false, "", err
		}
		previousName := cached.PushName
		cached.PushName = pushName
		cached.Found = true
		return true, previousName, nil
	}
	return false, "", nil
}

func (s *SQLStore) PutBusinessName(ctx context.Context, user types.JID, businessName string) (bool, string, error) {
	s.contactCacheLock.Lock()
	defer s.contactCacheLock.Unlock()

	cached, err := s.getContact(ctx, user)
	if err != nil {
		return false, "", err
	}
	if cached.BusinessName != businessName {
		_, err = s.exec(ctx, putBusinessNameQuery, s.SessionID, s.RevisionID, user, businessName)
		if err != nil {
			return false, "", err
		}
		previousName := cached.BusinessName
		cached.BusinessName = businessName
		cached.Found = true
		return true, previousName, nil
	}
	return false, "", nil
}

func (s *SQLStore) PutContactName(ctx context.Context, user types.JID, firstName, fullName string) error {
	s.contactCacheLock.Lock()
	defer s.contactCacheLock.Unlock()

	cached, err := s.getContact(ctx, user)
	if err != nil {
		return err
	}
	if cached.FirstName != firstName || cached.FullName != fullName {
		_, err = s.exec(ctx, putContactNameQuery, s.SessionID, s.RevisionID, user, firstName, fullName)
		if err != nil {
			return err
		}
		cached.FirstName = firstName
		cached.FullName = fullName
		cached.Found = true
	}
	return nil
}

const contactBatchSize = 300

func (s *SQLStore) PutAllContactNames(ctx context.Context, contacts []store.ContactEntry) error {
	if len(contacts) == 0 {
		return nil
	}
	origLen := len(contacts)
	contacts = exslices.DeduplicateUnsortedOverwriteFunc(contacts, func(t store.ContactEntry) types.JID {
		return t.JID
	})
	if origLen != len(contacts) {
		s.log.Warnf("%d duplicate contacts found in PutAllContactNames", origLen-len(contacts))
	}
	err := s.DoSessionMutation(ctx, func(ctx context.Context) error {
		for slice := range slices.Chunk(contacts, contactBatchSize) {
			query, vars := putContactNamesMassInsertBuilder.Build([2]any{s.SessionID, s.RevisionID}, slice)
			_, err := s.exec(ctx, query, vars...)
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.contactCacheLock.Lock()
	// Just clear the cache, fetching pushnames and business names would be too much effort
	s.contactCache = make(map[types.JID]*types.ContactInfo)
	s.contactCacheLock.Unlock()
	return nil
}

func (s *SQLStore) PutManyRedactedPhones(ctx context.Context, entries []store.RedactedPhoneEntry) error {
	if len(entries) == 0 {
		return nil
	}
	origLen := len(entries)
	entries = exslices.DeduplicateUnsortedOverwriteFunc(entries, func(t store.RedactedPhoneEntry) types.JID {
		return t.JID
	})
	if origLen != len(entries) {
		s.log.Warnf("%d duplicate contacts found in PutManyRedactedPhones", origLen-len(entries))
	}
	err := s.DoSessionMutation(ctx, func(ctx context.Context) error {
		for slice := range slices.Chunk(entries, contactBatchSize) {
			query, vars := putRedactedPhonesMassInsertBuilder.Build([2]any{s.SessionID, s.RevisionID}, slice)
			_, err := s.exec(ctx, query, vars...)
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.contactCacheLock.Lock()
	for _, entry := range entries {
		if cached, ok := s.contactCache[entry.JID]; ok && cached.RedactedPhone == entry.RedactedPhone {
			continue
		}
		delete(s.contactCache, entry.JID)
	}
	s.contactCacheLock.Unlock()
	return nil
}

func (s *SQLStore) getContact(ctx context.Context, user types.JID) (*types.ContactInfo, error) {
	cached, ok := s.contactCache[user]
	if ok {
		return cached, nil
	}

	var first, full, push, business, redactedPhone sql.NullString
	err := s.queryRow(ctx, getContactQuery, s.SessionID, s.RevisionID, user).Scan(&first, &full, &push, &business, &redactedPhone)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	info := &types.ContactInfo{
		Found:         err == nil,
		FirstName:     first.String,
		FullName:      full.String,
		PushName:      push.String,
		BusinessName:  business.String,
		RedactedPhone: redactedPhone.String,
	}
	s.contactCache[user] = info
	return info, nil
}

func (s *SQLStore) GetContact(ctx context.Context, user types.JID) (types.ContactInfo, error) {
	s.contactCacheLock.Lock()
	info, err := s.getContact(ctx, user)
	s.contactCacheLock.Unlock()
	if err != nil {
		return types.ContactInfo{}, err
	}
	return *info, nil
}

type contactTuple struct {
	JID  types.JID
	Info *types.ContactInfo
}

var convertContactRow = dbutil.ConvertRowFn[*contactTuple](func(rows dbutil.Scannable) (*contactTuple, error) {
	var jid types.JID
	var first, full, push, business, redactedPhone sql.NullString
	err := rows.Scan(&jid, &first, &full, &push, &business, &redactedPhone)
	if err != nil {
		return nil, fmt.Errorf("error scanning row: %w", err)
	}
	return &contactTuple{
		JID: jid,
		Info: &types.ContactInfo{
			Found:         true,
			FirstName:     first.String,
			FullName:      full.String,
			PushName:      push.String,
			BusinessName:  business.String,
			RedactedPhone: redactedPhone.String,
		},
	}, nil
})

func (s *SQLStore) GetAllContacts(ctx context.Context) (map[types.JID]types.ContactInfo, error) {
	s.contactCacheLock.Lock()
	defer s.contactCacheLock.Unlock()
	output := make(map[types.JID]types.ContactInfo, len(s.contactCache))
	err := s.queryRows(ctx, getAllContactsQuery, []any{s.SessionID, s.RevisionID}, func(rows dbutil.Rows, queryErr error) error {
		return convertContactRow.NewRowIter(rows, queryErr).Iter(func(tuple *contactTuple) (bool, error) {
			output[tuple.JID] = *tuple.Info
			s.contactCache[tuple.JID] = tuple.Info
			return true, nil
		})
	})
	return output, err
}

const (
	putChatSettingQuery = `
		INSERT INTO whatsapp_chat_settings (session_id, revision_id, chat_jid, %[1]s) VALUES ($1, $2, $3, $4)
		ON CONFLICT (session_id, revision_id, chat_jid) DO UPDATE SET %[1]s=excluded.%[1]s
	`
	getChatSettingsQuery = `
		SELECT muted_until, pinned, archived FROM whatsapp_chat_settings WHERE session_id=$1 AND revision_id=$2 AND chat_jid=$3
	`
)

func (s *SQLStore) PutMutedUntil(ctx context.Context, chat types.JID, mutedUntil time.Time) error {
	var val int64
	if mutedUntil == store.MutedForever {
		val = -1
	} else if !mutedUntil.IsZero() {
		val = mutedUntil.Unix()
	}
	_, err := s.exec(ctx, fmt.Sprintf(putChatSettingQuery, "muted_until"), s.SessionID, s.RevisionID, chat, val)
	return err
}

func (s *SQLStore) PutPinned(ctx context.Context, chat types.JID, pinned bool) error {
	_, err := s.exec(ctx, fmt.Sprintf(putChatSettingQuery, "pinned"), s.SessionID, s.RevisionID, chat, pinned)
	return err
}

func (s *SQLStore) PutArchived(ctx context.Context, chat types.JID, archived bool) error {
	_, err := s.exec(ctx, fmt.Sprintf(putChatSettingQuery, "archived"), s.SessionID, s.RevisionID, chat, archived)
	return err
}

func (s *SQLStore) GetChatSettings(ctx context.Context, chat types.JID) (settings types.LocalChatSettings, err error) {
	var mutedUntil int64
	err = s.queryRow(ctx, getChatSettingsQuery, s.SessionID, s.RevisionID, chat).Scan(&mutedUntil, &settings.Pinned, &settings.Archived)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	} else if err != nil {
		return
	} else {
		settings.Found = true
	}
	if mutedUntil < 0 {
		settings.MutedUntil = store.MutedForever
	} else if mutedUntil > 0 {
		settings.MutedUntil = time.Unix(mutedUntil, 0)
	}
	return
}

const (
	putMsgSecret = `
		INSERT INTO whatsapp_message_secrets (session_id, revision_id, chat_jid, sender_jid, message_id, key)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (session_id, revision_id, chat_jid, sender_jid, message_id) DO NOTHING
	`
	getMsgSecret = `
		SELECT key, sender_jid
		FROM whatsapp_message_secrets
		WHERE session_id=$1 AND revision_id=$2 AND (chat_jid=$3 OR chat_jid=(
			CASE
				WHEN $3 LIKE '%@lid'
					THEN (SELECT pn || '@s.whatsapp.net' FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND lid=replace($3, '@lid', ''))
				WHEN $3 LIKE '%@s.whatsapp.net'
					THEN (SELECT lid || '@lid' FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND pn=replace($3, '@s.whatsapp.net', ''))
			END
		)) AND message_id=$5 AND (sender_jid=$4 OR sender_jid=(
			CASE
				WHEN $4 LIKE '%@lid'
					THEN (SELECT pn || '@s.whatsapp.net' FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND lid=replace($4, '@lid', ''))
				WHEN $4 LIKE '%@s.whatsapp.net'
					THEN (SELECT lid || '@lid' FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND pn=replace($4, '@s.whatsapp.net', ''))
			END
		))
	`
)

func (s *SQLStore) PutMessageSecrets(ctx context.Context, inserts []store.MessageSecretInsert) (err error) {
	if len(inserts) == 0 {
		return nil
	}
	return s.DoSessionMutation(ctx, func(ctx context.Context) error {
		for _, insert := range inserts {
			_, err = s.exec(ctx, putMsgSecret, s.SessionID, s.RevisionID, insert.Chat.ToNonAD(), insert.Sender.ToNonAD(), insert.ID, insert.Secret)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *SQLStore) PutMessageSecret(ctx context.Context, chat, sender types.JID, id types.MessageID, secret []byte) (err error) {
	_, err = s.exec(ctx, putMsgSecret, s.SessionID, s.RevisionID, chat.ToNonAD(), sender.ToNonAD(), id, secret)
	return
}

func (s *SQLStore) GetMessageSecret(ctx context.Context, chat, sender types.JID, id types.MessageID) (secret []byte, realSender types.JID, err error) {
	err = s.queryRow(ctx, getMsgSecret, s.SessionID, s.RevisionID, chat.ToNonAD(), sender.ToNonAD(), id).Scan(&secret, &realSender)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return
}

const (
	putPrivacyTokens = `
		INSERT INTO whatsapp_privacy_tokens (session_id, revision_id, their_jid, token, timestamp, sender_timestamp)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (session_id, revision_id, their_jid) DO UPDATE SET
			token=EXCLUDED.token,
			timestamp=EXCLUDED.timestamp,
			sender_timestamp=COALESCE(EXCLUDED.sender_timestamp, whatsapp_privacy_tokens.sender_timestamp)
		WHERE EXCLUDED.timestamp >= whatsapp_privacy_tokens.timestamp
	`
	getPrivacyToken = `
		SELECT token, timestamp, sender_timestamp FROM whatsapp_privacy_tokens WHERE session_id=$1 AND revision_id=$2 AND (their_jid=$3 OR their_jid=(
			CASE
				WHEN $3 LIKE '%@lid'
					THEN (SELECT pn || '@s.whatsapp.net' FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND lid=replace($3, '@lid', ''))
				WHEN $3 LIKE '%@s.whatsapp.net'
					THEN (SELECT lid || '@lid' FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND pn=replace($3, '@s.whatsapp.net', ''))
				ELSE $3
			END
		))
		ORDER BY timestamp DESC LIMIT 1
	`
	deleteExpiredPrivacyTokens = `
		DELETE FROM whatsapp_privacy_tokens
		WHERE session_id=$1 AND revision_id=$2 AND timestamp < $3
	`
)

const (
	putNCTSaltQuery = `
		INSERT INTO whatsapp_nct_salt (session_id, revision_id, salt) VALUES ($1, $2, $3)
		ON CONFLICT (session_id, revision_id) DO UPDATE SET salt=excluded.salt
	`
	getNCTSaltQuery    = `SELECT salt FROM whatsapp_nct_salt WHERE session_id=$1 AND revision_id=$2`
	deleteNCTSaltQuery = `DELETE FROM whatsapp_nct_salt WHERE session_id=$1 AND revision_id=$2`
)

func (s *SQLStore) PutPrivacyTokens(ctx context.Context, tokens ...store.PrivacyToken) error {
	if len(tokens) == 0 {
		return nil
	}
	args := make([]any, 2+len(tokens)*4)
	placeholders := make([]string, len(tokens))
	args[0] = s.SessionID
	args[1] = s.RevisionID
	for i, token := range tokens {
		args[i*4+2] = token.User.ToNonAD().String()
		args[i*4+3] = token.Token
		args[i*4+4] = token.Timestamp.Unix()
		if token.SenderTimestamp.IsZero() {
			args[i*4+5] = nil
		} else {
			args[i*4+5] = token.SenderTimestamp.Unix()
		}
		placeholders[i] = fmt.Sprintf("($1, $2, $%d, $%d, $%d, $%d)", i*4+3, i*4+4, i*4+5, i*4+6)
	}
	query := strings.ReplaceAll(putPrivacyTokens, "($1, $2, $3, $4, $5, $6)", strings.Join(placeholders, ","))
	_, err := s.exec(ctx, query, args...)
	return err
}

func (s *SQLStore) GetPrivacyToken(ctx context.Context, user types.JID) (*store.PrivacyToken, error) {
	var token store.PrivacyToken
	token.User = user.ToNonAD()
	var ts int64
	var senderTS sql.NullInt64
	err := s.queryRow(ctx, getPrivacyToken, s.SessionID, s.RevisionID, token.User).Scan(&token.Token, &ts, &senderTS)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	} else {
		token.Timestamp = time.Unix(ts, 0)
		if senderTS.Valid {
			token.SenderTimestamp = time.Unix(senderTS.Int64, 0)
		}
		return &token, nil
	}
}

func (s *SQLStore) PutNCTSalt(ctx context.Context, salt []byte) error {
	_, err := s.exec(ctx, putNCTSaltQuery, s.SessionID, s.RevisionID, salt)
	return err
}

func (s *SQLStore) GetNCTSalt(ctx context.Context) ([]byte, error) {
	var salt []byte
	err := s.queryRow(ctx, getNCTSaltQuery, s.SessionID, s.RevisionID).Scan(&salt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	return salt, nil
}

func (s *SQLStore) DeleteNCTSalt(ctx context.Context) error {
	_, err := s.exec(ctx, deleteNCTSaltQuery, s.SessionID, s.RevisionID)
	return err
}

func (s *SQLStore) DeleteExpiredPrivacyTokens(ctx context.Context, cutoff time.Time) (int64, error) {
	res, err := s.exec(ctx, deleteExpiredPrivacyTokens, s.SessionID, s.RevisionID, cutoff.Unix())
	if err != nil {
		return 0, err
	}
	deleted, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	return deleted, nil
}

const (
	getBufferedEventQuery = `
		SELECT plaintext, server_timestamp, insert_timestamp FROM whatsapp_event_buffer WHERE session_id=$1 AND revision_id=$2 AND ciphertext_hash=$3
	`
	putBufferedEventQuery = `
		INSERT INTO whatsapp_event_buffer (session_id, revision_id, ciphertext_hash, plaintext, server_timestamp, insert_timestamp)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (session_id, revision_id, ciphertext_hash) DO UPDATE
		SET plaintext=excluded.plaintext, server_timestamp=excluded.server_timestamp, insert_timestamp=excluded.insert_timestamp
	`
	clearBufferedEventPlaintextQuery = `
		UPDATE whatsapp_event_buffer SET plaintext=NULL WHERE session_id=$1 AND revision_id=$2 AND ciphertext_hash=$3
	`
	deleteOldBufferedHashesQuery = `
		DELETE FROM whatsapp_event_buffer WHERE session_id=$1 AND revision_id=$2 AND insert_timestamp < $3
	`
)

func (s *SQLStore) GetBufferedEvent(ctx context.Context, ciphertextHash [32]byte) (*store.BufferedEvent, error) {
	var insertTimeMS, serverTimeSeconds int64
	var buf store.BufferedEvent
	err := s.queryRow(ctx, getBufferedEventQuery, s.SessionID, s.RevisionID, ciphertextHash[:]).Scan(&buf.Plaintext, &serverTimeSeconds, &insertTimeMS)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	buf.ServerTime = time.Unix(serverTimeSeconds, 0)
	buf.InsertTime = time.UnixMilli(insertTimeMS)
	return &buf, nil
}

func (s *SQLStore) PutBufferedEvent(ctx context.Context, ciphertextHash [32]byte, plaintext []byte, serverTimestamp time.Time) error {
	_, err := s.exec(ctx, putBufferedEventQuery, s.SessionID, s.RevisionID, ciphertextHash[:], plaintext, serverTimestamp.Unix(), time.Now().UnixMilli())
	return err
}

func (s *SQLStore) DoDecryptionTxn(ctx context.Context, fn func(context.Context) error) error {
	ctx = context.WithValue(ctx, dbutil.ContextKeyDoTxnCallerSkip, 2)
	return s.DoSessionMutation(ctx, fn)
}

func (s *SQLStore) ClearBufferedEventPlaintext(ctx context.Context, ciphertextHash [32]byte) error {
	_, err := s.exec(ctx, clearBufferedEventPlaintextQuery, s.SessionID, s.RevisionID, ciphertextHash[:])
	return err
}

func (s *SQLStore) DeleteOldBufferedHashes(ctx context.Context) error {
	// The WhatsApp servers only buffer events for 14 days,
	// so we can safely delete anything older than that.
	_, err := s.exec(ctx, deleteOldBufferedHashesQuery, s.SessionID, s.RevisionID, time.Now().Add(-14*24*time.Hour).UnixMilli())
	return err
}

const (
	getOutgoingEventQuery = `
		SELECT format, plaintext FROM whatsapp_retry_buffer WHERE session_id=$1 AND revision_id=$2 AND (chat_jid=$3 OR chat_jid=$4) AND message_id=$5
	`
	addOutgoingEventQuery = `
		INSERT INTO whatsapp_retry_buffer (session_id, revision_id, chat_jid, message_id, format, plaintext, timestamp)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (session_id, revision_id, chat_jid, message_id) DO UPDATE
			SET format=excluded.format, plaintext=excluded.plaintext, timestamp=excluded.timestamp
	`
	deleteOldOutgoingEventsQuery = `
		DELETE FROM whatsapp_retry_buffer WHERE session_id=$1 AND revision_id=$2 AND timestamp < $3
	`
)

func (s *SQLStore) GetOutgoingEvent(ctx context.Context, chatJID, altChatJID types.JID, id types.MessageID) (format string, result []byte, err error) {
	err = s.queryRow(ctx, getOutgoingEventQuery, s.SessionID, s.RevisionID, chatJID, altChatJID, id).Scan(&format, &result)
	return
}

func (s *SQLStore) AddOutgoingEvent(ctx context.Context, chatJID types.JID, id types.MessageID, format string, plaintext []byte) error {
	_, err := s.exec(ctx, addOutgoingEventQuery, s.SessionID, s.RevisionID, chatJID, id, format, plaintext, time.Now().UnixMilli())
	return err
}

func (s *SQLStore) DeleteOldOutgoingEvents(ctx context.Context) error {
	_, err := s.exec(ctx, deleteOldOutgoingEventsQuery, s.SessionID, s.RevisionID, time.Now().Add(-7*24*time.Hour).UnixMilli())
	return err
}
