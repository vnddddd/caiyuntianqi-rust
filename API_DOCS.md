# 彩云天气 API 文档

## API 接口格式

### 综合天气预报接口

```
综合（通用接口）: https://api.caiyunapp.com/v2.6/{TOKEN}/{经度},{纬度}/weather?dailysteps=3&hourlysteps=48
综合（通用接口）-定制返回值: https://api.caiyunapp.com/v2.6/{TOKEN}/{经度},{纬度}/weather.jsonp?callback=MYCALLBACK
实况数据: https://api.caiyunapp.com/v2.6/{TOKEN}/{经度},{纬度}/realtime
未来2天逐小时预报: https://api.caiyunapp.com/v2.6/{TOKEN}/{经度},{纬度}/hourly?hourlysteps=48
未来3天逐天预报: https://api.caiyunapp.com/v2.6/{TOKEN}/{经度},{纬度}/daily?dailysteps=3
历史24小时天气：https://api.caiyunapp.com/v2.6/{TOKEN}/{经度},{纬度}/hourly?hourlysteps=48&begin=时间戳
4项生活指数: https://api.caiyunapp.com/v2.6/{TOKEN}/{经度},{纬度}/daily?dailysteps=3
```

**注意：** `{TOKEN}` 需要替换为你的实际 API Token

## 详细文档

完整的 API 文档请参考：https://docs.caiyunapp.com/weather-api/v2/v2.6/index.html

## 获取 API Token

1. 访问 [彩云天气开发者平台](https://dashboard.caiyunapp.com/)
2. 注册账号并登录
3. 创建应用获取 API Token
4. 将 Token 设置为环境变量，不要硬编码在代码中
