# Architecture

## 代码结构树

```
server/                                 # Go 后端 (module: wargame-replay/server)
├── main.go                             # 入口：flag 解析、Gin 路由注册、静态文件服务
│   ├── var version = "dev"             #   构建时通过 -ldflags 注入版本号
│   ├── flags: -dir -host -port         #   基本服务参数
│   ├── flags: -open -app               #   自动打开浏览器 + Chrome --app 模式
│   └── func main()                     #   启动 HTTP/WS 服务器 + 自动开浏览器
├── embed.go                            # //go:embed all:static → staticFS
├── winlog_windows.go                   # Windows 专用日志输出
│
├── api/                                # REST API 处理层 (Gin handlers)
│   ├── games.go
│   │   ├── type Handler struct         #   持有 sync.RWMutex、games 列表、services map
│   │   ├── func NewHandler(dir)        #   扫描目录、初始化
│   │   ├── func (h) ListGames()        #   GET /api/games
│   │   ├── func (h) GetMeta()          #   GET /api/games/:id/meta
│   │   ├── func (h) GetService(id)     #   懒加载 game.Service（双重检查锁）
│   │   ├── func (h) DeleteGame()       #   DELETE /api/games/:id
│   │   └── func (h) DataDir()          #   返回数据目录路径
│   ├── frames.go
│   │   └── func (h) GetFrame()         #   GET /api/games/:id/frame/:ts
│   ├── upload.go
│   │   └── func (h) Upload()           #   POST /api/upload — 文件名验证 + 原子写入
│   ├── bookmarks.go
│   │   ├── func (h) ListBookmarks()    #   GET  /api/games/:id/bookmarks
│   │   ├── func (h) CreateBookmark()   #   POST /api/games/:id/bookmarks
│   │   ├── func (h) DeleteBookmark()   #   DELETE /api/games/:id/bookmarks/:idx
│   │   └── func (h) SuggestBookmarks() #   GET /api/games/:id/bookmarks/suggest
│   ├── clips.go
│   │   ├── func (h) ListClips()        #   GET /api/games/:id/clips
│   │   ├── func (h) CreateClip()       #   POST /api/games/:id/clips
│   │   ├── func (h) UpdateClip()       #   PUT /api/games/:id/clips/:idx
│   │   ├── func (h) DeleteClip()       #   DELETE /api/games/:id/clips/:idx
│   │   └── func (h) ExportClip()       #   GET /api/games/:id/clips/:idx/export
│   └── unitclasses.go
│       ├── func (h) GetUnitClasses()   #   GET /api/games/:id/unitclasses
│       └── func (h) SaveUnitClasses()  #   PUT /api/games/:id/unitclasses
│
├── decoder/                            # 二进制 .db 协议解析
│   ├── types.go                        #   所有解码类型定义
│   │   ├── type UnitPosition struct    #     ID, Lat, Lng, Team, Alive, Class, Ammo, Supply, Revive
│   │   ├── type GameEvent struct       #     Type(kill/hit/revive/heal), AttackerID, VictimID, HP
│   │   ├── type POIObject struct       #     ID, Lat, Lng, Type(base/vehicle/supply/control/station), Team
│   │   ├── type BaseCamp struct        #     Team, Lat, Lng
│   │   ├── type BombingEvent struct    #     Ts, Lat, Lng, Radius
│   │   ├── type Graticule struct       #     Origin(Lat,Lng), End(Lat,Lng), CR(列行编码)
│   │   └── type CoordResolver interface#     Resolve(rawLat, rawLng) → (float64, float64)
│   ├── position.go                     #   帧解码
│   │   ├── func DecodePositionFrame()  #     DataType=1, 15字节/单位
│   │   ├── func DecodePOIs()           #     DataType=8, 31字节/POI
│   │   └── func decodeTeam(id)         #     ID < 500 → red, >= 500 → blue
│   ├── event.go                        #   事件解码
│   │   └── func DecodeEvents()         #     DataType=2/5, 变长条目
│   ├── coords.go                       #   坐标系自动检测
│   │   ├── func DetectCoordResolver()  #     5 种启发式 → WGS84Resolver | RelativeResolver
│   │   ├── type WGS84Resolver struct   #     GPS 坐标系
│   │   └── type RelativeResolver struct#     相对坐标系
│   ├── coords_test.go
│   ├── event_test.go
│   └── position_test.go
│
├── game/                               # 游戏服务层
│   ├── service.go
│   │   ├── type Service struct         #   db, idx, cache, resolver, players, meta, hpTimeline
│   │   ├── type GameMeta struct        #   CoordMode, Start/EndTime, Players, Bounds, Graticule
│   │   ├── type Frame struct           #   Ts, Units, Events, Hotspots, POIs
│   │   ├── func NewService(dbPath)     #   打开 DB、构建索引、预计算热点
│   │   ├── func (s) GetFrame(ts)       #   5秒滑动窗口 + HP 校准 + LRU 缓存
│   │   ├── func (s) GetFrameRange()    #   获取时间范围内所有事件（快进用）
│   │   ├── func (s) collectEvents()    #   二分搜索 hitTimestamps → O(log N + K)
│   │   └── func (s) buildPlayerList()  #   解析玩家名称和队伍
│   ├── unitclass.go
│   │   ├── type UnitClassConfig struct #   JSON 伴随文件
│   │   ├── func (s) LoadUnitClasses()  #   读取 .unitclasses.json
│   │   └── func (s) SaveUnitClasses()  #   写入 .unitclasses.json
│   └── service_test.go
│
├── hotspot/                            # 热点检测引擎
│   ├── engine.go
│   │   ├── type HotspotEvent struct    #   ID, Type, Start/End/PeakTs, Center, Score, Kills, Units
│   │   │                               #   Type: firefight|killstreak|mass_casualty|engagement|
│   │   │                               #         bombardment|long_range
│   │   ├── func DetectHotspotEvents()  #   完整检测管线
│   │   ├── func temporalCluster()      #     ≤45s 间隔聚类
│   │   ├── func splitLongCluster()     #     >180s 分割
│   │   ├── func classifyCluster()      #     连杀/交火/伤亡/轰炸 分类
│   │   ├── func spatialCenter()        #     150m 半径密度中心
│   │   └── func deduplicate()          #     ≥30s 重叠 + ≤200m 去重
│   ├── cache.go
│   │   ├── func SaveCache(path, events)#   序列化到 .hotspots.cache
│   │   └── func LoadCache(path)        #   反序列化 + mtime 校验
│   └── engine_test.go
│
├── scanner/                            # 目录扫描
│   ├── scanner.go
│   │   ├── type GameInfo struct        #   ID(SHA256[:4]), Filename, Path, StartTime, EndTime, Players
│   │   ├── func ScanDir(dir)           #   扫描 {session}_{start}_{end}.db 文件
│   │   └── func inferPlayerCount()     #   从 DB 推断玩家数量
│   └── scanner_test.go
│
├── index/                              # 时间索引 & 缓存
│   ├── timeindex.go
│   │   ├── type TimeIndex struct       #   排序时间戳数组
│   │   ├── func NewTimeIndex(db)       #   从 DB 加载所有唯一时间戳
│   │   ├── func (idx) IndexOf(ts)      #   二分搜索 O(log N)
│   │   └── func (idx) TimestampAt(i)   #   按索引获取时间戳
│   ├── cache.go
│   │   ├── type LRUCache struct        #   maxBytes=100MB
│   │   ├── func (c) Get(key)           #   O(1)
│   │   └── func (c) Put(key, val)      #   O(1), 超限驱逐 LRU
│   └── timeindex_test.go
│
├── ws/                                 # WebSocket 实时流
│   └── stream.go
│       ├── func HandleStream()         #   WS /ws/games/:id/stream
│       ├── func tickParams(speed)      #   计算帧投递间隔（≤16fps@高速）
│       └── // 协议:                    #   Server→Client: {type:"frame"/"state", ...}
│                                       #   Client→Server: {cmd:"play"/"pause"/"seek", ...}
│
├── browser/                            # 跨平台浏览器自动打开
│   ├── open.go                         #   通用接口
│   ├── open_darwin.go                  #   macOS: Chrome.app --app / open
│   ├── open_windows.go                 #   Windows: Chrome/Edge --app / start
│   └── open_linux.go                   #   Linux: google-chrome --app / xdg-open
│
├── winres/                             # Windows 资源 (go-winres)
│   ├── winres.json                     #   清单 + 版本信息 + 图标配置
│   ├── icon.png                        #   256px 应用图标
│   └── icon16.png                      #   16px 小图标
├── rsrc_windows_amd64.syso             # Windows x64 资源对象
├── rsrc_windows_arm64.syso             # Windows ARM64 资源对象
└── rsrc_windows_386.syso               # Windows x86 资源对象


web/                                    # React 前端
├── index.html                          # SPA 入口 (favicon.svg)
├── package.json                        # 依赖 & 脚本 (dev/build/lint)
├── vite.config.ts                      # Vite + React + Tailwind 插件, 代理 /api /ws → :8081
├── tailwind.config.ts                  # Tailwind CSS 4 配置
├── eslint.config.js                    # ESLint 9 flat config
├── tsconfig.app.json                   # TypeScript 严格模式 (noUnusedLocals, erasableSyntaxOnly)
├── public/
│   ├── favicon.svg                     # 战术雷达风格 SVG 图标
│   └── favicon.png                     # PNG 回退图标
│
└── src/
    ├── main.tsx                        # ReactDOM.createRoot 入口
    ├── App.tsx                         # 根组件 + 全局键盘处理
    ├── index.css                       # 全局样式 (Tailwind @import)
    │
    ├── lib/                            # 基础库
    │   ├── api.ts                      #   REST 客户端 + 类型定义
    │   │   ├── type GameInfo           #     ID, Filename, StartTime, EndTime, Players
    │   │   ├── type GameMeta           #     CoordMode, Players, Bounds, Graticule, BaseCamps
    │   │   ├── type UnitPosition       #     ID, Lat, Lng, Team, Alive, Class, Name, HP
    │   │   ├── type GameEvent          #     Type, AttackerID/Name, VictimID/Name, HP
    │   │   ├── type HotspotEvent       #     ID, Type, Start/End/PeakTs, Center, Score, Kills
    │   │   ├── type POIObject          #     ID, Lat, Lng, Type, Team
    │   │   ├── fetchGames()            #     GET /api/games
    │   │   ├── fetchMeta(id)           #     GET /api/games/:id/meta
    │   │   ├── fetchHotspots(id)       #     GET /api/games/:id/hotspots
    │   │   ├── uploadFiles(files)      #     POST /api/upload (FormData)
    │   │   └── deleteGame(id)          #     DELETE /api/games/:id
    │   ├── settingsAPI.ts              #   设置导入/导出/重置
    │   │   ├── type FullConfig         #     聚合所有 store 的完整配置
    │   │   ├── DEFAULTS                #     所有默认值
    │   │   ├── RANGES                  #     28+ 字段的数值验证范围
    │   │   ├── exportConfig()          #     聚合 5 个 store → JSON
    │   │   ├── importConfig(json)      #     验证 + 分发到各 store
    │   │   └── resetToDefaults()       #     重置所有 store 到默认值
    │   ├── ws.ts                       #   WebSocket 客户端
    │   │   └── class GameWebSocket     #     connect(), send(cmd), onMessage(fn), disconnect()
    │   │                               #     自动重连 (2s 延迟)
    │   ├── i18n.ts                     #   国际化
    │   │   └── useI18n()               #     lang: zh|en, t(key), toggleLang()
    │   └── utils.ts                    #   工具函数
    │
    ├── store/                          # Zustand 状态管理 (5 个 store)
    │   ├── playback.ts                 #   连接 & 回放状态
    │   │   └── usePlayback             #     gameId, meta, ws, currentTs, playing, speed
    │   │                               #     units[], events[], hotspots[], pois[]
    │   │                               #     allHotspots[], allKills[] (预加载全量)
    │   │                               #     mapStyle, styleNonce, trailEnabled, tiltMode
    │   │                               #     selectedUnitId, followSelectedUnit, manualFollow
    │   │                               #     killLine/hitLine/revive/heal/death 视觉效果开关
    │   │                               #     killstreakSlowDiv, longRangeSlowSpeed, bombardSlowDiv
    │   │                               #     LocalStorage 持久化 (wargame-prefs)
    │   ├── director.ts                 #   导播 & 镜头状态
    │   │   └── useDirector             #     mode: replay|director
    │   │                               #     autoMode, targetCamera, activeHotspotId
    │   │                               #     focusMode{active, focusUnitId, relatedIds}
    │   │                               #     followZoom, slowdown, switchLocked
    │   │                               #     focusDarkMap, immersive, manualOverride
    │   │                               #     cameraHistory[] (max 500)
    │   ├── visualConfig.ts             #   视觉参数 (89 项可配置)
    │   │   └── useVisualConfig         #     VISUAL_DEFAULTS: 颜色×10, 单位×7, 攻击线×5
    │   │                               #       特效×13, 弹道×6, 导播×13, 活动圈×2
    │   │                               #     freeMaxZoom: 免费瓦片缩放上限
    │   │                               #     set(key, val) / setBatch() / reset()
    │   │                               #     LocalStorage 持久化 (wargame-visual)
    │   ├── clips.ts                    #   书签 & 片段
    │   │   └── useClipsStore           #     bookmarks[], clips[], selectedClipId
    │   │                               #     load/add/delete Bookmark (REST API)
    │   │                               #     load/add/update/delete/export Clip
    │   └── hotspotFilter.ts            #   热点可见性筛选
    │       └── useHotspotFilterStore   #     debugOverlay, typeFilters{6 种类型}
    │
    ├── hooks/
    │   └── useHotspotDirector.ts       # 自动导播逻辑 (450+ LOC)
    │       └── useHotspotDirector()    #   预追踪(8s) → 活跃热点收集 → 优先级选择
    │                                   #   聚焦模式(地图压暗+减速+锁定)
    │                                   #   冷却(9.5s ±30%抖动) → manualOverride 机制
    │                                   #   effectiveMaxZoom() 免费瓦片缩放保护
    │
    ├── map/                            # 地图图层组件
    │   ├── MapView.tsx                 #   地图容器 (500+ LOC)
    │   │   └── MapView                 #     初始化 MapLibre GL, 管理图层渲染顺序
    │   │                               #     订阅 playback store, 镜头过渡 (flyTo/fitBounds)
    │   │                               #     聚焦模式: raster paint 压暗 (brightness/saturation)
    │   │                               #     跟随循环: 指数平滑追踪 + freeMaxZoom 限制
    │   ├── UnitLayer.tsx               #   单位位置渲染 (GeoJSON source)
    │   ├── TrailLayer.tsx              #   移动轨迹 (LineString)
    │   ├── HotspotLayer.tsx            #   热点圆圈 + 标签 (GeoJSON)
    │   ├── HotspotActivityCircle.tsx   #   实时热点活动指示环
    │   ├── HotspotControlPanel.tsx     #   热点可见性开关面板
    │   ├── BaseCampLayer.tsx           #   队伍基地标记
    │   ├── BombingLayer.tsx            #   轰炸事件 (Canvas overlay)
    │   ├── POILayer.tsx                #   战场设施 (补给/控制点)
    │   ├── GraticuleLayer.tsx          #   坐标网格 (R→A 列, 1→15 行)
    │   ├── SniperTracerLayer.tsx       #   远距离击杀弹道线
    │   ├── RelativeCanvas.tsx          #   2D Canvas 回退 (相对坐标)
    │   ├── EventToastOverlay.tsx       #   事件弹窗 (击杀/复活)
    │   ├── KillLeaderboard.tsx         #   击杀排行榜
    │   ├── PlayerSearch.tsx            #   玩家搜索/筛选
    │   ├── unitIcons.ts               #   Canvas 单位图标 (rifle/mg/sniper/medic/marksman)
    │   ├── poiIcons.ts                #   Canvas POI 图标生成
    │   └── styles.ts                  #   地图样式 (6 种: dark/satellite/terrain/light/osm/topo)
    │                                  #     免费: CARTO Dark/Positron/Voyager, ESRI, OSM, OpenTopo
    │                                  #     Mapbox: dark-v11, satellite-streets-v12, outdoors-v12
    │                                  #     isFreeTileStyle(), getMapStyle(), getMapboxToken()
    │                                  #     tileSize:256 + @2x (retina quality at correct zoom)
    │
    ├── timeline/                       # 时间轴 UI
    │   ├── Timeline.tsx                #   容器 (管理多轨道)
    │   ├── TransportControls.tsx       #   播放/暂停/速度/快进快退
    │   ├── Playhead.tsx                #   可拖拽时间指示器
    │   ├── Track.tsx                   #   通用轨道
    │   └── HotspotTrack.tsx            #   热点事件标记轨道
    │
    ├── director/                       # 导播模式 UI
    │   ├── DirectorPanel.tsx           #   主面板 (回放/导播切换)
    │   ├── PreviewGrid.tsx             #   4 窗口预览网格
    │   ├── HotspotEventTabs.tsx        #   热点事件分类列表
    │   └── AutoSwitch.tsx              #   自动导播开关 & 状态
    │
    ├── clips/                          # 书签 & 片段编辑
    │   ├── BookmarkList.tsx            #   书签列表 + 自动建议
    │   ├── ClipEditor.tsx              #   片段创建/编辑
    │   └── ExportDialog.tsx            #   片段导出 (WebM 视频 / JSON 数据)
    │                                   #     MediaRecorder: 30fps, 8Mbps, vp9/vp8
    │
    └── components/                     # 通用 UI 组件
        ├── GameList.tsx                #   游戏选择器 + 文件上传区（拖拽上传）
        ├── TopBar.tsx                  #   标题栏 + 设置入口
        ├── ShortcutHelp.tsx            #   键盘快捷键帮助
        └── settings/                   #   右侧滑出设置面板
            ├── Settings.tsx            #     面板容器 (8 页 Tab)
            ├── tabs/                   #     8 个设置页
            │   ├── MapTab.tsx          #       地图源网格选择器 + Mapbox token + 缩放
            │   ├── ColorsTab.tsx       #       10 种颜色配置
            │   ├── UnitsTab.tsx        #       图标大小/标签/阵亡显示
            │   ├── EffectsTab.tsx      #       复活/治疗/击中/死亡动画参数
            │   ├── BallisticsTab.tsx   #       狙击弹道特效参数
            │   ├── PlaybackTab.tsx     #       效果开关 + 热点降速设置
            │   ├── HotspotTab.tsx      #       导播参数 + 镜头缩放 + 活动圈
            │   └── GeneralTab.tsx      #       语言/JSON 导入导出/重置
            └── controls/               #     6 种可复用控件
                ├── SettingToggle.tsx    #       开关
                ├── SettingSlider.tsx    #       滑条
                ├── SettingInput.tsx     #       输入框
                ├── SettingSelect.tsx    #       下拉选择
                ├── SettingColor.tsx     #       颜色选择器
                └── SettingGroup.tsx     #       分组容器


assets/                                 # 图标资源
├── icon.svg                            # 源 SVG (战术雷达风格)
├── icon-{16,32,48,64,128,256,512}.png  # 多尺寸 PNG
└── icon.ico                            # Windows 图标

.github/workflows/
├── ci.yml                              # push/PR → lint + test + smoke build
└── release.yml                         # tag v* → 6 平台交叉编译 → GitHub Release
```

## 数据流

```
                    ┌──────────────┐
                    │  .db (SQLite) │
                    │  + .txt 元数据 │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   decoder/    │  二进制协议解析
                    │  position.go  │  DataType 1/2/5/8
                    │   event.go    │
                    │   coords.go   │  坐标系自动检测
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │      game/service.go     │  帧组装 + HP 校准
              │  5秒滑动窗口合并单位状态    │  二分搜索事件时间线
              │  100MB LRU 帧缓存         │
              └────────┬───────┬────────┘
                       │       │
            ┌──────────▼─┐  ┌──▼──────────┐
            │  REST API   │  │  WebSocket   │
            │ /api/games  │  │ /ws/.../stream│
            │ /api/frame  │  │  play/pause   │
            │ /api/hotspot│  │  seek/speed   │
            └──────┬──────┘  └──────┬───────┘
                   │                │
            ┌──────▼────────────────▼───────┐
            │         React 前端              │
            │  Zustand stores (5个)          │
            │  ┌─────────────────────────┐  │
            │  │ playback: 帧数据+播放状态  │  │
            │  │ director: 镜头+聚焦模式   │  │
            │  │ visualConfig: 89项视觉参数│  │
            │  │ clips: 书签+片段         │  │
            │  │ hotspotFilter: 筛选      │  │
            │  └─────────────────────────┘  │
            │  MapLibre GL (15 个图层)       │
            │  时间轴 + 导播面板 + 8页设置    │
            └───────────────────────────────┘
```

## 关键算法

### 帧组装 (Frame Assembly)

```
GetFrame(ts):
  1. 查询 [ts-2.5s, ts+2.5s] 范围内的位置记录
  2. 按 UnitID 去重，保留最新状态
  3. 对每个单位:
     a. 在 hpTimeline[unitID] 中二分搜索 HP 变化
     b. 如果事件时间戳 ≤ 帧时间戳 → 应用 HP
     c. 否则使用默认满 HP
  4. 应用单位分类覆盖
  5. 缓存结果到 LRU

  复杂度: O(N × log E)  N=单位数, E=事件数
```

### 热点检测管线

```
DetectHotspotEvents():
  1. temporalCluster()     按时间聚类 (≤45s 间隔)
  2. splitLongCluster()    长聚类分割 (>180s 在最大间隔处)
  3. classifyCluster()     分类:
     - killstreak:      1人 4+击杀, 间隔≤60s
     - firefight:       2+人, 2+击杀, 均衡交火
     - mass_casualty:   短时间 3+击杀
     - engagement:      3+击杀, 来回交战
     - bombardment:     轰炸事件
     - long_range:      远距离击杀 (>Xm)
  4. spatialCenter()       150m 半径密度中心
  5. deduplicate()         ≥30s 重叠 + ≤200m 合并

  复杂度: O(E log E)
```

### 自动导播优先级

```
useHotspotDirector():
  // manualOverride 检查 (热点列表点击触发)
  if manualOverride:
    重置所有内部 ref (lockUntil, lockedHotspotId, preTrackingId)
    从 store 同步状态 → 让出一帧
    return

  if 锁定个人热点中:
    if 当前时间 < 锁定结束时间 → 保持聚焦
    else → 退出聚焦模式

  else if 8秒内有即将开始的个人热点:
    预追踪焦点单位

  else:
    收集当前时间活跃的热点
    关键热点 (个人|轰炸) 优先
    加权随机选择 (score^1.5)

    if 个人热点:
      seek 到热点开始时间
      激活地图压暗 (raster paint: brightness-max=0.15, saturation=-0.8)
      减速 + 设置游戏时间锁定

    缩放限制: effectiveMaxZoom() 自动感知免费瓦片上限

    冷却: 9.5s 实时 (±30% 抖动)
    关键热点可绕过冷却

    手动跟踪 > 导播控制 (绝对优先)
```

## 伴随文件 (Sidecar Files)

每个 `.db` 对局文件可能有以下伴随文件（同目录同名）：

| 扩展名 | 格式 | 说明 |
|--------|------|------|
| `.hotspots.cache` | 二进制 | 预计算热点事件（快速加载，mtime 校验） |
| `.clips.json` | JSON | 用户创建的片段 |
| `.bookmarks.json` | JSON | 用户书签 |
| `.unitclasses.json` | JSON | 单位分类覆盖（unitID → class） |
| `.txt` | 文本 | 地图元数据（坐标校准、栅格参数） |

## 二进制协议

### 位置条目 (DataType=1, 15 字节)

```
偏移  大小   类型        字段
0     2     uint16LE   Unit ID
2     4     uint32LE   Raw Latitude
6     4     uint32LE   Raw Longitude
10    1     byte       Alive (>0=存活, 0=阵亡)
11    1     byte       Class (低3位: 0=步枪 1=机枪 2=精确 3=狙击 4=医疗)
12    1     byte       Ammo (0-255)
13    1     byte       Supply (0-255)
14    1     byte       Revival tokens (0-2)
```

### POI 条目 (DataType=8, 31 字节)

```
偏移  大小   类型        字段
0     2     uint16     ID
3     4     uint32LE   Raw Latitude
7     4     uint32LE   Raw Longitude
11    1     byte       Type (1=基地 2=载具 3=补给 4=控制 5=站点)
12    1     byte       Team (0=red 1=blue 2=中立)
13    2     uint16LE   Resource (HP/补给/占领进度)
```

### 栅格编码 (Graticule CR)

```
CR = 0x100E (4110)
高字节 = 0x10 = 16 → totalCols = 16 + 2 = 18 (R→A 右→左)
低字节 = 0x0E = 14 → totalRows = 14 + 1 = 15 (1→15 下→上)
```

## 约定

- **队伍判定**: Unit ID < 500 = 红方, ≥ 500 = 蓝方
- **坐标检测**: 自动尝试 5 种启发式，优先 `.txt` 文件 → WGS84 → 相对坐标
- **缓存策略**: 热点缓存按 `.db` 文件 mtime 失效；帧缓存 100MB LRU 内存限制
- **WebSocket 帧率**: 低速(≤16x) 每游戏秒 1 帧；高速(>16x) 上限 16fps
- **地图源**: 6 种免费瓦片 + 3 种 Mapbox 高清；Mapbox 使用 Static Tiles API (tileSize:256+@2x)
- **聚焦模式**: 通过 raster paint 属性 (brightness-max, saturation) 压暗地图，不切换样式避免缓存丢失
- **免费瓦片保护**: `freeMaxZoom` (默认 16) 限制导播/跟随/点击缩放，防止 "Map data not yet available"
- **设置持久化**: `wargame-visual` (89 项视觉参数), `wargame-prefs` (回放偏好), `mapbox-token` (地图令牌)
- **自动打开浏览器**: 启动时自动检测 Chrome/Edge，优先 `--app` 模式（无地址栏）

## CI/CD

### CI (ci.yml) — push/PR 触发

```
test-backend:  go vet + go test -race
test-frontend: tsc -b + eslint
build:         npm build + go build + smoke test (启动/关闭)
```

### Release (release.yml) — tag v* 触发

```
build (6 平台矩阵):
  ├── linux-amd64     (Zig CC 交叉编译)
  ├── linux-arm64     (Zig CC 交叉编译)
  ├── darwin-amd64    (macOS native)
  ├── darwin-arm64    (macOS native)
  ├── windows-amd64   (Zig CC → .zip 打包)
  └── windows-arm64   (Zig CC → .zip 打包)

release:
  ├── 下载所有 artifacts
  ├── 生成 SHA256 校验和
  └── 创建 GitHub Release + 上传
```

### 版本注入

```
make release V=v1.0.0
  → git tag -a v1.0.0
  → git push origin v1.0.0
  → CI: go build -ldflags="-X main.version=v1.0.0"
  → GET /api/health → {"version":"v1.0.0"}
```
