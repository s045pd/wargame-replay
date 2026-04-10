package video

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// Metadata is the subset of mp4 movie header information we consume.
type Metadata struct {
	CreationTime time.Time
	DurationMs   int64
	Codec        string
	Width        int
	Height       int
}

// Parse opens an mp4/mov file and returns the metadata read from its moov box.
//
// The implementation is a minimal ISO/IEC 14496-12 box walker that recognises
// only the containers it needs: ftyp, moov, trak, mdia, minf, stbl and the
// leaf boxes mvhd and stsd.  Unknown boxes are skipped.  The goal is to keep
// the binary dependency-free and auditable, not to be a full mp4 parser.
func Parse(path string) (Metadata, error) {
	f, err := os.Open(path)
	if err != nil {
		return Metadata{}, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return Metadata{}, fmt.Errorf("stat %s: %w", path, err)
	}
	total := fi.Size()

	p := &mp4Parser{r: f, size: total}
	if err := p.parseTopLevel(); err != nil {
		return Metadata{}, err
	}
	if !p.hasMvhd {
		return Metadata{}, errors.New("video: mvhd box not found")
	}
	return p.metadata(), nil
}

// boxHeader represents one box header read from the stream.
type boxHeader struct {
	size     int64 // total box size (header + body); 0 means "extends to end of file"
	headerSz int64 // 8 or 16 (for 64-bit extended size)
	fourcc   string
}

type mp4Parser struct {
	r    io.ReadSeeker
	size int64

	hasMvhd      bool
	creationTime time.Time
	durationMs   int64

	codec       string
	width       int
	height      int
	sawVideoTrk bool
}

// metadata assembles the final result.
func (p *mp4Parser) metadata() Metadata {
	return Metadata{
		CreationTime: p.creationTime,
		DurationMs:   p.durationMs,
		Codec:        p.codec,
		Width:        p.width,
		Height:       p.height,
	}
}

func (p *mp4Parser) parseTopLevel() error {
	var pos int64
	for pos < p.size {
		if _, err := p.r.Seek(pos, io.SeekStart); err != nil {
			return fmt.Errorf("seek top-level %d: %w", pos, err)
		}
		h, err := p.readHeader(pos)
		if err != nil {
			return fmt.Errorf("read top-level header at %d: %w", pos, err)
		}
		if h.size == 0 {
			h.size = p.size - pos
		}
		if h.size < h.headerSz {
			return fmt.Errorf("box %q at %d has invalid size %d", h.fourcc, pos, h.size)
		}

		end := pos + h.size
		bodyStart := pos + h.headerSz
		bodySz := end - bodyStart

		switch h.fourcc {
		case "ftyp":
			// nothing to extract; the presence is enough.
		case "moov":
			if err := p.parseContainer(bodyStart, bodySz, p.handleMoov); err != nil {
				return err
			}
		}

		if end > p.size {
			return fmt.Errorf("box %q overflows file (%d > %d)", h.fourcc, end, p.size)
		}
		pos = end
	}
	return nil
}

type childHandler func(h boxHeader, bodyStart, bodySz int64) error

// parseContainer iterates over child boxes and hands each of them to cb.
// cb decides whether to recurse further or extract data.
func (p *mp4Parser) parseContainer(start, size int64, cb childHandler) error {
	end := start + size
	pos := start
	for pos < end {
		if _, err := p.r.Seek(pos, io.SeekStart); err != nil {
			return fmt.Errorf("seek container %d: %w", pos, err)
		}
		h, err := p.readHeader(pos)
		if err != nil {
			return fmt.Errorf("read child header at %d: %w", pos, err)
		}
		if h.size == 0 {
			h.size = end - pos
		}
		if h.size < h.headerSz || pos+h.size > end {
			return fmt.Errorf("box %q at %d overflows parent (size=%d, parent_end=%d)", h.fourcc, pos, h.size, end)
		}
		bodyStart := pos + h.headerSz
		bodySz := h.size - h.headerSz

		if err := cb(h, bodyStart, bodySz); err != nil {
			return err
		}

		pos += h.size
	}
	return nil
}

func (p *mp4Parser) handleMoov(h boxHeader, bodyStart, bodySz int64) error {
	switch h.fourcc {
	case "mvhd":
		return p.parseMvhd(bodyStart, bodySz)
	case "trak":
		// Stop descending into more traks once we already have a video codec.
		// Most files have one video trak first, but don't rely on that.
		return p.parseContainer(bodyStart, bodySz, p.handleTrak)
	}
	return nil
}

func (p *mp4Parser) handleTrak(h boxHeader, bodyStart, bodySz int64) error {
	if h.fourcc == "mdia" {
		return p.parseContainer(bodyStart, bodySz, p.handleMdia)
	}
	return nil
}

func (p *mp4Parser) handleMdia(h boxHeader, bodyStart, bodySz int64) error {
	if h.fourcc == "minf" {
		return p.parseContainer(bodyStart, bodySz, p.handleMinf)
	}
	return nil
}

func (p *mp4Parser) handleMinf(h boxHeader, bodyStart, bodySz int64) error {
	if h.fourcc == "stbl" {
		return p.parseContainer(bodyStart, bodySz, p.handleStbl)
	}
	return nil
}

func (p *mp4Parser) handleStbl(h boxHeader, bodyStart, bodySz int64) error {
	if h.fourcc == "stsd" {
		return p.parseStsd(bodyStart, bodySz)
	}
	return nil
}

// readHeader reads either an 8-byte or 16-byte box header starting at the
// current read position (caller must have seeked).
func (p *mp4Parser) readHeader(pos int64) (boxHeader, error) {
	var hdr [16]byte
	if _, err := io.ReadFull(p.r, hdr[:8]); err != nil {
		return boxHeader{}, fmt.Errorf("read 8-byte header: %w", err)
	}
	size32 := binary.BigEndian.Uint32(hdr[0:4])
	fourcc := string(hdr[4:8])

	h := boxHeader{
		size:     int64(size32),
		headerSz: 8,
		fourcc:   fourcc,
	}

	if size32 == 1 {
		// extended 64-bit size
		if _, err := io.ReadFull(p.r, hdr[8:16]); err != nil {
			return boxHeader{}, fmt.Errorf("read 16-byte header: %w", err)
		}
		h.size = int64(binary.BigEndian.Uint64(hdr[8:16]))
		h.headerSz = 16
	}
	return h, nil
}

// parseMvhd reads creation_time, timescale and duration from the Movie Header box.
func (p *mp4Parser) parseMvhd(bodyStart, bodySz int64) error {
	if bodySz < 24 {
		return fmt.Errorf("mvhd body too small: %d", bodySz)
	}
	if _, err := p.r.Seek(bodyStart, io.SeekStart); err != nil {
		return fmt.Errorf("seek mvhd: %w", err)
	}

	// Version(1) + Flags(3)
	var vb [4]byte
	if _, err := io.ReadFull(p.r, vb[:]); err != nil {
		return fmt.Errorf("read mvhd version: %w", err)
	}
	version := vb[0]

	var ctime1904 uint64
	var timescale uint32
	var duration uint64

	if version == 1 {
		if bodySz < 4+8+8+4+8 {
			return fmt.Errorf("mvhd v1 body too small: %d", bodySz)
		}
		var buf [28]byte
		if _, err := io.ReadFull(p.r, buf[:]); err != nil {
			return fmt.Errorf("read mvhd v1: %w", err)
		}
		ctime1904 = binary.BigEndian.Uint64(buf[0:8])
		// modification_time at buf[8:16] — unused
		timescale = binary.BigEndian.Uint32(buf[16:20])
		duration = binary.BigEndian.Uint64(buf[20:28])
	} else {
		// version 0: 32-bit times & duration
		if bodySz < 4+4+4+4+4 {
			return fmt.Errorf("mvhd v0 body too small: %d", bodySz)
		}
		var buf [16]byte
		if _, err := io.ReadFull(p.r, buf[:]); err != nil {
			return fmt.Errorf("read mvhd v0: %w", err)
		}
		ctime1904 = uint64(binary.BigEndian.Uint32(buf[0:4]))
		// modification_time at buf[4:8] — unused
		timescale = binary.BigEndian.Uint32(buf[8:12])
		duration = uint64(binary.BigEndian.Uint32(buf[12:16]))
	}

	if timescale == 0 {
		return errors.New("mvhd timescale is zero")
	}

	// Convert from 1904 epoch (seconds since 1904-01-01 00:00:00 UTC) to
	// time.Time. Unix epoch is at 2082844800 seconds past the 1904 epoch.
	const epochOffset = 2082844800
	var creationUnix int64
	if ctime1904 >= epochOffset {
		creationUnix = int64(ctime1904) - epochOffset
	} else {
		// Some devices write the creation_time in the Unix epoch by mistake;
		// tolerate it so we can still surface a value.
		creationUnix = int64(ctime1904)
	}
	p.creationTime = time.Unix(creationUnix, 0).UTC()
	p.durationMs = int64(duration) * 1000 / int64(timescale)
	p.hasMvhd = true
	return nil
}

// parseStsd extracts the first video sample entry from the Sample Description box.
// The first recognised video sample entry wins — mp4 files with multiple video
// traks are rare in wargame footage and Phase 1 only needs one.
func (p *mp4Parser) parseStsd(bodyStart, bodySz int64) error {
	if p.codec != "" {
		return nil
	}
	if bodySz < 8 {
		return nil
	}
	if _, err := p.r.Seek(bodyStart, io.SeekStart); err != nil {
		return fmt.Errorf("seek stsd: %w", err)
	}

	// stsd full box: version(1) + flags(3) + entry_count(4)
	var hdr [8]byte
	if _, err := io.ReadFull(p.r, hdr[:]); err != nil {
		return fmt.Errorf("read stsd header: %w", err)
	}
	entryCount := binary.BigEndian.Uint32(hdr[4:8])

	pos := bodyStart + 8
	bodyEnd := bodyStart + bodySz
	for i := uint32(0); i < entryCount && pos < bodyEnd; i++ {
		if _, err := p.r.Seek(pos, io.SeekStart); err != nil {
			return fmt.Errorf("seek stsd entry %d: %w", i, err)
		}
		h, err := p.readHeader(pos)
		if err != nil {
			return fmt.Errorf("read stsd entry header %d: %w", i, err)
		}
		if h.size < h.headerSz || pos+h.size > bodyEnd {
			return nil
		}
		codec := codecFromFourcc(h.fourcc)
		if codec == "" {
			pos += h.size
			continue
		}

		// VisualSampleEntry body layout after the box header:
		//   6 reserved                  (ends at +6)
		//   2 data_reference_index      (ends at +8)
		//   2 pre_defined               (ends at +10)
		//   2 reserved                  (ends at +12)
		//   12 pre_defined              (ends at +24)
		//   2 width                     (ends at +26)
		//   2 height                    (ends at +28)
		bodyOffset := pos + h.headerSz
		if _, err := p.r.Seek(bodyOffset+24, io.SeekStart); err != nil {
			return fmt.Errorf("seek visual sample entry body: %w", err)
		}
		var wh [4]byte
		if _, err := io.ReadFull(p.r, wh[:]); err != nil {
			return fmt.Errorf("read width/height: %w", err)
		}
		p.codec = codec
		p.width = int(binary.BigEndian.Uint16(wh[0:2]))
		p.height = int(binary.BigEndian.Uint16(wh[2:4]))
		p.sawVideoTrk = true
		return nil
	}
	return nil
}

// codecFromFourcc maps a VisualSampleEntry fourcc to the friendly codec name.
// Unknown fourccs return "".
func codecFromFourcc(fourcc string) string {
	switch strings.ToLower(fourcc) {
	case "avc1", "avc3":
		return "h264"
	case "hev1", "hvc1":
		return "hevc"
	case "vp09", "vp9 ":
		return "vp9"
	case "av01":
		return "av1"
	}
	return ""
}
