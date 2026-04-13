package decoder

type UnitClass string

const (
	ClassRifle    UnitClass = "rifle"    // 步枪兵
	ClassMG       UnitClass = "mg"       // 机枪兵
	ClassMedic    UnitClass = "medic"    // 医疗兵
	ClassMarksman UnitClass = "marksman" // 精确射手
	ClassSniper   UnitClass = "sniper"   // 狙击手
)

type UnitPosition struct {
	ID            uint16  `json:"id"`
	RawLat        uint32  `json:"-"`
	RawLng        uint32  `json:"-"`
	Lat           float64 `json:"lat,omitempty"`
	Lng           float64 `json:"lng,omitempty"`
	X             float64 `json:"x,omitempty"`
	Y             float64 `json:"y,omitempty"`
	Team          string  `json:"team"`
	Alive         bool    `json:"alive"`
	HP            int     `json:"hp"`
	Ammo          int     `json:"ammo"`
	Supply        int     `json:"supply"`
	Bandage       int     `json:"bandage"`
	RevivalTokens int     `json:"revivalTokens"`
	Name          string  `json:"name,omitempty"`
	Class         string  `json:"class"`
	Flags         []byte  `json:"-"`
	FlagsHex      string  `json:"flags"`
}

type GameEvent struct {
	Type     string `json:"type"` // "kill", "hit", "score_update"
	SrcID    int    `json:"src"`
	DstID    int    `json:"dst,omitempty"`
	Ts       string `json:"ts"`
	Detail   string `json:"detail,omitempty"`
	HP       int    `json:"hp,omitempty"`       // remaining HP after hit (0=dead)
	SrcName  string `json:"srcName,omitempty"`  // shooter name
	DstName  string `json:"dstName,omitempty"`  // victim name
	SrcClass string `json:"srcClass,omitempty"` // shooter class
	DstClass string `json:"dstClass,omitempty"` // victim class
}

// POIType identifies the type of a battlefield point-of-interest.
type POIType int

const (
	POIBaseCamp     POIType = 1 // 大本营
	POIVehicle      POIType = 2 // 物资车 (mobile)
	POISupplyCache  POIType = 3 // 补给站
	POIControlPoint POIType = 4 // 占领点
	POIStation      POIType = 5 // 兵站
)

// POIObject is a battlefield point-of-interest parsed from DT8 frames.
// Field semantics depend on Type — see DecodeDT8POIs for per-type layout.
type POIObject struct {
	ID       int     `json:"id"`
	Type     POIType `json:"type"`
	Team     int     `json:"team"`     // 0=red, 1=blue, 2=neutral
	Resource int     `json:"resource"` // legacy: byte[13] raw value
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	// Extended fields (type-specific, omitted when zero)
	Health     int `json:"health,omitempty"`     // HP % (type 2=兵站, type 5=防御点)
	Lives      int `json:"lives,omitempty"`      // lives remaining (type 2, 3)
	Supplies   int `json:"supplies,omitempty"`   // supplies remaining (type 2, 3)
	RedPct     int `json:"redPct,omitempty"`     // Red capture % (type 3, 4)
	BluePct    int `json:"bluePct,omitempty"`    // Blue capture % (type 3, 4)
	BuildTimer int `json:"buildTimer,omitempty"` // building remaining secs (type 2)
	HeldTime   int `json:"heldTime,omitempty"`   // held/defended time secs (type 5)
	RedHeld    int `json:"redHeld,omitempty"`    // Red held time secs (type 4)
	BlueHeld   int `json:"blueHeld,omitempty"`   // Blue held time secs (type 4)
}

// Minefield is a polygon zone (typically a quadrilateral) parsed from DT1 SrcType=64 records.
type Minefield struct {
	ID      int         `json:"id"`
	Corners [][2]float64 `json:"corners"` // [[lat, lng], ...] WGS84, 4 corners
}

type CoordMode string

const (
	CoordWGS84    CoordMode = "wgs84"
	CoordRelative CoordMode = "relative"
)
