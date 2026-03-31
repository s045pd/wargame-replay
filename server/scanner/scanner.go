package scanner

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

type GameInfo struct {
	ID          string `json:"id"`
	Session     string `json:"session"`
	StartTime   string `json:"startTime"`
	EndTime     string `json:"endTime"`
	PlayerCount int    `json:"playerCount"`
	Filename    string `json:"filename"`
	FilePath    string `json:"-"`
	DisplayName string `json:"displayName"`
}

var filenameRe = regexp.MustCompile(`^(\w+)_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.db$`)

func ParseFilename(filename string) (*GameInfo, error) {
	m := filenameRe.FindStringSubmatch(filename)
	if m == nil {
		return nil, fmt.Errorf("filename %q does not match expected pattern", filename)
	}
	name := strings.TrimSuffix(filename, ".db")
	hash := sha256.Sum256([]byte(name))
	id := fmt.Sprintf("%x", hash[:4])

	startTime := formatTimestamp(m[2])
	endTime := formatTimestamp(m[3])

	return &GameInfo{
		ID:          id,
		Session:     m[1],
		StartTime:   startTime,
		EndTime:     endTime,
		Filename:    filename,
		DisplayName: fmt.Sprintf("Session %s · %s ~ %s", m[1], startTime[:16], endTime[11:16]),
	}, nil
}

func formatTimestamp(s string) string {
	// "2026-01-17-11-40-00" → "2026-01-17 11:40:00"
	parts := strings.SplitN(s, "-", 4) // ["2026", "01", "17", "11-40-00"]
	if len(parts) < 4 {
		return s
	}
	timePart := strings.Replace(parts[3], "-", ":", -1)
	return fmt.Sprintf("%s-%s-%s %s", parts[0], parts[1], parts[2], timePart)
}

func ScanDirectory(dir string) ([]GameInfo, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var games []GameInfo
	seen := map[string]int{} // id collision tracking
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".db") {
			continue
		}
		info, err := ParseFilename(e.Name())
		if err != nil {
			continue
		}
		if n, exists := seen[info.ID]; exists {
			info.ID = fmt.Sprintf("%s-%d", info.ID, n+1)
			seen[info.ID] = n + 1
		} else {
			seen[info.ID] = 0
		}
		info.FilePath = filepath.Join(dir, e.Name())

		// Read player count from tag table
		playerCount, _ := ReadPlayerCount(info.FilePath)
		info.PlayerCount = playerCount

		games = append(games, *info)
	}
	return games, nil
}

// ReadPlayerCount opens the database at dbPath and returns the distinct player count.
func ReadPlayerCount(dbPath string) (int, error) {
	db, err := sql.Open("sqlite3", dbPath+"?mode=ro")
	if err != nil {
		return 0, err
	}
	defer db.Close()
	var count int
	err = db.QueryRow("SELECT COUNT(DISTINCT SrcIndex) FROM tag WHERE SrcType=1 AND TagText <> ''").Scan(&count)
	return count, err
}
