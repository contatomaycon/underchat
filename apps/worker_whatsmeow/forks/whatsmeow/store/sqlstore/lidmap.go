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
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"

	"go.mau.fi/util/dbutil"
	"go.mau.fi/util/exslices"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

type CachedLIDMap struct {
	container  *Container
	db         *dbutil.Database
	sessionID  string
	revisionID int64

	pnToLIDCache map[string]string
	lidToPNCache map[string]string
	cacheFilled  bool
	lidCacheLock sync.RWMutex
}

var _ store.LIDStore = (*CachedLIDMap)(nil)

func NewCachedLIDMap(container *Container, sessionID string, revisionID int64) *CachedLIDMap {
	return &CachedLIDMap{
		container:  container,
		db:         container.db,
		sessionID:  sessionID,
		revisionID: revisionID,

		pnToLIDCache: make(map[string]string),
		lidToPNCache: make(map[string]string),
	}
}

func (s *CachedLIDMap) doSessionOperation(ctx context.Context, fn func(context.Context) error) error {
	return s.container.doSessionOperation(ctx, SessionScope{SessionID: s.sessionID, RevisionID: s.revisionID}, fn)
}

func (s *CachedLIDMap) doSessionMutation(ctx context.Context, fn func(context.Context) error) error {
	return s.container.doSessionMutation(ctx, SessionScope{SessionID: s.sessionID, RevisionID: s.revisionID}, fn)
}

const (
	deleteExistingLIDMappingQuery = `DELETE FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND lid<>$3 AND pn=$4`
	putLIDMappingQuery            = `
		INSERT INTO whatsapp_lid_map (session_id, revision_id, lid, pn)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (session_id, revision_id, lid) DO UPDATE SET pn=excluded.pn
		WHERE whatsapp_lid_map.pn<>excluded.pn
	`
	getLIDForPNQuery       = `SELECT lid FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND pn=$3`
	getPNForLIDQuery       = `SELECT pn FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND lid=$3`
	getAllLIDMappingsQuery = `SELECT lid, pn FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2`
)

var convertLIDRow = dbutil.ConvertRowFn[store.LIDMapping](func(rows dbutil.Scannable) (store.LIDMapping, error) {
	var lidUser, pnUser string
	err := rows.Scan(&lidUser, &pnUser)
	if err != nil {
		return store.LIDMapping{}, err
	}
	return store.LIDMapping{
		LID: types.JID{User: lidUser, Server: types.DefaultUserServer},
		PN:  types.JID{User: pnUser, Server: types.DefaultUserServer},
	}, nil
})

func (s *CachedLIDMap) FillCache(ctx context.Context) error {
	s.lidCacheLock.Lock()
	defer s.lidCacheLock.Unlock()
	err := s.doSessionOperation(ctx, func(txCtx context.Context) error {
		res := convertLIDRow.NewRowIter(s.db.Query(txCtx, getAllLIDMappingsQuery, s.sessionID, s.revisionID))
		return s.scanManyLids(res, nil)
	})
	s.cacheFilled = err == nil
	return err
}

func (s *CachedLIDMap) scanManyLids(res dbutil.RowIter[store.LIDMapping], fn func(lid, pn string)) error {
	return res.Iter(func(mapping store.LIDMapping) (bool, error) {
		s.pnToLIDCache[mapping.PN.User] = mapping.LID.User
		s.lidToPNCache[mapping.LID.User] = mapping.PN.User
		if fn != nil {
			fn(mapping.LID.User, mapping.PN.User)
		}
		return true, nil
	})
}

func (s *CachedLIDMap) getLIDMapping(ctx context.Context, source types.JID, targetServer, query string, sourceToTarget, targetToSource map[string]string) (types.JID, error) {
	s.lidCacheLock.RLock()
	targetUser, ok := sourceToTarget[source.User]
	cacheFilled := s.cacheFilled
	s.lidCacheLock.RUnlock()
	if ok || cacheFilled {
		if targetUser == "" {
			return types.JID{}, nil
		}
		return types.JID{User: targetUser, Device: source.Device, Server: targetServer}, nil
	}
	s.lidCacheLock.Lock()
	defer s.lidCacheLock.Unlock()
	err := s.doSessionOperation(ctx, func(txCtx context.Context) error {
		return s.db.QueryRow(txCtx, query, s.sessionID, s.revisionID, source.User).Scan(&targetUser)
	})
	if errors.Is(err, sql.ErrNoRows) {
		// continue with empty result
	} else if err != nil {
		return types.JID{}, err
	}
	sourceToTarget[source.User] = targetUser
	if targetUser != "" {
		targetToSource[targetUser] = source.User
		return types.JID{User: targetUser, Device: source.Device, Server: targetServer}, nil
	}
	return types.JID{}, nil
}

func (s *CachedLIDMap) GetLIDForPN(ctx context.Context, pn types.JID) (types.JID, error) {
	if pn.Server != types.DefaultUserServer {
		return types.JID{}, fmt.Errorf("invalid GetLIDForPN call with non-PN JID %s", pn)
	}
	return s.getLIDMapping(
		ctx, pn, types.HiddenUserServer, getLIDForPNQuery,
		s.pnToLIDCache, s.lidToPNCache,
	)
}

func (s *CachedLIDMap) GetPNForLID(ctx context.Context, lid types.JID) (types.JID, error) {
	if lid.Server != types.HiddenUserServer {
		return types.JID{}, fmt.Errorf("invalid GetPNForLID call with non-LID JID %s", lid)
	}
	return s.getLIDMapping(
		ctx, lid, types.DefaultUserServer, getPNForLIDQuery,
		s.lidToPNCache, s.pnToLIDCache,
	)
}

func (s *CachedLIDMap) GetManyLIDsForPNs(ctx context.Context, pns []types.JID) (map[types.JID]types.JID, error) {
	if len(pns) == 0 {
		return nil, nil
	}

	result := make(map[types.JID]types.JID, len(pns))

	s.lidCacheLock.RLock()
	missingPNs := make([]string, 0, len(pns))
	missingPNDevices := make(map[string][]types.JID)
	for _, pn := range pns {
		if pn.Server != types.DefaultUserServer {
			continue
		}
		if lidUser, ok := s.pnToLIDCache[pn.User]; ok && lidUser != "" {
			result[pn] = types.JID{User: lidUser, Device: pn.Device, Server: types.HiddenUserServer}
		} else if !s.cacheFilled {
			missingPNs = append(missingPNs, pn.User)
			missingPNDevices[pn.User] = append(missingPNDevices[pn.User], pn)
		}
	}
	s.lidCacheLock.RUnlock()

	if len(missingPNs) == 0 {
		return result, nil
	}

	s.lidCacheLock.Lock()
	defer s.lidCacheLock.Unlock()

	err := s.doSessionOperation(ctx, func(txCtx context.Context) error {
		var res dbutil.RowIter[store.LIDMapping]
		if s.db.Dialect == dbutil.Postgres && PostgresArrayWrapper != nil {
			res = convertLIDRow.NewRowIter(s.db.Query(
				txCtx,
				`SELECT lid, pn FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND pn = ANY($3)`,
				s.sessionID,
				s.revisionID,
				PostgresArrayWrapper(missingPNs),
			))
		} else {
			placeholders := make([]string, len(missingPNs))
			for i := range missingPNs {
				placeholders[i] = fmt.Sprintf("$%d", i+3)
			}
			args := make([]any, 0, len(missingPNs)+2)
			args = append(args, s.sessionID, s.revisionID)
			args = append(args, exslices.CastToAny(missingPNs)...)
			res = convertLIDRow.NewRowIter(s.db.Query(
				txCtx,
				fmt.Sprintf(`SELECT lid, pn FROM whatsapp_lid_map WHERE session_id=$1 AND revision_id=$2 AND pn IN (%s)`, strings.Join(placeholders, ",")),
				args...,
			))
		}
		return s.scanManyLids(res, func(lid, pn string) {
			for _, dev := range missingPNDevices[pn] {
				lidDev := dev
				lidDev.Server = types.HiddenUserServer
				lidDev.User = lid
				result[dev] = lidDev.ToNonAD()
			}
		})
	})
	return result, err
}

func (s *CachedLIDMap) PutLIDMapping(ctx context.Context, lid, pn types.JID) error {
	if lid.Server != types.HiddenUserServer || pn.Server != types.DefaultUserServer {
		return fmt.Errorf("invalid PutLIDMapping call %s/%s", lid, pn)
	}
	s.lidCacheLock.Lock()
	defer s.lidCacheLock.Unlock()
	cachedLID, ok := s.pnToLIDCache[pn.User]
	if ok && cachedLID == lid.User {
		return nil
	}
	return s.doSessionMutation(ctx, func(ctx context.Context) error {
		return s.unlockedPutLIDMapping(ctx, lid, pn)
	})
}

func (s *CachedLIDMap) PutManyLIDMappings(ctx context.Context, mappings []store.LIDMapping) error {
	s.lidCacheLock.Lock()
	defer s.lidCacheLock.Unlock()
	mappings = slices.DeleteFunc(mappings, func(mapping store.LIDMapping) bool {
		if mapping.LID.Server != types.HiddenUserServer || mapping.PN.Server != types.DefaultUserServer {
			s.container.logSessionDebug("debug", "lid_mapping_ignored", SessionScope{
				SessionID: s.sessionID, RevisionID: s.revisionID,
			}, map[string]any{"reason": "invalid_server"})
			return true
		}
		cachedLID, ok := s.pnToLIDCache[mapping.PN.User]
		if ok && cachedLID == mapping.LID.User {
			return true
		}
		return false
	})
	mappings = exslices.DeduplicateUnsortedOverwrite(mappings)
	if len(mappings) == 0 {
		return nil
	}
	return s.doSessionMutation(ctx, func(ctx context.Context) error {
		for _, mapping := range mappings {
			err := s.unlockedPutLIDMapping(ctx, mapping.LID, mapping.PN)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *CachedLIDMap) unlockedPutLIDMapping(ctx context.Context, lid, pn types.JID) error {
	if lid.Server != types.HiddenUserServer || pn.Server != types.DefaultUserServer {
		return fmt.Errorf("invalid PutLIDMapping call %s/%s", lid, pn)
	}
	_, err := s.db.Exec(ctx, deleteExistingLIDMappingQuery, s.sessionID, s.revisionID, lid.User, pn.User)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, putLIDMappingQuery, s.sessionID, s.revisionID, lid.User, pn.User)
	if err != nil {
		return err
	}
	oldLID := s.pnToLIDCache[pn.User]
	oldPN := s.lidToPNCache[lid.User]
	s.pnToLIDCache[pn.User] = lid.User
	s.lidToPNCache[lid.User] = pn.User
	if oldPN != "" && oldPN != pn.User && s.pnToLIDCache[oldPN] == lid.User {
		delete(s.pnToLIDCache, oldPN)
	}
	if oldLID != "" && oldLID != lid.User && s.lidToPNCache[oldLID] == pn.User {
		delete(s.lidToPNCache, oldLID)
	}
	return nil
}

// Invalidate clears all positive and negative cache entries. Callers must use
// this on handoff, logout and lease loss before reusing a store instance.
func (s *CachedLIDMap) Invalidate() {
	s.lidCacheLock.Lock()
	defer s.lidCacheLock.Unlock()
	s.pnToLIDCache = make(map[string]string)
	s.lidToPNCache = make(map[string]string)
	s.cacheFilled = false
}

func (s *CachedLIDMap) InvalidateCaches() {
	s.Invalidate()
}
