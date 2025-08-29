# Rust 迁移需求与任务拆解（更新）

## 背景与目标
- 目标: 将当前 Deno + TypeScript 服务完整迁移为 Rust 实现，保持对现有前端与部署方式完全兼容，遵守 KISS 原则。
- 要求: 路由、查询参数、状态码、响应 JSON 结构、静态资源路径与缓存、CORS 行为必须与现有实现一致；外部三方 API 的调用顺序、超时与回退策略保持一致。
- 非目标: 不改动前端 `static/*`；不改变业务字段含义与单位；不引入与功能无关的大改造。

## 范围
- API 路由: `/api/location/ip`、`/api/location/geocode`、`/api/location/search`、`/api/weather`。
- 静态资源与首页: `/`、`/index.html`、`/static/*`、`/favicon.ico`。
- 环境变量: `CAIYUN_API_TOKEN`、`AMAP_API_KEY`、`PORT`。
- 外部服务: 彩云天气 v2.6、高德 POI 搜索（保留）、美团 IP 定位/逆地理。
- 客户端 IP 提取与校验: 头部优先级、端口剥离、IPv6 规范化、公私网段校验。

## 运行环境与工具链
- Rust: 稳定版（例如 1.79+）。
- 依赖建议（不写代码，仅标注库级别方案）:
  - Web: Axum。
  - 运行时: Tokio。
  - HTTP 客户端: Reqwest（HTTP/2、压缩、超时）。
  - 中间件/静态/CORS/压缩: tower-http。
  - 配置: dotenvy（可选，兼容 `.env`）。
  - 序列化: Serde/serde_json。
- 部署: 继续使用 Caddy 反代；Rust 服务监听本地端口。

## 环境变量
- `CAIYUN_API_TOKEN`: 彩云 API Token；缺失时 `/api/weather` 返回“开发模拟数据”。
- `AMAP_API_KEY`: 高德 Web API Key（保留）。
- `PORT`: 监听端口。统一默认 `8000`，可通过环境变量覆盖。

## HTTP 路由与行为
- `/api/location/ip` [GET]
  - 无查询参数。
  - 动作: 解析真实客户端 IP → 校验公网 → 调用美团 IP 定位 API 获取 `{ lat,lng,address }`；解析失败或非公网 IP → 返回默认 `{ lat:39.9042,lng:116.4074,address:"北京市" }`。
  - 成功: `200 { lat:number, lng:number, address:string }`。
  - 失败: `404 { error }`（定位为空）；异常: `500 { error }`。
  - 响应头: `Content-Type: application/json; charset=utf-8`、`Access-Control-Allow-Origin: *`。

- `/api/location/geocode` [GET]
  - 参数: `lat:number`、`lng:number`（缺参 → 400）。
  - 动作: 使用美团逆地理，失败时返回 `'未知位置'`（不再调用 Nominatim）。
  - 成功: `200 { address:string }`；异常: `500 { error }`。
  - 响应头同上。

- `/api/location/search` [GET]
  - 参数: `q:string`（缺参 → 400）。
  - 动作: 
    1) 本地热门城市库模糊匹配（命中直接返回）；
    2) 若有 `AMAP_API_KEY`，调用高德 `place/text`（3s 超时，取前 5 条）；
    3) 若高德失败或无结果，回退到本地模糊匹配（不再调用 Photon/Nominatim）。
  - 成功: `200 { results: Array<{ lat:number, lng:number, name:string, address:string }> }`；异常: `500 { error }`。
  - 响应头同上。

- `/api/weather` [GET]
  - 参数: `lng:number`、`lat:number`（缺参 → 400）。
  - 动作: 
    - 若存在 `CAIYUN_API_TOKEN`：请求彩云 v2.6 综合接口，校验 `response.ok` 且 `status === "ok"`，再格式化为前端所需结构；
    - 若缺失 Token：返回内置“开发模拟数据”，字段结构与单位完全一致。
  - 成功: `200 WeatherData`；异常: `500 { error }`。
  - 响应头同上。

- 其他路由
  - `/favicon.ico`: 返回内嵌 SVG；`Cache-Control: public, max-age=86400`。
  - `/`、`/index.html`: 返回 `./static/index.html` 文件内容（UTF-8）。
  - `/static/*`: 映射 `./static` 目录（路径保持不变，保证 PWA 文件可访问）。
  - 未匹配: `404` 文本响应“页面未找到”。

## WeatherData 数据契约（/api/weather）
- `current: {
    temperature: number,                // °C，四舍五入
    apparent_temperature: number,       // °C
    humidity: number,                   // %，0–100，源值×100 后四舍五入
    wind_speed: number,                 // km/h，由 m/s×3.6 后四舍五入
    wind_direction: number,             // °
    pressure: number,                   // hPa，由 Pa/100 后四舍五入
    visibility: number,                 // 透传
    skycon: string,                     // 彩云现象枚举
    weather_info: { icon: string, desc: string },
    air_quality: object                 // 至少含 aqi.chn、description.chn、pm25、pm10、o3
  }`
- `hourly: Array<{ time:number, temperature:number, skycon:string, weather_info:{icon:string, desc:string} }>`
  - 长度 24；`time` 为 0–23，按 `timezoneOffset = round(lng/15)` 推算：`time = (localHour + index) % 24`。
- `daily: Array<{ date:string, weekday:string, relativeDay:string, max_temp:number, min_temp:number, skycon:string, weather_info:{icon,desc}, life_index: { ultraviolet:any, carWashing:any, dressing:any, comfort:any, coldRisk:any } }>`
  - 长度 3；relativeDay 为“今天/明天/后天”。
- `forecast_keypoint: string`（缺省“暂无预报信息”）。
- 备注: 通过 `SKYCON_MAP` 将 `skycon` 映射为 `{icon, desc}`，键集覆盖 CLEAR_DAY/NIGHT、PARTLY_CLOUDY_DAY/NIGHT、CLOUDY、HAZE、RAIN、SNOW、DUST/SAND、WIND 等。

## 外部服务与超时/回退
- 彩云天气 v2.6: `https://api.caiyunapp.com/v2.6/{TOKEN}/{lng},{lat}/weather?alert=true&dailysteps=3&hourlysteps=24`；校验 `ok` 与 `status=="ok"`。
- 高德 POI 搜索（保留）: `restapi.amap.com/v3/place/text?...`，超时 3s，UA `CaiyunWeatherApp/1.0`。
- 美团 IP/逆地理: `apimobile.meituan.com/...`，超时 3s；需浏览器 UA、Referer、Accept 等头。
- 回退顺序（更新后）:
  - 搜索: 本地匹配 → 高德 → 本地模糊回退；
  - 逆地理: 美团 → 返回默认“未知位置”（不再调用 Nominatim）。
  - 天气: 彩云失败抛错（无 Token 返回模拟数据）。

## 客户端 IP 解析与校验
- 头部优先级: `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for`（逗号多值取首个有效公网 IP）→ `x-client-ip` → `true-client-ip` → `x-forwarded` → `forwarded-for` → `forwarded` → `x-cluster-client-ip` → 连接信息。
- 端口剥离: 处理 `[IPv6]:port`、`::ffff:<IPv4>:port`、`IPv4:port`；IPv6 仅一处冒号且为 `IPv4:port` 时识别为 IPv4。
- IPv6 规范化: 去方括号、转小写；`::ffff:x.x.x.x` 映射还原为 IPv4。
- 公网校验: 排除 127.0.0.0/8、10.0.0.0/8、192.168.0.0/16、172.16.0.0/12、169.254.0.0/16、`::1`、`fe80:`、`fc00:`、`fd00:`。
- 失败策略: 未获得有效公网 IP 时返回 `'auto'`，定位逻辑回退默认坐标（北京）。

## 静态资源与缓存策略
- 路径映射: `/` 与 `/index.html` 返回 `./static/index.html`；`/static/*` 映射 `./static`；`/static` 与 `/static/` 301 重定向到 `/`；`/favicon.ico` 返回 SVG。
- 缓存: `favicon.ico` → `Cache-Control: public, max-age=86400`；其他静态文件默认直出。
- PWA: 保持前端对 `/static/sw.js`、`/static/manifest.json`、`/static/icons/*` 的访问路径不变。

## 错误与响应头
- 所有 JSON 响应: `Content-Type: application/json; charset=utf-8`；CORS: `Access-Control-Allow-Origin: *`。
- 状态码: 缺参 `400`；方法不允许 `405`；未匹配 `404`；外部依赖错误/内部异常 `500`。
- 错误对象统一 `{ error: string }`。

## 目录结构建议（Rust）
- `src/main.rs`（启动、路由挂载、全局中间件）
- `src/routes/{weather.rs, location.rs, static.rs}`（路由与处理器）
- `src/services/{caiyun.rs, geocode.rs, search.rs, ip.rs}`（外部 API 调用与回退）
- `src/models/{weather.rs, location.rs}`（请求/响应结构体与序列化）
- `src/utils/{ip.rs, time.rs, skycon.rs, error.rs}`（公共函数与错误处理）
- `static/`（沿用现有目录，不改动）

## 任务拆解（里程碑）
- M0 准备
  - 选型与依赖确认：Axum + Tokio + Reqwest + tower-http + Serde（仅文档确认）。
  - 端口默认改为 `8000`；确认 `.env` 行为。
- M1 最小可运行骨架
  - 启动/关闭、健康检查、CORS、统一 JSON 头；挂载静态与首页、favicon；405/404 处理。
- M2 天气接口 `/api/weather`
  - 对接彩云 v2.6；实现 `formatWeatherData` 映射与单位换算；缺 Token 返回模拟数据；小时序列基于经度推算本地时。
- M3 逆地理 `/api/location/geocode`
  - 美团逆地理；失败返回“未知位置”；3s 超时；错误兜底。
- M4 搜索 `/api/location/search`
  - 本地热门城市库；高德 3s；失败/无结果回退本地模糊；限制返回 5 条。
- M5 IP 定位 `/api/location/ip`
  - 头部链解析、端口剥离、IPv6 规范化、公网校验；美团 IP 定位 + 3s 超时 + 兜底默认坐标。
- M6 横向治理
  - 统一错误对象、日志分级、请求超时、User-Agent；CORS 与缓存头一致性校验；端到端联调前端。
- M7 验收与文档
  - 对照“验收清单”逐项验证；更新 README 与部署说明（不改前端）。

## 验收清单
- 路由可达性: 四个 API + 三个静态路由工作正常；错误方法 `405`；未匹配 `404`。
- `/api/weather`: `hourly` 长度=24、`daily` 长度=3；单位与四舍五入一致；`forecast_keypoint` 存在；缺 Token 时返回模拟数据结构一致。
- `/api/location/search`: 本地→高德→本地；在无网络/限流下能返回本地回退结果；结果字段与类型一致。
- `/api/location/geocode`: 正常返回中文地址；失败时“未知位置”；UTF-8。
- `/api/location/ip`: 在多种代理头场景下能正确提取公网 IP；无法提取时回退默认坐标。
- 响应头: 所有 JSON 含 `charset=utf-8` 与 `Access-Control-Allow-Origin: *`；`/favicon.ico` 缓存 86400。
- 静态资源: `/static/*`、PWA 文件可访问；`/` 返回 `static/index.html`。

## 风险与回退
- 三方 API 限流/不可用: 通过超时与回退保护，保证交互不被阻塞；允许空数组或默认坐标/“未知位置”。
- 端口冲突: 支持 `PORT` 覆盖；默认端口已改为 `8000`。
- 外部跨境访问: 若部署在海外，国内服务（彩云/高德/美团）可能变慢；建议靠近上游部署或配置代理。

## 后续可选优化（迁移完成后）
- 上游结果内存缓存（3–5 分钟）与请求去重；连接池/HTTP/2；ETag/Cache-Control；静态资源压缩与长缓存；错误分级与告警。

## 需确认点
- 高德配额是否充足（若失败即回退本地模糊）。
- 是否需要系统级服务脚本与部署文档（systemd + Caddy）。

