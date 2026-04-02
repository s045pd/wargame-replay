package index

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

const testDBPath = "../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db"

func TestBuildTimeIndex(t *testing.T) {
	if _, err := os.Stat(testDBPath); err != nil {
		t.Skip("test db not found:", testDBPath)
	}
	db, err := sql.Open("sqlite3", testDBPath+"?mode=ro")
	if err != nil {
		t.Skip("cannot open test db:", err)
	}
	defer db.Close()

	idx, err := BuildTimeIndex(db)
	if err != nil {
		t.Fatal(err)
	}
	if idx.Len() == 0 {
		t.Fatal("empty index")
	}
	t.Logf("Index entries: %d, range: %s to %s", idx.Len(), idx.StartTime(), idx.EndTime())

	// Test lookup
	rowID, found := idx.Lookup("2026-01-17 12:00:00")
	if !found {
		t.Error("lookup failed for valid timestamp")
	}
	if rowID == 0 {
		t.Error("expected non-zero rowID")
	}
}

func TestLRUCache(t *testing.T) {
	c := NewLRUCache(1024) // 1KB limit for test
	c.Put("key1", []byte("hello"))
	val, ok := c.Get("key1")
	if !ok || string(val) != "hello" {
		t.Error("cache miss or wrong value")
	}
	// Fill to evict
	c.Put("key2", make([]byte, 1024))
	_, ok = c.Get("key1")
	if ok {
		t.Error("expected key1 to be evicted")
	}
}
