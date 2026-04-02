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
type POIObject struct {
	ID       int     `json:"id"`
	Type     POIType `json:"type"`
	Team     int     `json:"team"`     // 0=red, 1=blue, 2=neutral
	Resource int     `json:"resource"` // HP / supply / capture progress
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
}

type CoordMode string

const (
	CoordWGS84    CoordMode = "wgs84"
	CoordRelative CoordMode = "relative"
)
