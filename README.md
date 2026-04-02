# MilSim Replay

[![CI](https://img.shields.io/github/actions/workflow/status/s045pd/wargame-replay/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/s045pd/wargame-replay/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/s045pd/wargame-replay?style=flat-square)](https://github.com/s045pd/wargame-replay/releases)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?style=flat-square&logo=go)](https://go.dev)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![License](https://img.shields.io/github/license/s045pd/wargame-replay?style=flat-square)](LICENSE)

MilSim 对局回放系统 — 将 `.db` 对局数据库文件可视化为交互式战场回放。

单文件可执行程序，内嵌前端，开箱即用。

<p align="center">
  <img src="media/demo.gif" alt="MilSim Replay Demo" width="800">
</p>

## 功能特性

### 核心功能

- **交互式战场地图** — 基于 MapLibre GL 的实时单位渲染、移动轨迹、HP 系统
- **热点检测引擎** — 自动识别交火、连杀、大规模伤亡、远距离击杀、轰炸等战场关键事件
- **导播模式** — AI 辅助镜头切换，多预览窗格，自动追踪热点事件，聚焦模式（地图压暗 + 减速）
- **时间轴与回放** — 多轨时间轴、1x–128x 变速播放、热点事件标记、沉浸模式
- **书签与片段** — 标记关键时刻、创建/编辑片段、视频录制导出、热点自动建议
- **89 项可配置参数** — 8 页设置面板，覆盖颜色、动画、镜头、弹道、导播等，支持 JSON 导入/导出/重置

### 地图与图层

- **6 种地图源** — 卫星 (ESRI)、暗色 (CARTO)、地形 (CARTO)、亮色 (CARTO)、OSM、等高线 (OpenTopo)；可选 Mapbox 高清升级
- **单位图层** — 步枪、机枪、狙击、医疗兵等 5 种兵种 Canvas 图标，存活/阵亡状态
- **轨迹图层** — 单位移动历史轨迹
- **热点图层** — 战斗热点圆圈 + 标签 + 实时活动指示环
- **POI 图层** — 基地、补给点、控制点等战场设施
- **基地图层** — 红蓝双方基地标记
- **轰炸图层** — 轰炸事件可视化（含爆炸半径）
- **狙击弹道图层** — 远距离击杀弹道线（可配速度、宽度、拖尾、发光）
- **栅格图层** — 战区坐标网格（R→A 列，1→15 行）
- **击杀排行榜** — 实时击杀/阵亡排行
- **事件 Toast** — 击杀、复活、治疗等事件即时弹窗通知

### 其他特性

- **文件上传** — Web 界面直接拖拽上传 `.db` 对局文件
- **双坐标系** — 支持 WGS84 (GPS) 和相对坐标，自动检测
- **中英双语** — 界面支持中文 / English 切换
- **单文件部署** — Go 编译为单个可执行文件，内嵌全部前端资源
- **自动打开浏览器** — 启动后自动打开 Chrome --app 模式（无地址栏），支持 `-open` / `-app` 参数
- **玩家搜索** — 按名称搜索并跟踪指定单位
- **视频录制** — 录制回放为 WebM 视频文件，支持片段导出
- **免费瓦片缩放保护** — 使用免费地图源时自动限制最大缩放级别，防止 "Map data not yet available"

## 快速开始

### 使用预编译版本

从 [Releases](https://github.com/s045pd/wargame-replay/releases) 下载对应平台的压缩包：

| 平台 | 文件 |
|------|------|
| Windows x64 | `wargame-replay-windows-amd64.zip` |
| Windows ARM64 | `wargame-replay-windows-arm64.zip` |
| macOS Intel | `wargame-replay-darwin-amd64.tar.gz` |
| macOS Apple Silicon | `wargame-replay-darwin-arm64.tar.gz` |
| Linux x64 | `wargame-replay-linux-amd64.tar.gz` |
| Linux ARM64 | `wargame-replay-linux-arm64.tar.gz` |

**macOS** — 解压后双击 `MilSim Replay.app`，自动启动服务并打开浏览器。数据默认存放在 `~/MilSimReplay/`。

> ⚠️ 首次打开 macOS 可能提示"无法验证开发者"，请：
> - 右键点击 → 打开（推荐），或
> - 终端运行：`xattr -cr MilSim\ Replay.app`

**Windows / Linux** — 解压后命令行启动：

```bash
./wargame-replay -dir ./data

# 浏览器打开 http://127.0.0.1:8080
```

也可以启动后通过 Web 界面直接拖拽上传 `.db` 文件。

> macOS 压缩包同时包含 `.app` 和裸二进制文件 `wargame-replay`，命令行用户可直接使用后者。

### 命令行参数

```
Usage:
  wargame-replay [flags]

Flags:
  -dir string    包含 .db 文件的目录 (默认 ".")
  -host string   监听地址 (默认 "127.0.0.1")
  -port int      监听端口 (默认 8080)
  -open          自动打开浏览器 (默认 true，-open=false 禁用)
  -app           优先使用 Chrome/Edge --app 模式 (默认 true，无地址栏)
```

### 数据库文件命名

`.db` 文件需遵循以下命名格式：

```
{场次}_{开始时间}_{结束时间}.db
```

示例：`69_2026-03-28-12-15-00_2026-03-28-18-00-00.db`

可选的 `.txt` 元数据文件与 `.db` 同名，包含地图坐标校准和栅格信息。

## 从源码构建

### 前置依赖

- [Go](https://go.dev/dl/) >= 1.25（需要 CGO 支持，SQLite 驱动要求）
- [Node.js](https://nodejs.org/) >= 20
- C 编译器（macOS: Xcode CLT, Linux: gcc, Windows: mingw-w64）

### 一键构建

```bash
make build
```

生成的 `wargame-replay` 即为包含前端的完整可执行文件。

### 分步构建

```bash
# 1. 构建前端
cd web && npm ci && npm run build && cd ..

# 2. 复制到 Go embed 目录
rm -rf server/static && cp -r web/dist server/static

# 3. 编译 Go 二进制（需要 CGO）
cd server && CGO_ENABLED=1 go build -trimpath \
  -ldflags="-s -w -X main.version=$(git describe --tags)" \
  -o ../wargame-replay .
```

### 开发模式

需要两个终端：

```bash
# 终端 1: Go 后端（热重载需手动重启）
cd server && go run . -dir /path/to/db/files -port 8081

# 终端 2: Vite 前端开发服务器（自动热更新）
cd web && npm run dev
```

前端开发服务器会自动代理 `/api` 和 `/ws` 请求到后端（端口 8081）。

## 项目结构

```
wargame-replay/
├── Makefile                  # 构建脚本
├── .github/workflows/
│   ├── ci.yml                # CI: lint + test + smoke build
│   └── release.yml           # Release: 6 平台交叉编译 + GitHub Release
├── assets/                   # 应用图标资源 (SVG, PNG, ICO)
├── server/                   # Go 后端
│   ├── main.go               # HTTP/WS 服务入口
│   ├── embed.go              # 前端静态资源嵌入
│   ├── api/                  # REST API (Gin)
│   │   ├── games.go          # 游戏列表、元数据
│   │   ├── frames.go         # 帧数据查询
│   │   ├── upload.go         # 文件上传（原子写入）
│   │   ├── bookmarks.go      # 书签 CRUD
│   │   ├── clips.go          # 片段 CRUD & 导出
│   │   └── unitclasses.go    # 单位分类覆盖
│   ├── decoder/              # .db 二进制协议解析
│   ├── game/                 # 游戏服务层（帧组装、HP 校准）
│   ├── hotspot/              # 热点检测引擎（聚类、分类、缓存）
│   ├── scanner/              # 目录扫描器
│   ├── index/                # 时间索引 & 100MB LRU 缓存
│   ├── ws/                   # WebSocket 实时帧推流
│   └── winres/               # Windows 可执行文件资源（图标、清单）
├── web/                      # React 前端
│   └── src/
│       ├── map/              # MapLibre GL 地图组件（15 个图层）
│       ├── timeline/         # 时间轴 & 播放控制
│       ├── director/         # 导播模式面板
│       ├── clips/            # 书签 & 片段编辑器 & 视频录制
│       ├── store/            # Zustand 状态管理（5 个 store）
│       ├── hooks/            # 自定义 Hooks（自动导播逻辑）
│       ├── components/       # 通用 UI 组件（8 页设置面板、搜索、快捷键）
│       └── lib/              # API 客户端、WebSocket、i18n、设置 API
```

详细代码结构参见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 + 版本号 |
| `GET` | `/api/games` | 获取游戏列表 |
| `GET` | `/api/games/:id/meta` | 获取游戏元数据（玩家、边界、栅格） |
| `GET` | `/api/games/:id/frame/:ts` | 获取指定时间帧快照 |
| `GET` | `/api/games/:id/hotspots` | 获取全部热点事件 |
| `POST` | `/api/upload` | 上传 .db 文件（支持拖拽多文件） |
| `DELETE` | `/api/games/:id` | 删除游戏及所有伴随文件 |
| `GET` | `/api/games/:id/bookmarks` | 获取书签列表 |
| `POST` | `/api/games/:id/bookmarks` | 创建书签 |
| `DELETE` | `/api/games/:id/bookmarks/:idx` | 删除书签 |
| `GET` | `/api/games/:id/bookmarks/suggest` | 热点自动建议书签 |
| `GET` | `/api/games/:id/clips` | 获取片段列表 |
| `POST` | `/api/games/:id/clips` | 创建片段 |
| `PUT` | `/api/games/:id/clips/:idx` | 更新片段 |
| `DELETE` | `/api/games/:id/clips/:idx` | 删除片段 |
| `GET` | `/api/games/:id/clips/:idx/export` | 导出片段数据 |
| `GET` | `/api/games/:id/unitclasses` | 获取单位分类 |
| `PUT` | `/api/games/:id/unitclasses` | 保存单位分类 |
| `WS` | `/ws/games/:id/stream` | 实时帧推流 |

## 技术栈

**后端**
- Go 1.25 + Gin (HTTP) + Gorilla WebSocket
- SQLite3 (CGO, `mattn/go-sqlite3`, 只读模式)
- 内嵌静态文件 (`go:embed`)
- go-winres (Windows 可执行文件图标/清单)

**前端**
- React 19 + TypeScript 5.8
- MapLibre GL JS 5 (开源地图引擎)
- Zustand 5 (状态管理)
- Tailwind CSS 4
- Lucide React (图标)
- Vite 6 (构建工具)

**CI/CD**
- GitHub Actions
- Zig CC 交叉编译 (Linux + Windows targets)
- 6 平台矩阵构建 (Windows/macOS/Linux × x64/ARM64)
- 自动 Release + SHA256 校验和

## 键盘快捷键

| 按键 | 功能 |
|------|------|
| `Space` | 播放 / 暂停 |
| `H` | 切换沉浸模式（隐藏 UI） |
| `Tab` | 切换回放 / 导播模式 |
| `A` | 开关自动导播 |
| `T` | 切换 3D 倾斜模式 |
| `D` | 切换热点调试叠加层 |
| `B` | 切换书签面板 |
| `Shift+B` | 在当前时间添加书签 |
| `C` | 切换片段编辑器 |
| `,` | 打开设置面板 |
| `?` | 显示快捷键帮助 |
| `Esc` | 关闭弹窗 |

## 版本发布

```bash
# 创建带注释的 tag 并推送，自动触发 GitHub Actions 构建 + 发布
make release V=v1.0.0
```

版本号注入到 Go 二进制 (`main.version`)，可通过 `/api/health` 查询。

## License

MIT
