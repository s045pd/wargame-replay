package decoder

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

const testDBPath = "../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db"

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	if _, err := os.Stat(testDBPath); err != nil {
		t.Skip("test db not found:", testDBPath)
	}
	db, err := sql.Open("sqlite3", testDBPath+"?mode=ro")
	if err != nil {
		t.Skip("cannot open test db:", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		t.Skip("cannot ping test db:", err)
	}
	return db
}

func TestRelativeCoords(t *testing.T) {
	resolver := NewRelativeResolver(200000000, 220000000, 280000000, 300000000)
	lat, lng := resolver.Convert(210000000, 290000000)
	if lat < 0 || lat > 1 || lng < 0 || lng > 1 {
		t.Errorf("relative coords out of range: %f, %f", lat, lng)
	}
}

func TestResolverFromDB(t *testing.T) {
	db := openTestDB(t)
	defer db.Close()

	resolver, mode, err := AutoDetectCoords(db, testDBPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Detected coord mode: %s", mode)

	if resolver == nil {
		t.Fatal("resolver is nil")
	}
	// Test with a known raw coordinate
	lat, lng := resolver.Convert(210719404, 294449177)
	t.Logf("Converted: lat=%f, lng=%f", lat, lng)
	if mode == CoordRelative {
		if lat < 0 || lat > 1 {
			t.Errorf("relative lat out of range: %f", lat)
		}
	}
}
