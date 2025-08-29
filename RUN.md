运行与开发

- 先准备 Rust 环境（建议 Rust 1.79+）。Windows 需安装 Visual C++ Build Tools（含 MSVC 链接器 `link.exe`）。
- 复制 `.env.example` 为 `.env`，填写：
  - `CAIYUN_API_TOKEN`（彩云天气）
  - `AMAP_API_KEY`（高德 Web API）
  - `PORT`（默认 8000）

命令

- 开发启动：`cargo run`
- 构建发布：`cargo build --release`

接口

- `GET /api/weather?lng=116.4&lat=39.9`
- `GET /api/location/ip`（美团 IP 定位，使用官方接口）
- `GET /api/location/geocode?lng=116.4&lat=39.9`（高德逆地理）
- `GET /api/location/search?q=北京`（高德搜索，失败返回空）
- 静态资源：`/`、`/index.html`、`/static/*`、`/favicon.ico`

部署建议

- 建议前置 Caddy/Nginx，转发到 Rust 进程端口；开启 gzip/br、缓存与 TLS。
