package game

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"sync"
	"wargame-replay/server/decoder"
)

// UnitClassConfig maps unit IDs to their class.
// Stored as a JSON sidecar file: <dbname>_classes.json
type UnitClassConfig struct {
	mu       sync.RWMutex
	classes  map[int]decoder.UnitClass
	filePath string
}

func classConfigPath(dbPath string) string {
	return strings.TrimSuffix(dbPath, ".db") + "_classes.json"
}

func LoadUnitClassConfig(dbPath string) *UnitClassConfig {
	cfg := &UnitClassConfig{
		classes:  make(map[int]decoder.UnitClass),
		filePath: classConfigPath(dbPath),
	}
	data, err := os.ReadFile(cfg.filePath)
	if err != nil {
		return cfg // no config file, all units default to rifle
	}
	// JSON format: {"0": "rifle", "506": "sniper", ...}
	var raw map[string]string
	if err := json.Unmarshal(data, &raw); err != nil {
		return cfg
	}
	for idStr, cls := range raw {
		id, err := strconv.Atoi(idStr)
		if err != nil {
			continue
		}
		cfg.classes[id] = decoder.UnitClass(cls)
	}
	return cfg
}

func (c *UnitClassConfig) Get(unitID int) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if cls, ok := c.classes[unitID]; ok {
		return string(cls)
	}
	return string(decoder.ClassRifle)
}

func (c *UnitClassConfig) GetAll() map[string]string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := make(map[string]string, len(c.classes))
	for id, cls := range c.classes {
		result[strconv.Itoa(id)] = string(cls)
	}
	return result
}

func (c *UnitClassConfig) Set(unitID int, class decoder.UnitClass) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if class == decoder.ClassRifle {
		delete(c.classes, unitID) // rifle is default, no need to store
	} else {
		c.classes[unitID] = class
	}
}

func (c *UnitClassConfig) SetBatch(classes map[string]string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.classes = make(map[int]decoder.UnitClass)
	for idStr, cls := range classes {
		id, err := strconv.Atoi(idStr)
		if err != nil {
			continue
		}
		if decoder.UnitClass(cls) != decoder.ClassRifle {
			c.classes[id] = decoder.UnitClass(cls)
		}
	}
}

func (c *UnitClassConfig) Save() error {
	c.mu.RLock()
	defer c.mu.RUnlock()
	raw := make(map[string]string, len(c.classes))
	for id, cls := range c.classes {
		raw[strconv.Itoa(id)] = string(cls)
	}
	data, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(c.filePath, data, 0644)
}
