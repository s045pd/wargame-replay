package video

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// proxyDirName is the hidden directory under dataDir where pre-transcoded
// H.264 proxy files are stored. Each proxy is named by the SHA-256 hash
// of its source absolute path so there is no ambiguity.
const proxyDirName = ".video-proxies"

// ProxyStatus describes the state of a proxy transcoding job.
type ProxyStatus struct {
	State    string  `json:"state"`    // "none" | "queued" | "running" | "done" | "error"
	Progress float64 `json:"progress"` // 0..100 (only meaningful when running)
	Error    string  `json:"error,omitempty"`
	Path     string  `json:"path,omitempty"` // proxy file path when done
}

// ProxyManager handles background ffmpeg transcoding of HEVC segments
// into H.264 proxy files. It is safe for concurrent use.
type ProxyManager struct {
	dataDir string
	mu      sync.Mutex
	jobs    map[string]*proxyJob // key: source absPath
}

type proxyJob struct {
	state    string
	progress float64
	err      string
	cancel   context.CancelFunc
}

// NewProxyManager returns a ProxyManager that stores proxies under
// {dataDir}/.video-proxies/.
func NewProxyManager(dataDir string) *ProxyManager {
	dir := filepath.Join(dataDir, proxyDirName)
	_ = os.MkdirAll(dir, 0o755)
	return &ProxyManager{
		dataDir: dataDir,
		jobs:    make(map[string]*proxyJob),
	}
}

// ProxyPath returns the expected proxy file path for a given source.
func (pm *ProxyManager) ProxyPath(srcAbsPath string) string {
	h := sha256.Sum256([]byte(srcAbsPath))
	name := hex.EncodeToString(h[:16]) + ".mp4"
	return filepath.Join(pm.dataDir, proxyDirName, name)
}

// HasProxy reports whether a completed proxy file exists for srcAbsPath.
func (pm *ProxyManager) HasProxy(srcAbsPath string) bool {
	p := pm.ProxyPath(srcAbsPath)
	info, err := os.Stat(p)
	return err == nil && !info.IsDir() && info.Size() > 0
}

// Status returns the current proxy status for a source file.
func (pm *ProxyManager) Status(srcAbsPath string) ProxyStatus {
	pm.mu.Lock()
	job, ok := pm.jobs[srcAbsPath]
	pm.mu.Unlock()

	if pm.HasProxy(srcAbsPath) {
		return ProxyStatus{State: "done", Progress: 100, Path: pm.ProxyPath(srcAbsPath)}
	}
	if !ok {
		return ProxyStatus{State: "none"}
	}
	pm.mu.Lock()
	defer pm.mu.Unlock()
	return ProxyStatus{
		State:    job.state,
		Progress: job.progress,
		Error:    job.err,
	}
}

// StartProxy queues a background ffmpeg transcoding job. If one is
// already running or done, this is a no-op. Returns the proxy status.
func (pm *ProxyManager) StartProxy(srcAbsPath string, durationMs int64) (ProxyStatus, error) {
	if pm.HasProxy(srcAbsPath) {
		return ProxyStatus{State: "done", Progress: 100, Path: pm.ProxyPath(srcAbsPath)}, nil
	}

	pm.mu.Lock()
	if existing, ok := pm.jobs[srcAbsPath]; ok {
		if existing.state == "running" || existing.state == "queued" {
			pm.mu.Unlock()
			return ProxyStatus{State: existing.state, Progress: existing.progress}, nil
		}
	}

	ffmpegBin, err := exec.LookPath("ffmpeg")
	if err != nil {
		pm.mu.Unlock()
		return ProxyStatus{}, fmt.Errorf("ffmpeg not found: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	job := &proxyJob{state: "queued", cancel: cancel}
	pm.jobs[srcAbsPath] = job
	pm.mu.Unlock()

	proxyPath := pm.ProxyPath(srcAbsPath)
	tmpPath := strings.TrimSuffix(proxyPath, ".mp4") + ".transcoding.mp4"

	go pm.runTranscode(ctx, ffmpegBin, srcAbsPath, tmpPath, proxyPath, durationMs, job)

	return ProxyStatus{State: "queued"}, nil
}

// CancelProxy stops a running transcoding job.
func (pm *ProxyManager) CancelProxy(srcAbsPath string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	if job, ok := pm.jobs[srcAbsPath]; ok && job.cancel != nil {
		job.cancel()
		job.state = "error"
		job.err = "cancelled"
	}
}

func (pm *ProxyManager) runTranscode(
	ctx context.Context,
	ffmpegBin, srcPath, tmpPath, proxyPath string,
	durationMs int64,
	job *proxyJob,
) {
	pm.mu.Lock()
	job.state = "running"
	pm.mu.Unlock()

	defer func() {
		_ = os.Remove(tmpPath)
	}()

	// Use hardware encoder if available (detected at import time by
	// the stream handler's hwEncodeArgs). Here we just try videotoolbox
	// first and fall back to libx264.
	videoArgs := []string{"-c:v", "libx264", "-preset", "fast", "-crf", "23"}
	// Try hardware encoder
	testCmd := exec.Command(ffmpegBin,
		"-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "color=black:size=64x64:rate=1",
		"-frames:v", "1", "-c:v", "h264_videotoolbox", "-f", "null", "-",
	)
	if testCmd.Run() == nil {
		videoArgs = []string{"-c:v", "h264_videotoolbox", "-b:v", "8M"}
	}

	// Write progress to a temp file that we poll, instead of piping
	// stderr (which can deadlock when ffmpeg writes both progress and
	// errors to the same fd and the pipe buffer fills up).
	progressFile := tmpPath + ".progress"
	defer os.Remove(progressFile)

	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-progress", progressFile, "-stats_period", "2",
		"-i", srcPath,
		"-vf", "scale=-2:720",
	}
	args = append(args, videoArgs...)
	args = append(args,
		"-c:a", "aac", "-b:a", "128k",
		"-movflags", "+faststart",
		"-y", tmpPath,
	)

	cmd := exec.CommandContext(ctx, ffmpegBin, args...)
	var stderrBuf strings.Builder
	cmd.Stderr = &stderrBuf
	cmd.Stdout = nil

	if err := cmd.Start(); err != nil {
		pm.setJobError(job, fmt.Sprintf("start: %v", err))
		return
	}

	// Poll the progress file every 2 seconds.
	stopPoll := make(chan struct{})
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopPoll:
				return
			case <-ticker.C:
				data, err := os.ReadFile(progressFile)
				if err == nil {
					pm.parseProgress(job, string(data), durationMs)
				}
			}
		}
	}()

	close(stopPoll)

	if err := cmd.Wait(); err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			pm.setJobError(job, "cancelled")
		} else {
			errMsg := stderrBuf.String()
			if len(errMsg) > 500 {
				errMsg = errMsg[:500]
			}
			log.Printf("video: proxy ffmpeg failed for %s: %v\nstderr: %s", filepath.Base(srcPath), err, errMsg)
			pm.setJobError(job, fmt.Sprintf("ffmpeg: %v", err))
		}
		return
	}

	// Atomic rename: tmp → final
	if err := os.Rename(tmpPath, proxyPath); err != nil {
		pm.setJobError(job, fmt.Sprintf("rename: %v", err))
		return
	}

	pm.mu.Lock()
	job.state = "done"
	job.progress = 100
	pm.mu.Unlock()
	log.Printf("video: proxy done %s → %s", filepath.Base(srcPath), filepath.Base(proxyPath))
}

// outTimeRe matches both "out_time_ms=N" (ffmpeg ≤7) and
// "out_time_us=N" (ffmpeg 8+).
var outTimeRe = regexp.MustCompile(`out_time_(?:ms|us)=(\d+)`)

func (pm *ProxyManager) parseProgress(job *proxyJob, output string, totalDurationMs int64) {
	if totalDurationMs <= 0 {
		return
	}
	matches := outTimeRe.FindAllStringSubmatch(output, -1)
	if len(matches) == 0 {
		return
	}
	last := matches[len(matches)-1]
	if len(last) < 2 {
		return
	}
	val, err := strconv.ParseInt(last[1], 10, 64)
	if err != nil {
		return
	}
	// Heuristic: if value > totalDurationMs * 10000, it's microseconds.
	var ms int64
	if val > totalDurationMs*1000 {
		ms = val / 1000 // microseconds → milliseconds
	} else {
		ms = val // already milliseconds
	}
	pct := float64(ms) / float64(totalDurationMs) * 100
	if pct > 100 {
		pct = 100
	}
	if pct < 0 {
		pct = 0
	}
	pm.mu.Lock()
	job.progress = pct
	pm.mu.Unlock()
}

func (pm *ProxyManager) setJobError(job *proxyJob, msg string) {
	pm.mu.Lock()
	job.state = "error"
	job.err = msg
	pm.mu.Unlock()
}

// ProxyDir returns the proxy storage directory path.
func (pm *ProxyManager) ProxyDir() string {
	return filepath.Join(pm.dataDir, proxyDirName)
}

// CleanOrphanedProxies removes proxy files that no longer have a
// corresponding source in the index. Called during scan.
func (pm *ProxyManager) CleanOrphanedProxies(index *Index) {
	dir := pm.ProxyDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	// Build a set of expected proxy hashes from the index.
	expectedHashes := make(map[string]struct{})
	for _, e := range index.Entries() {
		h := sha256.Sum256([]byte(e.AbsPath))
		expectedHashes[hex.EncodeToString(h[:16])] = struct{}{}
	}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".mp4") {
			continue
		}
		hash := strings.TrimSuffix(name, ".mp4")
		if _, ok := expectedHashes[hash]; !ok {
			_ = os.Remove(filepath.Join(dir, name))
			log.Printf("video: cleaned orphaned proxy %s", name)
		}
	}
}

// RunningCount returns how many proxy jobs are currently running.
func (pm *ProxyManager) RunningCount() int {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	count := 0
	for _, j := range pm.jobs {
		if j.state == "running" {
			count++
		}
	}
	return count
}

// AllStatuses returns the proxy status for every source that has been
// requested or is done.
func (pm *ProxyManager) AllStatuses() map[string]ProxyStatus {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	out := make(map[string]ProxyStatus, len(pm.jobs))
	for src, job := range pm.jobs {
		s := ProxyStatus{State: job.state, Progress: job.progress, Error: job.err}
		if job.state == "done" {
			s.Path = pm.ProxyPath(src)
		}
		out[src] = s
	}
	return out
}

// StartBatch starts proxy transcoding for multiple source files at once.
// Already-done or already-running sources are skipped. concurrency limits
// simultaneous ffmpeg processes.
func (pm *ProxyManager) StartBatch(sources []struct{ AbsPath string; DurationMs int64 }, concurrency int) {
	if concurrency <= 0 {
		concurrency = 2
	}
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for _, s := range sources {
		if pm.HasProxy(s.AbsPath) {
			continue
		}
		st := pm.Status(s.AbsPath)
		if st.State == "running" || st.State == "queued" {
			continue
		}
		sem <- struct{}{}
		wg.Add(1)
		go func(abs string, dur int64) {
			defer func() { <-sem; wg.Done() }()
			if _, err := pm.StartProxy(abs, dur); err != nil {
				log.Printf("video: batch proxy start %s: %v", filepath.Base(abs), err)
			}
			// Wait for completion (poll).
			for {
				st := pm.Status(abs)
				if st.State == "done" || st.State == "error" || st.State == "none" {
					break
				}
				time.Sleep(500 * time.Millisecond)
			}
		}(s.AbsPath, s.DurationMs)
	}
	go func() {
		wg.Wait()
		log.Printf("video: batch proxy complete")
	}()
}
