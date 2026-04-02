package index

import (
	"container/list"
	"sync"
)

type LRUCache struct {
	maxBytes  int64
	usedBytes int64
	mu        sync.Mutex
	ll        *list.List
	cache     map[string]*list.Element
}

type cacheEntry struct {
	key   string
	value []byte
}

func NewLRUCache(maxBytes int64) *LRUCache {
	return &LRUCache{
		maxBytes: maxBytes,
		ll:       list.New(),
		cache:    make(map[string]*list.Element),
	}
}

func (c *LRUCache) Get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ele, ok := c.cache[key]; ok {
		c.ll.MoveToFront(ele)
		return ele.Value.(*cacheEntry).value, true
	}
	return nil, false
}

func (c *LRUCache) Put(key string, value []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ele, ok := c.cache[key]; ok {
		c.ll.MoveToFront(ele)
		old := ele.Value.(*cacheEntry)
		c.usedBytes += int64(len(value)) - int64(len(old.value))
		old.value = value
	} else {
		ele := c.ll.PushFront(&cacheEntry{key, value})
		c.cache[key] = ele
		c.usedBytes += int64(len(value)) + int64(len(key))
	}
	for c.usedBytes > c.maxBytes && c.ll.Len() > 0 {
		c.removeOldest()
	}
}

func (c *LRUCache) removeOldest() {
	ele := c.ll.Back()
	if ele == nil {
		return
	}
	c.ll.Remove(ele)
	entry := ele.Value.(*cacheEntry)
	delete(c.cache, entry.key)
	c.usedBytes -= int64(len(entry.value)) + int64(len(entry.key))
}

// Clear removes all entries from the cache.
func (c *LRUCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ll.Init()
	c.cache = make(map[string]*list.Element)
	c.usedBytes = 0
}
