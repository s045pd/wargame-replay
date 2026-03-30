package decoder

type UnitPosition struct {
	ID       uint8   `json:"id"`
	UnitType uint8   `json:"type"`  // 0=player, 1=special, 2=base
	RawLat   uint32  `json:"-"`
	RawLng   uint32  `json:"-"`
	Lat      float64 `json:"lat,omitempty"`
	Lng      float64 `json:"lng,omitempty"`
	X        float64 `json:"x,omitempty"`
	Y        float64 `json:"y,omitempty"`
	Team     string  `json:"team"`
	Alive    bool    `json:"alive"`
	Flags    []byte  `json:"-"`
	FlagsHex string  `json:"flags"`
}

type GameEvent struct {
	Type   string `json:"type"` // "kill", "hit", "status"
	SrcID  int    `json:"src"`
	DstID  int    `json:"dst,omitempty"`
	Ts     string `json:"ts"`
	Detail string `json:"detail,omitempty"`
}

type CoordMode string

const (
	CoordWGS84    CoordMode = "wgs84"
	CoordRelative CoordMode = "relative"
)
