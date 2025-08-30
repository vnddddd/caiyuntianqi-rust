use std::{net::SocketAddr, time::Duration};

use axum::{
    extract::{Query, State},
    http::{HeaderValue, StatusCode},
    response::{Html, IntoResponse},
    routing::{get},
    Json, Router,
};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::fs;
use tower::ServiceBuilder;
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    services::ServeDir,
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing::info;
use chrono::{Datelike, Timelike, Local, Days, Weekday};

static CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .http2_adaptive_window(true)
        .gzip(true)
        .brotli(true)
        .timeout(Duration::from_secs(10))
        .build()
        .expect("reqwest client")
});

#[derive(Clone)]
struct AppState {
    caiyun_token: Option<String>,
    amap_key: Option<String>,
}

#[derive(Deserialize)]
struct WeatherQuery { lng: f64, lat: f64 }

#[derive(Serialize)]
struct ErrorResp { error: String }

#[derive(Serialize)]
struct WeatherCurrent {
    temperature: i64,
    apparent_temperature: i64,
    humidity: i64,
    wind_speed: i64,
    wind_direction: i64,
    pressure: i64,
    visibility: serde_json::Value,
    skycon: serde_json::Value,
    weather_info: serde_json::Value,
    air_quality: serde_json::Value,
}

#[derive(Serialize)]
struct WeatherData {
    current: WeatherCurrent,
    hourly: serde_json::Value,
    daily: serde_json::Value,
    forecast_keypoint: serde_json::Value,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .with_target(false)
        .compact()
        .init();

    let state = AppState {
        caiyun_token: std::env::var("CAIYUN_API_TOKEN").ok(),
        amap_key: std::env::var("AMAP_API_KEY").ok(),
    };

    let port: u16 = std::env::var("PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8000);
    // 可选从环境变量读取主机地址，默认 0.0.0.0
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    // 兼容 IPv6: 若 host 含有冒号且未被 [] 包裹，则包裹后再解析
    let host_fmt = if host.contains(':') && !host.starts_with('[') { format!("[{}]", host) } else { host };
    let addr: SocketAddr = format!("{}:{}", host_fmt, port)
        .parse()
        .unwrap_or(([0, 0, 0, 0], port).into());

    let static_service = ServeDir::new("static");

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/weather", get(api_weather))
        .route("/api/location/ip", get(api_location_ip))
        .route("/api/location/geocode", get(api_location_geocode))
        .route("/api/location/search", get(api_location_search))
        .route("/favicon.ico", get(favicon))
        .route("/", get(index))
        .route("/index.html", get(index))
        .nest_service("/static", static_service)
        .with_state(state)
        .layer(ServiceBuilder::new()
            // 先添加 Trace 和 Header，再压缩，最后加 CORS（CORS 放最后避免对 ResponseBody 的 Default 约束）
            .layer(TraceLayer::new_for_http())
            .layer(SetResponseHeaderLayer::if_not_present(
                axum::http::header::CONTENT_TYPE,
                HeaderValue::from_static("application/json; charset=utf-8"),
            ))
            .layer(CompressionLayer::new())
            .layer(cors)
        );

    info!("listening on {}", addr);
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}

async fn index() -> impl IntoResponse {
    match fs::read_to_string("static/index.html").await {
        Ok(s) => Html(s).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "index not found").into_response(),
    }
}

async fn favicon() -> impl IntoResponse {
    // simple inline SVG
    let svg = r#"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><circle cx='32' cy='32' r='28' fill='#4FC3F7'/><path d='M18 36c3-8 16-8 19 0 5 0 7 3 7 6 0 4-3 7-7 7H23c-4 0-7-3-7-7 0-3 2-6 2-6z' fill='#fff'/></svg>"#;
    (
        StatusCode::OK,
        [(axum::http::header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=86400")),
         (axum::http::header::CONTENT_TYPE, HeaderValue::from_static("image/svg+xml"))],
        svg,
    )
}

// -------- helpers --------

fn safe_round(v: &serde_json::Value, default_: i64) -> i64 {
    v.as_f64().map(|n| n.round() as i64).unwrap_or(default_)
}

fn safe_number(v: &serde_json::Value, default_: i64) -> i64 {
    v.as_f64().map(|n| n as i64).unwrap_or(default_)
}

fn safe_get<'a>(v: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut cur = v;
    for key in path.split('.') {
        cur = cur.get(key)?;
    }
    Some(cur)
}

fn skycon_info(s: &str) -> serde_json::Value {
    // 简化：仅返回 code
    let (icon, desc) = match s {
        "CLEAR_DAY" => ("☀️", "晴"),
        "CLEAR_NIGHT" => ("🌙", "晴（夜间）"),
        "PARTLY_CLOUDY_DAY" => ("⛅", "多云"),
        // 使用单一组合图标（HTML 片段），通过前端 CSS 层叠出“云遮月”。
        // 这里返回 HTML，前端将用 innerHTML 渲染（见 static/script.js）。
        "PARTLY_CLOUDY_NIGHT" => (
            "<span class=\"icon-stacked\"><span class=\"i-back\">🌙</span><span class=\"i-front\">☁️</span></span>",
            "多云（夜间）"
        ),
        "CLOUDY" => ("☁️", "阴"),
        "LIGHT_RAIN" => ("🌧️", "小雨"),
        "MODERATE_RAIN" => ("🌧️", "中雨"),
        "HEAVY_RAIN" => ("⛈️", "大雨"),
        "STORM_RAIN" => ("⛈️", "暴雨"),
        "HAIL" => ("🌨️", "冰雹"),
        "SLEET" => ("🌨️", "雨夹雪"),
        "LIGHT_SNOW" => ("🌨️", "小雪"),
        "MODERATE_SNOW" => ("🌨️", "中雪"),
        "HEAVY_SNOW" => ("❄️", "大雪"),
        "STORM_SNOW" => ("❄️", "暴雪"),
        "FOG" => ("🌫️", "雾"),
        "LIGHT_HAZE" => ("🌫️", "轻度霾"),
        "MODERATE_HAZE" => ("🌫️", "中度霾"),
        "HEAVY_HAZE" => ("🌫️", "重度霾"),
        "DUST" => ("🌪️", "浮尘"),
        "SAND" => ("🌪️", "沙尘"),
        "WIND" => ("🌬️", "大风"),
        other => ("?", other),
    };
    serde_json::json!({"icon": icon, "desc": desc})
}

fn format_weather_data(raw: &serde_json::Value, longitude: f64) -> anyhow::Result<WeatherData> {
    let result = raw
        .get("result")
        .ok_or_else(|| anyhow::anyhow!("缺少 result"))?;
    let realtime = result.get("realtime").ok_or_else(|| anyhow::anyhow!("缺少 realtime"))?;
    let hourly = result.get("hourly").unwrap_or(&serde_json::Value::Null).clone();
    let daily = result.get("daily").unwrap_or(&serde_json::Value::Null).clone();

    let skycon_code = realtime.get("skycon").and_then(|v| v.as_str()).unwrap_or("CLEAR_DAY");
    let current = WeatherCurrent {
        temperature: safe_round(realtime.get("temperature").unwrap_or(&serde_json::Value::Null), 0),
        apparent_temperature: safe_round(realtime.get("apparent_temperature").unwrap_or(&serde_json::Value::Null), 0),
        humidity: ((safe_get(realtime, "humidity").and_then(|v| v.as_f64()).unwrap_or(0.0)) * 100.0).round() as i64,
        wind_speed: ((safe_get(realtime, "wind.speed").and_then(|v| v.as_f64()).unwrap_or(0.0)) * 3.6).round() as i64,
        wind_direction: safe_number(safe_get(realtime, "wind.direction").unwrap_or(&serde_json::Value::Null), 0),
        pressure: ((safe_get(realtime, "pressure").and_then(|v| v.as_f64()).unwrap_or(101325.0)) / 100.0).round() as i64,
        visibility: realtime.get("visibility").cloned().unwrap_or(serde_json::Value::Null),
        skycon: serde_json::Value::String(skycon_code.to_string()),
        weather_info: skycon_info(skycon_code),
        air_quality: realtime.get("air_quality").cloned().unwrap_or(serde_json::Value::Null),
    };

    let forecast_keypoint = result
        .get("forecast_keypoint")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::String("天气提示".into()));

    // 映射 hourly -> 前端结构
    let hourly_arr: Vec<serde_json::Value> = hourly
        .get("temperature")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let sky_arr: Vec<serde_json::Value> = hourly
        .get("skycon")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let tz_offset_hours = (longitude / 15.0).round() as i64;
    let utc_now = chrono::Utc::now();
    let local_hour = (utc_now + chrono::TimeDelta::hours(tz_offset_hours)).hour() as i32;
    let count = hourly_arr.len().min(sky_arr.len()).min(24);
    let mut hourly_out = Vec::with_capacity(count);
    for i in 0..count {
        let temp_v = hourly_arr[i].get("value").unwrap_or(&serde_json::Value::Null);
        let sky_v = sky_arr[i].get("value").and_then(|v| v.as_str()).unwrap_or("CLEAR_DAY");
        let hour = ((local_hour + i as i32) % 24 + 24) % 24; // 0-23
        hourly_out.push(serde_json::json!({
            "time": hour,
            "temperature": safe_round(temp_v, 0),
            "skycon": sky_v,
            "weather_info": skycon_info(sky_v),
        }));
    }

    // 映射 daily -> 前端结构（取前 3 天）
    let daily_temp: Vec<serde_json::Value> = daily
        .get("temperature")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let daily_sky: Vec<serde_json::Value> = daily
        .get("skycon")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let life_index = daily.get("life_index").cloned().unwrap_or(serde_json::Value::Null);
    let today = Local::now().date_naive();
    let mut daily_out = Vec::new();
    let dcount = daily_temp.len().min(3);
    for i in 0..dcount {
        let date = today.checked_add_days(Days::new(i as u64)).unwrap_or(today);
        let relative = match i { 0 => "今天", 1 => "明天", 2 => "后天", _ => "" };
        let weekday = match date.weekday() {
            Weekday::Mon => "周一",
            Weekday::Tue => "周二",
            Weekday::Wed => "周三",
            Weekday::Thu => "周四",
            Weekday::Fri => "周五",
            Weekday::Sat => "周六",
            Weekday::Sun => "周日",
        };
        let temp_obj = &daily_temp[i];
        let sky = daily_sky.get(i).and_then(|v| v.get("value")).and_then(|v| v.as_str()).unwrap_or("CLEAR_DAY");

        // 生活指数提取助手
        let li = |key: &str| -> serde_json::Value {
            life_index.get(key)
                .and_then(|arr| arr.as_array())
                .and_then(|arr| arr.get(i))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({"index":"","desc":""}))
        };

        daily_out.push(serde_json::json!({
            "date": format!("{:02}-{:02}", date.month(), date.day()),
            "weekday": weekday,
            "relativeDay": relative,
            "max_temp": safe_round(temp_obj.get("max").unwrap_or(&serde_json::Value::Null), 0),
            "min_temp": safe_round(temp_obj.get("min").unwrap_or(&serde_json::Value::Null), 0),
            "skycon": sky,
            "weather_info": skycon_info(sky),
            "life_index": {
                "ultraviolet": li("ultraviolet"),
                "carWashing": li("carWashing"),
                "dressing": li("dressing"),
                "comfort": li("comfort"),
                "coldRisk": li("coldRisk"),
            }
        }));
    }

    Ok(WeatherData {
        current,
        hourly: serde_json::Value::Array(hourly_out),
        daily: serde_json::Value::Array(daily_out),
        forecast_keypoint,
    })
}

// -------- handlers --------

async fn api_weather(State(state): State<AppState>, Query(q): Query<WeatherQuery>) -> impl IntoResponse {
    if state.caiyun_token.is_none() {
        // 返回模拟数据，字段结构一致（简化版）
        let data = WeatherData {
            current: WeatherCurrent {
                temperature: 26,
                apparent_temperature: 30,
                humidity: 87,
                wind_speed: 28,
                wind_direction: 0,
                pressure: 1007,
                visibility: serde_json::json!(5.26),
                skycon: serde_json::json!("MODERATE_RAIN"),
                weather_info: serde_json::json!({"icon":"?","desc":"中雨"}),
                air_quality: serde_json::json!({"aqi":{"chn":14},"description":{"chn":"优"},"pm25":9,"pm10":14,"o3":19}),
            },
            hourly: serde_json::json!(
                (0..24).map(|i| {
                    serde_json::json!({
                        "time": i,
                        "temperature": 26,
                        "skycon": "MODERATE_RAIN",
                        "weather_info": {"icon":"?","desc":"中雨"}
                    })
                }).collect::<Vec<_>>()
            ),
            daily: serde_json::json!([
                {"date":"今日","weekday":"周几","relativeDay":"今天","max_temp":29,"min_temp":24,"skycon":"MODERATE_RAIN","weather_info":{"icon":"?","desc":"中雨"},"life_index":{"ultraviolet":{"index":"中","desc":"注意防晒"}}}
            ]),
            forecast_keypoint: serde_json::json!("注意携带雨具"),
        };
        return (StatusCode::OK, Json(data)).into_response();
    }

    let url = format!(
        "https://api.caiyunapp.com/v2.6/{}/{},{}{}",
        state.caiyun_token.as_deref().unwrap(),
        q.lng,
        q.lat,
        "/weather?alert=true&dailysteps=3&hourlysteps=24&lang=zh_CN"
    );

    match CLIENT.get(&url).send().await {
        Ok(resp) => match resp.error_for_status() {
            Ok(r) => match r.json::<serde_json::Value>().await {
                Ok(json) => {
                    // 校验 ok/status
                    if json.get("status").and_then(|v| v.as_str()) == Some("ok") || json.get("result").is_some() {
                        match format_weather_data(&json, q.lng) {
                            Ok(data) => (StatusCode::OK, Json(data)).into_response(),
                            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResp{ error: format!("数据格式化失败: {}", e)})).into_response(),
                        }
                    } else {
                        (StatusCode::BAD_GATEWAY, Json(ErrorResp{ error: "上游返回异常".into()})).into_response()
                    }
                }
                Err(e) => (StatusCode::BAD_GATEWAY, Json(ErrorResp{ error: format!("解析上游失败: {}", e)})).into_response(),
            },
            Err(e) => (StatusCode::BAD_GATEWAY, Json(ErrorResp{ error: format!("上游错误: {}", e)})).into_response(),
        },
        Err(e) => (StatusCode::BAD_GATEWAY, Json(ErrorResp{ error: format!("请求失败: {}", e)})).into_response(),
    }
}

#[derive(Deserialize)]
struct GeocodeQuery { lat: f64, lng: f64 }

async fn api_location_geocode(Query(q): Query<GeocodeQuery>, State(state): State<AppState>) -> impl IntoResponse {
    // 先用美团官方 latlng 接口
    let mt_url = format!(
        "https://apimobile.meituan.com/group/v1/city/latlng/{},{}?tag=0",
        q.lat, q.lng
    );
    let mt_req = CLIENT
        .get(mt_url)
        .header("User-Agent", "Mozilla/5.0 (compatible; caiyun-rust/0.1)")
        .header("Accept", "application/json")
        .header("Referer", "https://i.meituan.com/");
    if let Ok(Ok(resp)) = tokio::time::timeout(Duration::from_secs(3), mt_req.send()).await {
        if let Ok(v) = resp.json::<serde_json::Value>().await {
            if let Some(data) = v.get("data") {
                let address = data.get("detail").and_then(|x| x.as_str())
                    .or_else(|| data.get("openCityName").and_then(|x| x.as_str()))
                    .or_else(|| data.get("city").and_then(|x| x.as_str()))
                    .unwrap_or("未知位置");
                return (StatusCode::OK, Json(serde_json::json!({"address": address}))).into_response();
            }
        }
    }

    // 失败再尝试高德逆地理（可选）
    if let Some(key) = &state.amap_key {
        let url = format!(
            "https://restapi.amap.com/v3/geocode/regeo?key={}&location={},{}&radius=1000&extensions=base",
            key, q.lng, q.lat
        );
        if let Ok(Ok(resp)) = tokio::time::timeout(Duration::from_secs(3), CLIENT.get(url).send()).await {
            if let Ok(v) = resp.json::<serde_json::Value>().await {
                if v.get("status").and_then(|s| s.as_str()) == Some("1") {
                    if let Some(addr) = v.get("regeocode").and_then(|r| r.get("formatted_address")).and_then(|s| s.as_str()) {
                        return (StatusCode::OK, Json(serde_json::json!({"address": addr}))).into_response();
                    }
                }
            }
        }
    }

    (StatusCode::OK, Json(serde_json::json!({"address": "未知位置"}))).into_response()
}

#[derive(Deserialize)]
struct SearchQuery { q: String }

async fn api_location_search(Query(qs): Query<SearchQuery>, State(state): State<AppState>) -> impl IntoResponse {
    let q = qs.q.trim();
    if q.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(ErrorResp{ error: "缺少 q".into()})).into_response();
    }

    // 高德 3s，失败返回空
    if let Some(key) = &state.amap_key {
        let url = format!(
            "https://restapi.amap.com/v3/place/text?key={}&keywords={}&offset=5&page=1&extensions=base",
            key,
            urlencoding::encode(q)
        );
        if let Ok(rsp) = tokio::time::timeout(Duration::from_secs(3), CLIENT.get(url).send()).await {
            if let Ok(resp) = rsp { if let Ok(v) = resp.json::<serde_json::Value>().await {
                if v.get("pois").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false) {
                    let results: Vec<serde_json::Value> = v["pois"].as_array().unwrap_or(&vec![]).iter().take(5).filter_map(|poi| {
                        let name = poi.get("name")?.as_str()?.to_string();
                        let addr = poi.get("address").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let loc = poi.get("location")?.as_str()?; // "lng,lat"
                        let mut it = loc.split(',');
                        let lng = it.next()?.parse::<f64>().ok()?;
                        let lat = it.next()?.parse::<f64>().ok()?;
                        Some(serde_json::json!({"lat":lat,"lng":lng,"name":name,"address":addr}))
                    }).collect();
                    return (StatusCode::OK, Json(serde_json::json!({"results": results}))).into_response();
                }
            }}
        }
    }

    // 仅使用高德；失败则返回空列表
    (StatusCode::OK, Json(serde_json::json!({"results": []}))).into_response()
}

async fn api_location_ip(State(_state): State<AppState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    // 尽力从常见代理头中取真实 IP（支持 IPv4/IPv6，去端口/方括号）
    let raw = headers
        .get("cf-connecting-ip").and_then(|v| v.to_str().ok())
        .or_else(|| headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|s| s.split(',').next()))
        .or_else(|| headers.get("x-real-ip").and_then(|v| v.to_str().ok()))
        .unwrap_or("")
        .trim()
        .to_string();

    fn clean_ip(s: &str) -> Option<String> {
        let s = s.trim();
        if s.is_empty() { return None; }
        // [IPv6]:port 形式
        if let Some(end) = (s.starts_with('[')).then(|| s.find(']')).flatten() {
            return Some(s[1..end].to_string());
        }
        // IPv4:port 形式
        if s.contains('.') && s.contains(':') {
            if let Some(idx) = s.rfind(':') { return Some(s[..idx].to_string()); }
        }
        Some(s.to_string())
    }

    let ip = clean_ip(&raw).unwrap_or_default();

    // 简化：无法定位时返回北京默认坐标
    let fallback = serde_json::json!({"lat": 39.9042, "lng": 116.4074, "address": "北京市"});

    if ip.is_empty() {
        return (StatusCode::OK, Json(fallback)).into_response();
    }

    // 使用美团官方 IP 定位
    let url = format!(
        "https://apimobile.meituan.com/locate/v2/ip/loc?rgeo=true&ip={}",
        urlencoding::encode(&ip)
    );
    let req = CLIENT
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (compatible; caiyun-rust/0.1)")
        .header("Accept", "application/json")
        .header("Referer", "https://i.meituan.com/");
    if let Ok(Ok(resp)) = tokio::time::timeout(Duration::from_secs(3), req.send()).await {
        if let Ok(v) = resp.json::<serde_json::Value>().await {
            let data = v.get("data").cloned().unwrap_or(serde_json::Value::Null);
            let lat = data.get("lat").and_then(|x| x.as_f64());
            let lng = data.get("lng").and_then(|x| x.as_f64());
            let rgeo = data.get("rgeo").cloned().unwrap_or(serde_json::Value::Null);
            let address = rgeo.get("city").and_then(|x| x.as_str())
                .or_else(|| rgeo.get("district").and_then(|x| x.as_str()))
                .or_else(|| rgeo.get("province").and_then(|x| x.as_str()))
                .unwrap_or("北京市");
            if let (Some(lat), Some(lng)) = (lat, lng) {
                return (StatusCode::OK, Json(serde_json::json!({"lat": lat, "lng": lng, "address": address}))).into_response();
            }
        }
    }

    // 失败返回默认坐标
    (StatusCode::OK, Json(fallback)).into_response()
}
