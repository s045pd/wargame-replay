# WarGame Replay — 军推活动回放系统设计文档

## 概述

一个专业的军推（War Game）活动数据回放 Web 应用，支持沉浸式地图回放、影视级导播模式、书签标注和剪辑导出功能。

**数据源**: SQLite 数据库文件，每次活动生成一个 `.db` 文件，包含所有参与者的位置数据（1Hz）、状态变更、击杀事件和统计数据。

**目标用户**: 活动组织者/参与者，本地或局域网使用，用于赛后复盘、视频剪辑素材准备、战术分析。

## 数据库结构

### record 表 (66,892 条记录样本)

```sql
CREATE TABLE record (
    "ID" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    "SrcType" INTEGER,    -- 1=玩家单位, 64=系统
    "SrcIndex" INTEGER,   -- 单位/设备索引
    "DataType" INTEGER,   -- 数据类型 (1-13)
    "RecordID" INTEGER,
    "LocLat" INTEGER,     -- 纬度 (编码格式)
    "LocLng" INTEGER,     -- 经度 (编码格式)
    "LogTime" TEXT,       -- 时间戳 "YYYY-MM-DD HH:MM:SS"
    "LogData" BLOB        -- 二进制数据
);
```

### tag 表 (780 条记录样本)

```sql
CREATE TABLE tag (
    "ID" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    "SrcType" INTEGER,
    "SrcIndex" INTEGER,   -- 对应 record 中的单位索引
    "TagValue" INTEGER,   -- 0 或 65536
    "TagText" TEXT,       -- 玩家呼号 (如 "SHARK", "清木")
    "LogTime" TEXT
);
```

### DataType 分类

| DataType | 来源 | 数量 | 含义 | Blob 大小 |
|----------|------|------|------|-----------|
| 1 | 玩家(SrcType=1) | ~30,000 | 批量位置数据，每秒1条，含所有单位坐标 | 30-585B |
| 8 | 系统(SrcType=64) | ~30,000 | 系统状态快照，每秒1条 | 31-155B |
| 10 | 系统 | ~3,000 | 系统状态，每10秒 | 72B |
| 12 | 系统 | ~1,400 | 心跳/保活，无数据 | 0B |
| 3 | 玩家 | ~1,000 | 统计数据，每30秒 | 20-220B |
| 2 | 混合 | ~500 | 状态变更（含GPS坐标） | 2-6B |
| 5 | 系统 | ~350 | 击杀/命中记录 | 224B |
| 4 | 混合 | ~350 | GPS点事件（设备上下线） | 0-2B |
| 7/9/11/13/6 | 系统 | <40 | 初始化、配置、罕见事件 | 变长 |

### 已确认的二进制协议: DataType=1 位置数据

每条 record 的 LogData 包含 N 个 15 字节条目 (`N = len(blob) / 15`)：

```
Offset  Size  Type      Field
0       1     uint8     UnitID     — 匹配 tag 表 SrcIndex
1       1     uint8     UnitType   — 0=玩家, 1=特殊单位, 2=基站
2       4     uint32LE  Latitude   — 编码坐标
6       4     uint32LE  Longitude  — 编码坐标
10      5     bytes     Flags      — 状态标志位 (待完整逆向)
```

### 坐标系统

原始整数值（如 lat=210715978, lng=294454955）的编码方式尚未完全确认。实际活动地点为江苏溧阳（约 31.4°N, 119.5°E）。

**坐标解码协议（实现阶段第一优先级，前后端联调前置条件）**:

解码尝试顺序：
1. 尝试常见中国坐标系变换（GCJ-02、CGCS2000 投影、高斯-克吕格）
2. 如不匹配，用活动区域边界点做线性拟合（需用户提供 2-3 个参考点）
3. 兜底：使用相对坐标模式

**API 坐标模式协商**: `GET /api/games/:id/meta` 返回 `coordMode` 字段：
- `"wgs84"` — 解码成功，API 返回标准 WGS84 lat/lng
- `"relative"` — 解码失败，API 返回归一化相对坐标 `x`/`y`（0.0~1.0），前端使用自定义 Canvas 叠加层渲染而非 Mapbox 地理图层

帧数据中的单位坐标字段根据 `coordMode` 变化：
- `wgs84` 模式: `{"lat": 31.42, "lng": 119.49}`
- `relative` 模式: `{"x": 0.35, "y": 0.62}`

前端必须在获取 meta 后根据 `coordMode` 选择渲染路径。

### Flags 字段最低可行解码（前端渲染前置条件）

Flags 的 5 字节中，以下两个字段**必须在前端开发前解码**：

| 字段 | 推测位置 | 用途 | 兜底策略 |
|------|---------|------|---------|
| **阵营/Team** | Byte 0 高位 (观察: 0x64=红?, 0x00=蓝?) | 红/蓝阵营颜色渲染 | 若无法解码则从 tag 表 SrcIndex 范围推断 (21-49=红, 50-76=蓝, 500+=观察员) |
| **存活状态** | Byte 2-3 (观察: 0xFE=存活?) | 存活/阵亡图标切换 | 若无法解码则默认全部存活，仅通过击杀事件推断 |

其余 Flags 信息（朝向、血量、弹药等）为非关键增强功能，可延后逆向。

### 待逆向的数据类型

| DataType | 策略 | 优先级 |
|----------|------|--------|
| 5 (击杀/命中) | 关联 tag 表定位 killer/victim 字段 | P0 — 导播算法核心输入 |
| 2 (状态变更) | 与 DataType=4 GPS 交叉对比 | P1 |
| 3 (统计数据) | 时间序列分析，推断计分字段 | P1 |
| 8 (系统快照) | 与 DataType=1 交叉验证 | P2 |
| Flags 完整解码 | 统计聚类分析 | P2 |

## 架构设计

### 方案: 混合架构

启动时构建轻量索引 + 热点预计算，位置数据按需加载 + LRU 缓存。

```
┌──────────────────────────────────────────────────────────┐
│                    React Frontend                         │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐  │
│  │ 3D Map   │ │ Timeline │ │ Director  │ │ Clip      │  │
│  │ (Mapbox) │ │ Control  │ │ Panel     │ │ Editor    │  │
│  └──────────┘ └──────────┘ └───────────┘ └───────────┘  │
│  shadcn/ui + TailwindCSS                                 │
└─────────────────┬────────────────────────────────────────┘
                  │ REST + WebSocket
┌─────────────────┴────────────────────────────────────────┐
│                   Go Backend (Gin)                         │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐  │
│  │ DB       │ │ Protocol │ │ Hotspot   │ │ Clip/     │  │
│  │ Scanner  │ │ Decoder  │ │ Engine    │ │ Bookmark  │  │
│  └──────────┘ └──────────┘ └───────────┘ └───────────┘  │
│  ┌──────────┐ ┌──────────┐                               │
│  │ Time     │ │ LRU      │                               │
│  │ Index    │ │ Cache    │                               │
│  └──────────┘ └──────────┘                               │
└─────────────────┬────────────────────────────────────────┘
                  │ SQLite
┌─────────────────┴────────────────────────────────────────┐
│              .db Files (Directory Scan)                    │
└──────────────────────────────────────────────────────────┘
```

### 核心模块

| 模块 | 职责 |
|------|------|
| DB Scanner | 扫描指定目录，解析文件名提取活动元信息（时间范围、Game ID） |
| Protocol Decoder | 解码二进制协议，每个 DataType 一个独立 decoder interface |
| Time Index | 构建 `timestamp → db_row_id` 快速查找索引 |
| LRU Cache | 缓存已解码的时间窗口数据，30秒/窗口，上限 100MB |
| Hotspot Engine | 预计算综合热点评分时间线，结果缓存至磁盘 |
| Clip/Bookmark | 书签/片段 CRUD，存储为 JSON sidecar 文件 |

### 启动流程

```
Go Server 启动
  → 扫描目录，发现所有 .db 文件
  → 用户选择活动 (或自动选最新)
  → 构建时间索引 (timestamp → rowid, ~2-3s)
  → 预计算热点评分时间线
  → 就绪，等待前端连接
```

## API 设计

### REST

| 端点 | 方法 | 用途 |
|------|------|------|
| `GET /api/games` | GET | 活动列表（目录扫描结果） |
| `GET /api/games/:id/meta` | GET | 活动元信息（时间范围、玩家列表、队伍划分） |
| `GET /api/games/:id/hotspots` | GET | 预计算的热点评分时间线 |
| `GET /api/games/:id/frame/:ts` | GET | 指定时间戳的单帧数据（seek 跳转） |
| `GET/POST/PUT/DELETE /api/games/:id/bookmarks` | CRUD | 书签管理 |
| `GET/POST/PUT/DELETE /api/games/:id/clips` | CRUD | 剪辑片段管理 |
| `POST /api/games/:id/export` | POST | 导出剪辑片段数据 |

### WebSocket

端点: `GET /ws/games/:id/stream`

**连接模型**: 每个 WebSocket 连接维护独立的播放状态（per-connection）。多个浏览器标签/客户端各自独立控制，互不影响。

**握手**: 连接建立后，服务端立即发送 `state` 同步消息：
```json
// 服务端 → 客户端 (连接建立时)
{"type": "state", "ts": "2026-01-17T11:38:58", "status": "paused", "speed": 1, "coordMode": "wgs84"}
```

**客户端命令**:
```json
{"cmd": "play", "speed": 2}           // 从当前位置开始播放（可选 speed）
{"cmd": "pause"}                       // 暂停
{"cmd": "seek", "to": "2026-01-17T13:20:00"}  // 跳转，播放中 seek 后继续播放
```

**seek 行为**: 若当前正在播放，seek 后继续以当前速度播放；若已暂停，seek 后推送该帧数据并保持暂停。

**服务端帧推送**:
```json
// 服务端 → 客户端 (每帧)
{
  "type": "frame",
  "ts": "2026-01-17T12:01:33",
  "units": [
    {"id": 45, "name": "清木", "team": "red", "alive": true, "lat": 31.42, "lng": 119.49, "flags": "0082fdfe01"}
  ],
  "events": [
    {"type": "kill", "src": 35, "dst": 42, "ts": "2026-01-17T12:01:33"}
  ],
  "hotspot": {"score": 0.78, "center": [31.42, 119.49], "radius": 120}
}
```

**play 重复发送**: 若服务端已在播放中收到 `play`，仅作为速度变更处理，不重置播放位置。若 `speed` 字段省略则保持当前速度。

**coordMode 一致性**: WebSocket `state` 消息中的 `coordMode` 始终与 REST `meta` 接口返回值一致。客户端可使用任一来源，WebSocket 值足以避免额外请求。

**断线重连**: 客户端重连后收到新的 `state` 消息（初始暂停状态），需重新发送 `seek` + `play` 恢复。

### 缓存策略

- 以 30 秒为窗口单位缓存已解码数据
- 上限 100MB，LRU 淘汰
- Seek 时预取前后各 1 个窗口

## 前端设计

### 双模式 UI

通过顶栏 Tab 切换两种模式，共享底部多轨时间轴。快捷键 `Tab` 切换。

**回放模式 (Replay)**:
- 全屏 3D 地图，最大化沉浸感
- 左上角队伍图例（存活数/总数）
- 右上角小地图
- 左下角浮动事件 toast（击杀通知等）
- 右下角跟踪单位信息
- 点击地图上的单位可选中跟踪

**导播模式 (Director)**:
- 左侧主监看窗口（PROGRAM），使用完整 Mapbox GL 实例
- 右侧 4 个预览机位（热点 #1/#2、单位跟踪、全局概览）
- 右侧导播控制面板：自动/手动切换、热度指示、下次切换倒计时
- 右侧紧凑事件流

**预览窗口渲染策略**: 4 个预览窗口不使用独立 Mapbox 实例（避免 5 个 WebGL context 的 GPU 压力）。采用 Canvas 2D 静态缩略图方案：
- 主监看使用完整 Mapbox GL（1 个 WebGL context）
- 预览窗口使用 Canvas 2D 绘制简化地图 + 单位点位，2Hz 刷新
- 点击预览窗口时将其镜头参数应用到主监看（切换主画面），而非打开新地图

**沉浸模式**: 底部多轨时间轴可收起，地图全屏，只保留细长进度条 + 浮动播放按钮。快捷键 `H` 切换。

### 多轨时间轴

底部固定面板，包含 4 条轨道：

| 轨道 | 颜色 | 内容 |
|------|------|------|
| 热点 | 橙/红 | 热度评分波形图，高热区域高亮 |
| 机位 | 青/绿 | 导播自动切换的机位段落 |
| 书签 | 绿 | 用户标记的书签点（竖线） |
| 剪辑 | 紫 | 用户选定的剪辑区间（矩形） |

播放控制：播放/暂停、前跳/后跳、速度选择（1x/2x/4x/8x/16x）、时间显示。

### 地图配置

- 引擎: Mapbox GL JS
- 3D 地形 + 建筑
- 可切换风格：暗夜科技风（默认）、卫星影像、地形等高线
- 单位渲染：发光圆点，红/蓝阵营色，选中单位高亮 + 呼号标签
- 移动轨迹：可选显示尾迹（最近 30s 路径）

## 导播热点算法

### 综合评分模型

每秒计算，输出 0~1 的热度分数：

```
HotScore(t, region) = 0.25·Density + 0.15·Velocity + 0.40·Events + 0.20·StatsΔ
```

| 信号 | 权重 | 计算方式 |
|------|------|---------|
| Density (密集度) | 0.25 | 区域内双方单位数量，接触距离<50m 加权翻倍 |
| Velocity (运动强度) | 0.15 | 单位平均速度，突变加分 |
| Events (事件密度) | 0.40 | 击杀/命中数量，5s 衰减窗口，连杀 combo 加成 |
| StatsΔ (统计突变) | 0.20 | 存活数变化率、比分变化 |

### 空间分区

活动区域划分为 100m×100m 网格，每格独立评分，取 Top-3 热区作为导播候选。

### 预计算数据结构与存储

**热点时间线** — 每秒一帧，存储 Top-3 热区信息：
```go
type HotspotFrame struct {
    Ts         string          // 时间戳
    MaxScore   float32         // 全局最高热度 0~1
    TopRegions [3]HotRegion    // Top-3 热区
}
type HotRegion struct {
    CenterLat float64          // 热区中心纬度
    CenterLng float64          // 热区中心经度
    Score     float32          // 热度评分
    Radius    float32          // 覆盖半径 (米)
    Camera    CameraPreset     // 推荐机位参数
}
type CameraPreset struct {
    Lat     float64            // 镜头中心纬度
    Lng     float64            // 镜头中心经度
    Zoom    float32            // Mapbox zoom level (0-22)
    Bearing float32            // 方位角 (0-360°, 0=北)
    Pitch   float32            // 俯仰角 (0-60°, 0=正俯视)
}
```

**内存估算**: 8.5h × 3600s/h × 每帧 ~200B ≈ 6MB，可完整驻留内存。

**磁盘缓存**: 首次计算后序列化为 `<db_filename>.hotspots.cache`，后续启动直接加载（<500ms），跳过预计算。缓存文件含 db 文件 mtime 校验，db 变更时自动失效重算。

**启动时间预算**: 索引构建 ~2s + 热点预计算 ~3s（首次）/ 热点缓存加载 ~0.5s（后续）。

### 导播切换逻辑

```
自动导播规则:
  当前机位停留 > 5s (最小停留时间)
    AND 其他区域 HotScore > 当前区域 × 1.3
    → flyTo 动画过渡 (1.5s)

  特殊事件 (多杀/团灭):
    → 立即切换，忽略最小停留
```

### 机位类型

| 机位 | 视角 | 触发条件 |
|------|------|---------|
| 热区俯瞰 | 45° 倾斜，覆盖热区 | 默认 |
| 单位跟踪 | 跟随高 KD 玩家 | 该玩家附近事件密集 |
| 全局鸟瞰 | 正上方全局 | 大规模阵型变化 |
| 对峙视角 | 前线中间低角度 | 双方对峙收缩 |

## 书签、剪辑与导出

### 书签

- 快捷键 `B` 添加书签
- 字段：时间戳、标题（可选）、备注（可选）、自动标签
- 时间轴上绿色竖线标识
- 系统自动生成建议书签：热点评分突变点（得分骤升 >0.3）

### 剪辑片段

- 时间轴拖拽创建片段（紫色区间）
- 字段：起止时间、标题、机位设置、速度倍率
- 片段列表可排序、合并、分割
- 支持多机位关键帧（时间点 + 镜头参数），回放时自动过渡
- **重叠处理**: 允许片段时间重叠（不同剪辑视角可覆盖同一时段）。导出时按片段列表顺序拼接。UI 上重叠区间用更深紫色标识。

### 导出（分优先级）

| 优先级 | 功能 | 格式 |
|--------|------|------|
| P0 | 片段元数据 | JSON（时间信息 + 机位关键帧） |
| P1 | 片段回放数据 | JSON/CSV（位置 + 事件流） |
| P2 | 录制视频 | WebM（MediaRecorder API） |

### 存储

JSON sidecar 文件，与 .db 同目录，不修改原始数据库：
- `<db_filename>.bookmarks.json`
- `<db_filename>.clips.json`

## 技术栈

| 层 | 技术 |
|---|------|
| 前端框架 | React 18 + TypeScript |
| UI 组件 | shadcn/ui + TailwindCSS (暗夜主题) |
| 地图引擎 | Mapbox GL JS (3D 地形 + 多风格) |
| 状态管理 | Zustand |
| 构建工具 | Vite |
| 后端框架 | Go + Gin |
| 数据库驱动 | go-sqlite3 (CGO) |
| WebSocket | gorilla/websocket |
| 缓存 | 内存 LRU (自实现, 100MB) |
| 书签/剪辑 | JSON sidecar 文件 |
| 视频录制 | MediaRecorder API (P2) |

## 项目结构

```
wargame-replay/
├── server/                  # Go 后端
│   ├── main.go              # 入口，启动 HTTP/WS 服务
│   ├── api/                 # REST handlers
│   │   ├── games.go         # 活动列表 + 元信息
│   │   ├── frames.go        # 帧数据 + seek
│   │   ├── bookmarks.go     # 书签 CRUD
│   │   └── clips.go         # 剪辑 CRUD + 导出
│   ├── ws/                  # WebSocket handler
│   │   └── stream.go        # 连续帧推送
│   ├── decoder/             # 协议解码器
│   │   ├── decoder.go       # interface 定义
│   │   ├── position.go      # DataType=1 位置解码
│   │   ├── event.go         # DataType=2/5 事件解码
│   │   ├── stats.go         # DataType=3 统计解码
│   │   └── system.go        # DataType=8/10 系统解码
│   ├── hotspot/             # 热点算法引擎
│   │   ├── engine.go        # 综合评分计算
│   │   ├── grid.go          # 空间网格分区
│   │   └── director.go      # 导播切换逻辑
│   ├── index/               # 时间索引 + 缓存
│   │   ├── timeindex.go     # timestamp → rowid 映射
│   │   └── cache.go         # LRU 缓存
│   └── scanner/             # 目录扫描
│       └── scanner.go       # .db 文件发现 + 元信息解析
├── web/                     # React 前端
│   ├── src/
│   │   ├── App.tsx          # 路由 + 布局
│   │   ├── components/      # shadcn/ui 组件
│   │   │   ├── TopBar.tsx   # 顶栏 + 模式切换
│   │   │   ├── GameList.tsx # 活动选择器
│   │   │   └── UnitTooltip.tsx
│   │   ├── map/             # 地图渲染层
│   │   │   ├── MapView.tsx  # Mapbox GL 容器
│   │   │   ├── UnitLayer.tsx # 单位图层
│   │   │   ├── TrailLayer.tsx # 轨迹图层
│   │   │   └── HeatmapLayer.tsx # 热力图层
│   │   ├── timeline/        # 多轨时间轴
│   │   │   ├── Timeline.tsx # 主组件
│   │   │   ├── Track.tsx    # 单轨道
│   │   │   └── Playhead.tsx # 播放头
│   │   ├── director/        # 导播面板
│   │   │   ├── DirectorPanel.tsx
│   │   │   ├── PreviewGrid.tsx # 4 预览窗口
│   │   │   └── AutoSwitch.tsx  # 自动/手动切换
│   │   ├── clips/           # 书签/剪辑管理
│   │   │   ├── BookmarkList.tsx
│   │   │   ├── ClipEditor.tsx
│   │   │   └── ExportDialog.tsx
│   │   └── store/           # Zustand 状态
│   │       ├── playback.ts  # 播放状态
│   │       ├── director.ts  # 导播状态
│   │       └── clips.ts     # 书签/剪辑状态
│   ├── index.html
│   └── vite.config.ts
└── README.md
```

## Game ID 与文件命名

**文件名格式**: `<session>_<start>_<end>.db`，例如 `9_2026-01-17-11-40-00_2026-01-17-20-00-11.db`

**Game ID 派生规则**: 使用文件名（去除 `.db` 后缀）的 SHA256 前 8 位十六进制作为 ID。例如 `9_2026-01-17-11-40-00_2026-01-17-20-00-11` → `a3f1c9d2`。

**冲突处理**: 若发生 hash 冲突（极不可能），追加数字后缀 `-1`, `-2`。

**API 示例**: `GET /api/games/a3f1c9d2/meta`

**展示名称**: 活动列表中显示解析后的时间范围和 session 号（如 "Session 9 · 2026-01-17 11:40 ~ 20:00"），ID 仅用于 API 路由。

## 部署

- 本地单人使用：`./wargame-replay --dir /path/to/db/files`
- 局域网共享：`./wargame-replay --dir /path/to/db/files --host 0.0.0.0 --port 8080`
- 无需认证

## 非功能需求

- 启动时间: <5s（索引构建 + 热点预计算）
- 回放帧率: 稳定 1fps 数据推送（UI 动画 60fps 插值）
- Seek 延迟: <200ms（LRU 缓存命中时）
- 内存占用: <200MB（缓存 100MB + 索引/热点 ~50MB + 系统开销）
