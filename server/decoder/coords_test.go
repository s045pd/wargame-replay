package decoder

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestRelativeCoords(t *testing.T) {
	resolver := NewRelativeResolver(200000000, 220000000, 280000000, 300000000)
	lat, lng := resolver.Convert(210000000, 290000000)
	if lat < 0 || lat > 1 || lng < 0 || lng > 1 {
		t.Errorf("relative coords out of range: %f, %f", lat, lng)
	}
}

func TestResolverFromDB(t *testing.T) {
	db, err := sql.Open("sqlite3", "../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db?mode=ro")
	if err != nil {
		t.Skip("test db not found")
	}
	defer db.Close()

	resolver, mode, err := AutoDetectCoords(db, "../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db")
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
