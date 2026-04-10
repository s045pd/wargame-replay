package video

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"
)

// SidecarPath returns the JSON sidecar path for a given .db file.
func SidecarPath(dbPath string) string {
	return dbPath + SidecarSuffix
}

// LoadSidecar reads the groups for a given .db file. A missing file is not
// an error: the caller gets an empty slice and can treat that as "no videos
// associated yet".
func LoadSidecar(dbPath string) ([]VideoGroup, error) {
	path := SidecarPath(dbPath)
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read sidecar %s: %w", path, err)
	}
	if len(data) == 0 {
		return nil, nil
	}
	var env sidecarEnvelope
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, fmt.Errorf("parse sidecar %s: %w", path, err)
	}
	if env.Groups == nil {
		return nil, nil
	}
	return env.Groups, nil
}

// SaveSidecar writes groups for a given .db file atomically. If groups is
// empty, the sidecar file is removed instead of written.
func SaveSidecar(dbPath string, gameID string, groups []VideoGroup) error {
	path := SidecarPath(dbPath)

	if len(groups) == 0 {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove empty sidecar %s: %w", path, err)
		}
		return nil
	}

	env := sidecarEnvelope{
		Version: SidecarVersion,
		GameID:  gameID,
		Groups:  groups,
	}
	data, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal sidecar: %w", err)
	}

	tmp := path + ".uploading"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("write sidecar tmp %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename sidecar tmp %s: %w", tmp, err)
	}
	return nil
}

// AddGroup appends a new group to the sidecar. If g.ID is empty, a uuid is
// generated. CreatedAt / UpdatedAt are set to the current time.
func AddGroup(dbPath, gameID string, g VideoGroup) (VideoGroup, error) {
	existing, err := LoadSidecar(dbPath)
	if err != nil {
		return VideoGroup{}, err
	}
	if g.ID == "" {
		id, err := newUUIDv4()
		if err != nil {
			return VideoGroup{}, err
		}
		g.ID = id
	}
	now := time.Now().UTC()
	if g.CreatedAt.IsZero() {
		g.CreatedAt = now
	}
	g.UpdatedAt = now

	existing = append(existing, g)
	if err := SaveSidecar(dbPath, gameID, existing); err != nil {
		return VideoGroup{}, err
	}
	return g, nil
}

// UpdateGroup applies a mutating callback to the group whose ID matches
// groupID. Returns an error if the group is not found.
func UpdateGroup(dbPath, gameID, groupID string, patch func(*VideoGroup)) error {
	existing, err := LoadSidecar(dbPath)
	if err != nil {
		return err
	}
	idx := -1
	for i := range existing {
		if existing[i].ID == groupID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return fmt.Errorf("group %s not found", groupID)
	}
	patch(&existing[idx])
	existing[idx].UpdatedAt = time.Now().UTC()
	return SaveSidecar(dbPath, gameID, existing)
}

// DeleteGroup removes one group from the sidecar. If the last group is
// removed, the sidecar file itself is deleted.
func DeleteGroup(dbPath, gameID, groupID string) error {
	existing, err := LoadSidecar(dbPath)
	if err != nil {
		return err
	}
	out := existing[:0]
	found := false
	for _, g := range existing {
		if g.ID == groupID {
			found = true
			continue
		}
		out = append(out, g)
	}
	if !found {
		return fmt.Errorf("group %s not found", groupID)
	}
	return SaveSidecar(dbPath, gameID, out)
}

// newUUIDv4 returns a random UUID v4 string ("8-4-4-4-12").
// crypto/rand is intentional — sidecar IDs must not collide across concurrent
// writes.
func newUUIDv4() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("uuid rand: %w", err)
	}
	// RFC 4122 fields:
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant RFC 4122
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	), nil
}
