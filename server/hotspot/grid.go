package hotspot

// Cell holds aggregated per-cell signals.
type Cell struct {
	Row, Col int
	Units    int
	Events   int
	Velocity float64
}

// Grid divides the coordinate space into a rows×cols grid.
type Grid struct {
	Rows, Cols     int
	CellSize       float64
	CellSizeLng    float64
	MinLat, MinLng float64
	Cells          [][]Cell
}

// NewGrid creates a Grid covering [minLat,maxLat] × [minLng,maxLng].
func NewGrid(rows, cols int, minLat, maxLat, minLng, maxLng float64) *Grid {
	latRange := maxLat - minLat
	lngRange := maxLng - minLng
	cellSize := latRange / float64(rows)
	cellSizeLng := lngRange / float64(cols)
	if cellSizeLng == 0 {
		cellSizeLng = cellSize
	}

	g := &Grid{
		Rows:        rows,
		Cols:        cols,
		MinLat:      minLat,
		MinLng:      minLng,
		CellSize:    cellSize,
		CellSizeLng: cellSizeLng,
		Cells:       make([][]Cell, rows),
	}
	for i := range g.Cells {
		g.Cells[i] = make([]Cell, cols)
		for j := range g.Cells[i] {
			g.Cells[i][j] = Cell{Row: i, Col: j}
		}
	}
	return g
}

// Reset zeroes all cell counters without re-allocating.
func (g *Grid) Reset() {
	for i := range g.Cells {
		for j := range g.Cells[i] {
			g.Cells[i][j].Units = 0
			g.Cells[i][j].Events = 0
			g.Cells[i][j].Velocity = 0
		}
	}
}

// AddUnit increments the unit count for the cell containing (lat, lng).
func (g *Grid) AddUnit(lat, lng float64) {
	r, c := g.CellFor(lat, lng)
	if r >= 0 && r < g.Rows && c >= 0 && c < g.Cols {
		g.Cells[r][c].Units++
	}
}

// CellFor returns the (row, col) index for the given coordinate.
func (g *Grid) CellFor(lat, lng float64) (int, int) {
	if g.CellSize == 0 {
		return 0, 0
	}
	r := int((lat - g.MinLat) / g.CellSize)
	c := int((lng - g.MinLng) / g.CellSizeLng)
	return r, c
}

// CellCenter returns the geographic centre of the cell at (r, c).
func (g *Grid) CellCenter(r, c int) (float64, float64) {
	lat := g.MinLat + (float64(r)+0.5)*g.CellSize
	lng := g.MinLng + (float64(c)+0.5)*g.CellSizeLng
	return lat, lng
}
