# MilSim Replay

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

- **交互式战场地图** — 基于 Mapbox GL 的实时单位渲染、移动轨迹、HP 系统
- **热点检测引擎** — 自动识别交火、连杀、大规模伤亡等战场关键事件
- **导播模式** — AI 辅助镜头切换，多预览窗格，自动追踪热点事件
- **时间轴与回放** — 多轨时间轴、变速播放、沉浸模式
- **书签与片段** — 标记关键时刻、创建片段、导出数据
- **POI 图层** — 基地、补给点、控制点等战场设施可视化
- **文件上传** — 通过 Web 界面直接上传 `.db` 对局文件
- **双坐标系** — 支持 WGS84 (GPS) 和相对坐标
- **中英双语** — 界面支持中文 / English 切换
- **单文件部署** — Go 编译为单个可执行文件，内嵌全部前端资源

## 快速开始

### 使用预编译版本

从 [Releases](https://github.com/s045pd/wargame-replay/releases) 下载对应平台的可执行文件：

| 平台 | 文件 |
|------|------|
| Windows x64 | `wargame-replay-windows-amd64.exe` |
| Windows ARM64 | `wargame-replay-windows-arm64.exe` |
| macOS Intel | `wargame-replay-darwin-amd64` |
| macOS Apple Silicon | `wargame-replay-darwin-arm64` |
| Linux x64 | `wargame-replay-linux-amd64` |
| Linux ARM64 | `wargame-replay-linux-arm64` |

```bash
# 将 .db 文件放在同一目录下，启动服务
./wargame-replay -dir ./data

# 打开浏览器访问
# http://127.0.0.1:8080
```

也可以启动后通过 Web 界面直接上传 `.db` 文件。

### 命令行参数

```
Usage:
  wargame-replay [flags]

Flags:
  -dir string    包含 .db 文件的目录 (默认 ".")
  -host string   监听地址 (默认 "127.0.0.1")
  -port int      监听端口 (默认 8080)
```

### 数据库文件命名

`.db` 文件需遵循以下命名格式：

```
{场次}_{开始时间}_{结束时间}.db
```

示例：`69_2026-03-28-12-15-00_2026-03-28-18-00-00.db`

## 从源码构建

### 前置依赖

- [Go](https://go.dev/dl/) >= 1.21（需要 CGO 支持，SQLite 驱动要求）
- [Node.js](https://nodejs.org/) >= 18
- C 编译器（macOS: Xcode CLT, Linux: gcc, Windows: mingw-w64）

### 一键构建

```bash
make build
```

生成的 `wargame-replay` 即为包含前端的完整可执行文件。

### 分步构建

```bash
# 1. 构建前端
cd web && npm install && npm run build && cd ..

# 2. 复制到 Go embed 目录
rm -rf server/static && cp -r web/dist server/static

# 3. 编译 Go 二进制（需要 CGO）
cd server && CGO_ENABLED=1 go build -o ../wargame-replay .
```

### 开发模式

需要两个终端：

```bash
# 终端 1: Go 后端（热重载需手动重启）
cd server && go run . -dir /path/to/db/files -port 8081

# 终端 2: Vite 前端开发服务器（自动热更新）
cd web && npm run dev
```

前端开发服务器会自动代理 `/api` 和 `/ws` 请求到后端。

## 项目结构

```
wargame-replay/
├── Makefile                  # 构建脚本
├── server/                   # Go 后端
│   ├── main.go               # HTTP/WS 服务入口
│   ├── embed.go              # 前端静态资源嵌入
│   ├── api/                  # REST API
│   │   ├── games.go          # 游戏列表、元数据
│   │   ├── frames.go         # 帧数据查询
│   │   ├── upload.go         # 文件上传
│   │   ├── bookmarks.go      # 书签 CRUD
│   │   ├── clips.go          # 片段 CRUD & 导出
│   │   └── unitclasses.go    # 单位分类
│   ├── decoder/              # .db 文件解析器
│   ├── game/                 # 游戏服务层
│   ├── hotspot/              # 热点检测引擎
│   ├── scanner/              # 目录扫描器
│   ├── index/                # 时间索引 & LRU 缓存
│   └── ws/                   # WebSocket 实时流
├── web/                      # React 前端
│   └── src/
│       ├── map/              # Mapbox GL 地图组件
│       ├── timeline/         # 时间轴 & 播放控制
│       ├── director/         # 导播模式
│       ├── clips/            # 书签 & 片段编辑
│       ├── store/            # Zustand 状态管理
│       ├── hooks/            # 自定义 Hooks
│       ├── components/       # 通用 UI 组件
│       └── lib/              # API 客户端、i18n、工具
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/games` | 获取游戏列表 |
| `GET` | `/api/games/:id/meta` | 获取游戏元数据 |
| `GET` | `/api/games/:id/frame/:ts` | 获取指定时间帧 |
| `GET` | `/api/games/:id/hotspots` | 获取全部热点事件 |
| `POST` | `/api/upload` | 上传 .db 文件 |
| `DELETE` | `/api/games/:id` | 删除游戏 |
| `GET` | `/api/games/:id/bookmarks` | 获取书签列表 |
| `POST` | `/api/games/:id/bookmarks` | 创建书签 |
| `GET` | `/api/games/:id/clips` | 获取片段列表 |
| `POST` | `/api/games/:id/clips` | 创建片段 |
| `GET` | `/api/games/:id/clips/:idx/export` | 导出片段数据 |
| `WS` | `/ws/games/:id/stream` | 实时帧推流 |

## 技术栈

**后端**
- Go + Gin (HTTP) + Gorilla WebSocket
- SQLite3 (CGO, 只读模式打开对局数据库)
- 内嵌静态文件 (`go:embed`)

**前端**
- React 19 + TypeScript 5.8
- Mapbox GL JS 3.12
- Zustand (状态管理)
- Tailwind CSS 4
- Vite 6 (构建工具)

## 键盘快捷键

| 按键 | 功能 |
|------|------|
| `Space` | 播放 / 暂停 |
| `H` | 切换沉浸模式 |
| `D` | 切换导播模式 |
| `A` | 开关自动导播 |
| `O` | 热点调试叠加层 |
| `B` | 在当前时间添加书签 |

## License

MIT
