# 彩云天气 Rust 版

一个用 Rust + Axum 编写的极简天气与定位服务，前端为纯静态页面（无需构建），遵循 KISS 原则。

后端调用彩云天气 v2.6 接口并直出前端需要的数据结构，支持中文返回与图标合成（云遮月等）；定位优先使用官方 IP 定位接口，必要时回退到高德。

## 功能特性

- 纯 Rust 后端：`axum` + `tower-http` + `reqwest`（`rustls`）
- JSON API：统一 `application/json; charset=utf-8`，启用 gzip/br 压缩与 CORS
- 中文返回：向彩云接口追加 `lang=zh_CN`，字段与描述均为中文
- 图标映射：将 skycon 代码映射为中文+emoji；夜间多云使用“云遮月”组合图标（单个 HTML 片段）
- 定位能力：
  - `GET /api/location/ip`：官方接口优先，3 秒超时；失败返回默认坐标（北京）
  - `GET /api/location/geocode` `GET /api/location/search`：高德接口，失败返回空/默认
- 前端：原生静态资源（`static/`），包含 PWA/Service Worker，适配移动端

## 目录结构

```
├─ src/                 # Rust 服务（axum 路由、彩云/高德调用、数据整形）
├─ static/              # 静态站点（HTML/CSS/JS/图标）
│  ├─ styles.css        # 玻璃拟态样式、时间主题、图标叠放 .icon-stacked
│  ├─ script.js         # 获取定位、请求后端、渲染 UI（小时/日预报）
│  └─ sw.js             # Service Worker（缓存与更新提示）
├─ .env.example         # 环境变量示例
├─ Cargo.toml           # Rust 依赖与配置
└─ README.md            # 本文档
```

## 环境要求

- Rust 1.79+（Windows 需安装 Visual C++ Build Tools 以提供 `link.exe`）
- 网络可访问彩云/高德等接口

## 快速开始

1) 复制环境变量

```
cp .env.example .env
```

填写：

- `CAIYUN_API_TOKEN`：彩云天气 API Token
- `AMAP_API_KEY`：高德 Web API Key（可选，用于地理查询/回退）
- `PORT`：服务端口，默认 `8000`

2) 运行开发服务

```
cargo run
```

日志：

```
# 可选：增加日志
$env:RUST_LOG="info,tower_http=info"   # PowerShell
# 或 export RUST_LOG=info,tower_http=info（bash/zsh）
```

3) 生产构建

```
cargo build --release
./target/release/caiyun-weather-rust
```

建议使用 Caddy/Nginx 反代，启用 TLS 与 gzip/br（前端静态资源可直接交由反代托管）。

## API 说明

基础 URL：`http://localhost:8000`

- `GET /api/weather?lng=<经度>&lat=<纬度>`
  - 说明：从彩云获取实况、小时、3 日数据并整形返回；强制 `lang=zh_CN`
  - 示例：`/api/weather?lng=116.4074&lat=39.9042`

- `GET /api/location/ip`
  - 说明：基于客户端 IP 的粗定位，失败回退默认坐标

- `GET /api/location/geocode?lng=<经度>&lat=<纬度>`
  - 说明：坐标 → 地址（高德）

- `GET /api/location/search?q=<关键字>`
  - 说明：地点关键字搜索（高德），失败返回空列表

返回示例（节选）：

```json
{
  "current": {
    "temperature": 24,
    "skycon": "PARTLY_CLOUDY_NIGHT",
    "weather_info": { "icon": "<span class=\"icon-stacked\">…</span>", "desc": "多云（夜间）" },
    "air_quality": { "aqi": { "chn": 54 }, "description": { "chn": "良" } }
  },
  "hourly": [ { "time": 1, "temperature": 24, "weather_info": { … } } ],
  "daily":  [ { "date": "08-30", "skycon": "…", "weather_info": { … } } ],
  "forecast_keypoint": "…"
}
```

## 前端说明

- 图标组合：夜间多云（`PARTLY_CLOUDY_NIGHT`）返回单个 HTML 片段，前端用 `innerHTML` 渲染；样式 `.icon-stacked` 负责“云遮月”的层叠与对齐。
- 小时/日预报：模板已直接插入 `weather_info.icon`，支持组合图标；`.hourly-icon`/`.daily-icon` 使用 `flex` 居中。
- Service Worker：更新后首次加载可能命中缓存，若样式/脚本未生效，请 Ctrl+F5 或点击页面的“有更新”提示进行刷新。

## 部署建议

- 反向代理：
  - Caddy（示例）：
    ```
    example.com {
      reverse_proxy 127.0.0.1:8000
      encode zstd gzip
    }
    ```
- 资源缓存：让反代托管 `static/`，并开启静态缓存。
- 运行参数：使用 `RUST_LOG` 控制日志级别，`PORT` 控制端口。

## 维护约定

- 遵循 KISS：减少不必要抽象与依赖
- 后端不做前端构建，仅提供静态目录与 JSON API
- 更新依赖前先本地 `cargo build` + 手动回归主要 API

## 许可

MIT
