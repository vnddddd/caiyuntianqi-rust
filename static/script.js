/**
 * 彩云天气网站 - 前端交互脚本
 * 处理位置获取、天气数据展示、用户界面更新
 */

// Service Worker 注册
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/static/sw.js');
      console.log('Service Worker 注册成功:', registration.scope);
      
      // 监听更新
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                console.log('Service Worker 已更新，等待激活');
                showUpdateAvailable();
              } else {
                console.log('Service Worker 已安装并准备好缓存');
              }
            }
          });
        }
      });
    } catch (error) {
      console.error('Service Worker 注册失败:', error);
    }
  });
}

// 显示更新可用提示
function showUpdateAvailable() {
  const notification = document.createElement('div');
  notification.className = 'update-notification';
  notification.innerHTML = `
    <div class="update-content">
      <span>应用已更新</span>
      <button onclick="refreshPage()">刷新</button>
      <button onclick="dismissUpdate(this)">稍后</button>
    </div>
  `;
  document.body.appendChild(notification);
}

// 刷新页面应用更新
function refreshPage() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  }
}

// 关闭更新提示
function dismissUpdate(button) {
  const notification = button.closest('.update-notification');
  if (notification) {
    notification.remove();
  }
}

// 防抖函数
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 节流函数
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// 请求管理器 - 实现缓存和去重
class RequestManager {
  constructor() {
    this.pending = new Map();
    this.cache = new Map();
    this.cacheTime = 5 * 60 * 1000; // 5分钟缓存
  }

  async fetch(url, options = {}) {
    const key = `${url}:${JSON.stringify(options)}`;
    
    // 检查是否有相同请求正在进行
    if (this.pending.has(key)) {
      console.log('请求去重，等待已有请求:', url);
      return this.pending.get(key);
    }
    
    // 检查缓存
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (Date.now() - cached.time < this.cacheTime) {
        console.log('使用缓存数据:', url);
        return Promise.resolve(cached.data);
      } else {
        this.cache.delete(key);
      }
    }
    
    // 发起新请求
    const promise = fetch(url, options)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        // 缓存成功的结果
        this.cache.set(key, { data, time: Date.now() });
        this.pending.delete(key);
        return data;
      })
      .catch(error => {
        this.pending.delete(key);
        throw error;
      });
    
    this.pending.set(key, promise);
    return promise;
  }

  clearCache() {
    this.cache.clear();
  }
}

// 全局请求管理器实例
const requestManager = new RequestManager();

class WeatherApp {
  constructor() {
    this.currentLocation = null;
    this.weatherData = null;
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5分钟缓存
    this.maxCacheSize = 50; // 限制缓存大小
    this.isLoading = false;
    this.favoriteLocations = this.loadFavoriteLocations();
    this.defaultLocation = this.loadDefaultLocation();

    // 跟踪事件监听器以便清理
    this.eventListeners = [];

    // 缓存DOM元素引用
    this.domElements = {};
    
    // 创建防抖的搜索函数
    this.searchLocationDebounced = debounce(this.searchLocation.bind(this), 300);

    this.init();
  }

  // 初始化应用
  init() {
    console.log('[WeatherApp] 开始初始化...');
    this.cacheDOMElements();
    console.log('[WeatherApp] DOM元素缓存完成');
    this.bindEvents();
    console.log('[WeatherApp] 事件绑定完成');
    // 立即设置基于时间的背景
    this.updateTimeBasedBackground();
    console.log('[WeatherApp] 背景更新完成');
    this.checkLocationPermission();
    console.log('[WeatherApp] 开始检查位置权限...');
  }

  // 缓存DOM元素引用
  cacheDOMElements() {
    const elements = [
      'currentTemp', 'weatherIcon', 'weatherDesc', 'feelsLike',
      'humidity', 'windSpeed', 'visibility', 'pressure',
      'currentLocationBtn', 'retryBtn', 'closeModalBtn', 'searchBtn',
      'locationSearch', 'modalFavoriteBtn', 'modalSetDefaultBtn',
      'locationModal', 'hourlyForecast', 'dailyForecast',
      'aqiValue', 'aqiDesc', 'aqiValueLarge', 'aqiDescLarge',
      'pm25', 'pm10', 'o3', 'weatherTips', 'weatherTipsCard',
      'currentLocation', 'updateTime', 'loadingState', 'errorState',
      'weatherContent', 'errorMessage', 'currentLocationActions',
      'modalCurrentLocation', 'favoriteLocations', 'favoriteList'
    ];

    elements.forEach(id => {
      this.domElements[id] = document.getElementById(id);
    });
  }

  // 安全的事件监听器绑定
  addEventListenerSafe(element, event, handler, options = {}) {
    if (element) {
      element.addEventListener(event, handler, options);
      this.eventListeners.push({ element, event, handler });
    }
  }

  // 清理资源 - 增强内存管理
  cleanup() {
    // 清理事件监听器
    this.eventListeners.forEach(({ element, event, handler }) => {
      if (element && typeof element.removeEventListener === 'function') {
        element.removeEventListener(event, handler);
      }
    });
    this.eventListeners = [];

    // 清理缓存
    this.cache.clear();
    
    // 清理请求管理器缓存
    if (window.requestManager) {
      requestManager.clearCache();
    }
    
    // 清理DOM元素引用
    this.domElements = {};
    
    // 取消所有定时器
    if (this.timeoutIds) {
      this.timeoutIds.forEach(id => clearTimeout(id));
      this.timeoutIds = [];
    }
  }

  // 绑定事件监听器
  bindEvents() {
    // 使用安全的事件监听器绑定
    this.addEventListenerSafe(this.domElements.currentLocationBtn, 'click', () => this.showLocationModal());
    this.addEventListenerSafe(this.domElements.retryBtn, 'click', () => this.getCurrentLocation());
    this.addEventListenerSafe(this.domElements.closeModalBtn, 'click', () => this.hideLocationModal());
    this.addEventListenerSafe(this.domElements.searchBtn, 'click', () => this.searchLocation());

    // 模态框中的按钮事件
    this.addEventListenerSafe(this.domElements.modalFavoriteBtn, 'click', () => this.toggleFavorite());
    this.addEventListenerSafe(this.domElements.modalSetDefaultBtn, 'click', () => this.setAsDefault());

    // 输入时自动搜索（带防抖）
    this.addEventListenerSafe(this.domElements.locationSearch, 'input', () => {
      this.searchLocationDebounced();
    });
    
    // 回车键立即搜索
    this.addEventListenerSafe(this.domElements.locationSearch, 'keypress', (e) => {
      if (e.key === 'Enter') {
        this.searchLocationDebounced.cancel && this.searchLocationDebounced.cancel();
        this.searchLocation();
      }
    });

    // 热门城市按钮
    document.querySelectorAll('.city-btn').forEach(btn => {
      const handler = (e) => {
        const target = e.target;
        const city = target.dataset.city;
        const lng = this.validateNumber(target.dataset.lng, 0);
        const lat = this.validateNumber(target.dataset.lat, 0);
        this.selectLocation(lng, lat, city || '');
      };
      this.addEventListenerSafe(btn, 'click', handler);
    });

    // 点击模态框外部关闭
    this.addEventListenerSafe(this.domElements.locationModal, 'click', (e) => {
      if (e.target === e.currentTarget) {
        this.hideLocationModal();
      }
    });
  }



  // 检查位置权限并自动获取位置
  async checkLocationPermission() {
    console.log('[初始化] 开始checkLocationPermission');
    
    // 优先检查是否有默认位置
    if (this.defaultLocation) {
      console.log('加载默认位置:', this.defaultLocation);
      this.currentLocation = { lat: this.defaultLocation.lat, lng: this.defaultLocation.lng };
      // 获取天气数据
      await this.fetchWeatherData(this.defaultLocation.lng, this.defaultLocation.lat, this.defaultLocation.name);
      return;
    }

    // 直接使用IP定位，避免GPS定位可能的阻塞问题
    console.log('[初始化] 直接使用IP定位...');
    try {
      await this.getLocationByIP();
      console.log('[初始化] IP定位成功');
      return;
    } catch (ipError) {
      console.error('[初始化] IP定位失败:', ipError);
      this.handleError(ipError, 'IP定位');
      // 直接加载默认位置（北京）
      await this.loadBeijingWeather();
    }
    
    // 异步尝试GPS定位，不阻塞页面
    setTimeout(() => {
      if ('geolocation' in navigator && 'permissions' in navigator) {
        navigator.permissions.query({ name: 'geolocation' }).then(permission => {
          if (permission.state === 'granted') {
            console.log('[后台] GPS权限已授予，尝试更新到更精确的位置');
            // 这里可以选择性更新到GPS位置
          }
        }).catch(e => {
          console.log('[后台] 无法查询GPS权限:', e);
        });
      }
    }, 1000);
  }

  // 显示位置获取提示
  showLocationPrompt() {
    this.hideLoading();
    // 不自动显示模态框，让用户手动点击位置名称来选择
  }

  // 获取当前位置
  getCurrentLocation() {
    this.showLoading('正在获取位置信息...');
    
    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000 // 5分钟缓存
    };

    navigator.geolocation.getCurrentPosition(
      (position) => this.onLocationSuccess(position),
      (error) => this.onLocationError(error),
      options
    );
  }

  // 位置获取成功
  async onLocationSuccess(position) {
    const { latitude, longitude } = position.coords;
    this.currentLocation = { lat: latitude, lng: longitude };

    console.log('位置获取成功:', this.currentLocation);

    // 获取详细地址并获取天气数据
    this.showLoading('正在获取位置信息...');
    const detailedAddress = await this.getDetailedAddress(longitude, latitude);
    await this.fetchWeatherData(longitude, latitude, detailedAddress);
  }

  // 位置获取失败
  async onLocationError(error) {
    console.error('GPS定位失败:', error);

    let errorMessage = 'GPS定位失败';
    switch (error.code) {
      case error.PERMISSION_DENIED:
        errorMessage = 'GPS位置访问被拒绝，尝试使用 IP 定位...';
        break;
      case error.POSITION_UNAVAILABLE:
        errorMessage = 'GPS位置信息不可用，尝试使用 IP 定位...';
        break;
      case error.TIMEOUT:
        errorMessage = 'GPS定位超时，尝试使用 IP 定位...';
        break;
    }

    this.showLoading(errorMessage);

    // 尝试 IP 定位作为备用方案
    try {
      await this.getLocationByIP();
    } catch (ipError) {
      console.error('IP 定位也失败:', ipError);
      // 显示更友好的错误信息和建议
      this.showError(`
        <div style="text-align: center;">
          <h3>🌍 无法自动获取位置</h3>
          <p>可能的原因：</p>
          <ul style="text-align: left; display: inline-block;">
            <li>GPS权限被拒绝</li>
            <li>网络连接问题</li>
            <li>位置服务被禁用</li>
            <li>防火墙或网络限制</li>
          </ul>
          <p><strong>正在为您显示北京天气，您也可以手动选择位置</strong></p>
        </div>
      `);

      // 直接加载默认位置（北京）
      await this.loadBeijingWeather();
    }
  }

  // 通过 IP 获取位置
  async getLocationByIP() {
    console.log('[IP定位] 开始获取IP位置...');
    try {
      const response = await fetch('api/location/ip');
      console.log('[IP定位] API响应状态:', response.status);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[IP定位] 收到数据:', data);

      if (data.error) {
        throw new Error(data.error);
      }

      this.currentLocation = { lat: data.lat, lng: data.lng };

      console.log('IP 定位成功:', this.currentLocation, '地址:', data.address);

      // 获取天气数据
      await this.fetchWeatherData(this.currentLocation.lng, this.currentLocation.lat, data.address);

    } catch (error) {
      console.error('IP 定位失败:', error);
      throw error;
    }
  }

  // 加载默认位置（北京）
  async loadBeijingWeather() {
    try {
      console.log('加载默认位置：北京');
      this.currentLocation = { lat: 39.9042, lng: 116.4074 };

      // 获取天气数据
      await this.fetchWeatherData(116.4074, 39.9042, '北京市');

    } catch (error) {
      this.handleError(error, '加载默认位置');
      // 如果连默认位置都失败了，显示最终错误
      this.showError('网络连接异常，请检查网络后重试');
    }
  }

  // 生成缓存键
  getCacheKey(lng, lat) {
    return `weather_${lng.toFixed(4)}_${lat.toFixed(4)}`;
  }

  // 检查缓存
  getCachedData(lng, lat) {
    const key = this.getCacheKey(lng, lat);
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    return null;
  }

  // 设置缓存（带大小限制）
  setCachedData(lng, lat, data) {
    const key = this.getCacheKey(lng, lat);

    // 如果缓存超过最大大小，删除最旧的条目
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  // 数值验证函数
  validateNumber(value, defaultValue = 0, min = -Infinity, max = Infinity) {
    const num = parseFloat(value);
    if (isNaN(num) || num < min || num > max) {
      return defaultValue;
    }
    return num;
  }

  // 统一错误处理
  handleError(error, context) {
    console.error(`${context}失败:`, error);

    let userMessage = '网络连接异常，请检查网络后重试';

    if (error.message.includes('timeout')) {
      userMessage = '请求超时，请重试';
    } else if (error.message.includes('404')) {
      userMessage = '服务暂时不可用，请稍后重试';
    } else if (error.message.includes('permission')) {
      userMessage = '权限被拒绝，请检查设置';
    }

    this.showError(userMessage);
  }

  // 获取天气数据 - 使用请求管理器优化
  async fetchWeatherData(lng, lat, locationName = null) {
    console.log(`开始获取天气数据: lng=${lng}, lat=${lat}, locationName=${locationName}`);

    this.showLoading('正在获取天气信息...');

    try {
      const url = `api/weather?lng=${lng}&lat=${lat}`;
      console.log('发送请求到:', url);
      
      // 使用请求管理器，自动处理缓存和去重
      const data = await requestManager.fetch(url);
      console.log('获取到数据:', data);

      if (data.error) {
        throw new Error(data.error);
      }

      this.weatherData = data;
      console.log('开始显示天气数据...');
      this.displayWeatherData(locationName);
      console.log('天气数据显示完成');

    } catch (error) {
      this.handleError(error, '获取天气数据');
    }
  }

  // 获取详细地址
  async getDetailedAddress(lng, lat) {
    try {
      const response = await fetch(`api/location/geocode?lng=${lng}&lat=${lat}`);

      if (!response.ok) {
        return '未知位置';
      }

      const data = await response.json();
      return data.address || '未知位置';
    } catch (error) {
      this.handleError(error, '获取地址');
      return '未知位置';
    }
  }

  // 显示位置选择模态框
  showLocationModal() {
    const modal = document.getElementById('locationModal');
    if (modal) {
      modal.style.display = 'flex';

      // 显示当前位置操作区域
      this.updateCurrentLocationActions();

      // 清空搜索框
      const searchInput = document.getElementById('locationSearch');
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      // 清空搜索结果
      const searchResults = document.getElementById('searchResults');
      if (searchResults) {
        searchResults.innerHTML = '';
      }
      // 更新收藏列表
      this.updateFavoriteList();
    }
  }

  // 隐藏位置选择模态框
  hideLocationModal() {
    const modal = document.getElementById('locationModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  // 搜索位置 - 添加防抖优化
  async searchLocation() {
    const searchInput = document.getElementById('locationSearch');
    const searchResults = document.getElementById('searchResults');

    if (!searchInput || !searchResults) return;

    const query = searchInput.value.trim();
    if (!query) return;

    searchResults.innerHTML = '<div style="text-align: center; padding: 1rem; color: #666;">搜索中...</div>';

    try {
      // 使用请求管理器
      const url = `api/location/search?q=${encodeURIComponent(query)}`;
      const data = await requestManager.fetch(url);

      if (data.results && data.results.length > 0) {
        const results = data.results.slice(0, 5); // 最多显示5个结果

        // 使用DocumentFragment批量更新
        const fragment = document.createDocumentFragment();
        
        results.forEach(result => {
          const div = document.createElement('div');
          div.className = 'search-result-item';
          div.setAttribute('data-lng', result.lng);
          div.setAttribute('data-lat', result.lat);
          div.setAttribute('data-name', result.name);
          div.innerHTML = `
            <div style="font-weight: 500;">${result.name}</div>
            <div style="font-size: 0.875rem; color: #666; margin-top: 0.25rem;">
              ${result.address || ''}
            </div>
          `;
          fragment.appendChild(div);
        });
        
        searchResults.innerHTML = '';
        searchResults.appendChild(fragment);

        // 使用事件委托
        if (!searchResults.hasAttribute('data-listener-attached')) {
          searchResults.setAttribute('data-listener-attached', 'true');
          
          searchResults.addEventListener('click', (e) => {
            const item = e.target.closest('.search-result-item');
            if (item) {
              const lng = this.validateNumber(item.dataset.lng, 0);
              const lat = this.validateNumber(item.dataset.lat, 0);
              const name = item.dataset.name || '';
              this.selectLocation(lng, lat, name);
            }
          });
        }
      } else {
        searchResults.innerHTML = '<div style="text-align: center; padding: 1rem; color: #666;">未找到相关位置</div>';
      }
    } catch (error) {
      this.handleError(error, '搜索位置');
      searchResults.innerHTML = '<div style="text-align: center; padding: 1rem; color: #f56565;">搜索失败，请重试</div>';
    }
  }

  // 选择位置
  async selectLocation(lng, lat, locationName) {
    this.hideLocationModal();
    this.currentLocation = { lat, lng };

    // 获取天气数据
    await this.fetchWeatherData(lng, lat, locationName);
  }

  // 显示天气数据
  displayWeatherData(locationName = null) {
    if (!this.weatherData) return;

    const { current, hourly, daily, forecast_keypoint } = this.weatherData;

    // 更新当前天气
    this.updateCurrentWeather(current);

    // 更新空气质量
    this.updateAirQuality(current.air_quality);

    // 更新24小时预报
    this.updateHourlyForecast(hourly);

    // 更新3天预报
    this.updateDailyForecast(daily);

    // 更新生活指数提醒
    this.updateWeatherTips(daily);

    // 更新位置和时间信息
    this.updateLocationInfo(forecast_keypoint, locationName);

    // 显示天气内容
    this.showWeatherContent();
  }

  // 更新当前天气信息（优化DOM操作，添加数据验证）
  updateCurrentWeather(current) {
    if (!current || !current.weather_info) {
      console.error('天气数据无效:', current);
      return;
    }

    // 数据验证和安全获取
    const temperature = this.validateNumber(current.temperature, '--');
    const apparentTemp = this.validateNumber(current.apparent_temperature, '--');
    const humidity = this.validateNumber(current.humidity, '--', 0, 100);
    const windSpeed = this.validateNumber(current.wind_speed, '--', 0);
    const visibility = this.validateNumber(current.visibility, '--', 0);
    const pressure = this.validateNumber(current.pressure, '--', 0);

    // 批量更新DOM以减少重排
    const updates = [
      { element: this.domElements.currentTemp, content: temperature },
      { element: this.domElements.weatherIcon, content: current.weather_info.icon || '❓' },
      { element: this.domElements.weatherDesc, content: current.weather_info.desc || '未知' },
      { element: this.domElements.feelsLike, content: `体感温度 ${apparentTemp}°C` },
      { element: this.domElements.humidity, content: `${humidity}%` },
      { element: this.domElements.windSpeed, content: `${windSpeed} km/h` },
      { element: this.domElements.visibility, content: `${visibility} km` },
      { element: this.domElements.pressure, content: `${pressure} hPa` }
    ];

    // 使用requestAnimationFrame批量更新，减少DOM操作
    requestAnimationFrame(() => {
      updates.forEach(({ element, content }) => {
        if (element) element.textContent = content;
      });

      // 更新基于时间的背景
      this.updateTimeBasedBackground();
    });
  }

  // 根据当前时间更新背景（白天/夜晚）
  updateTimeBasedBackground() {
    const body = document.body;
    const now = new Date();
    const hour = now.getHours();

    // 移除之前的时间背景类
    body.classList.remove('time-day', 'time-night');

    // 判断是白天还是夜晚
    // 白天：6:00-19:00 (6点到19点)
    // 夜晚：19:00-6:00 (19点到次日6点)
    if (hour >= 6 && hour < 19) {
      // 白天背景
      body.classList.add('time-day');
      console.log('应用白天背景，当前时间:', hour + ':00');
    } else {
      // 夜晚背景
      body.classList.add('time-night');
      console.log('应用夜晚背景，当前时间:', hour + ':00');
    }
  }

  // 更新空气质量信息
  updateAirQuality(airQuality) {
    if (!airQuality) return;

    const aqiValue = airQuality.aqi?.chn || '--';
    const aqiDesc = airQuality.description?.chn || '--';

    // 更新右上角的空气质量显示（如果存在）
    const aqiValueEl = document.getElementById('aqiValue');
    const aqiDescEl = document.getElementById('aqiDesc');
    if (aqiValueEl) aqiValueEl.textContent = aqiValue;
    if (aqiDescEl) aqiDescEl.textContent = aqiDesc;

    // 更新右侧主要显示区域
    const aqiValueLargeEl = document.getElementById('aqiValueLarge');
    const aqiDescLargeEl = document.getElementById('aqiDescLarge');
    if (aqiValueLargeEl) aqiValueLargeEl.textContent = aqiValue;
    if (aqiDescLargeEl) aqiDescLargeEl.textContent = aqiDesc;

    // 更新详细数据
    const pm25El = document.getElementById('pm25');
    const pm10El = document.getElementById('pm10');
    const o3El = document.getElementById('o3');
    if (pm25El) pm25El.textContent = `${airQuality.pm25 || '--'} μg/m³`;
    if (pm10El) pm10El.textContent = `${airQuality.pm10 || '--'} μg/m³`;
    if (o3El) o3El.textContent = `${airQuality.o3 || '--'} μg/m³`;
  }

  // 更新24小时预报 - 优化DOM操作，使用DocumentFragment
  updateHourlyForecast(hourly) {
    const container = this.domElements.hourlyForecast;
    if (!container || !hourly) return;

    // 使用DocumentFragment批量更新DOM
    const fragment = document.createDocumentFragment();
    
    hourly.forEach(item => {
      const div = document.createElement('div');
      div.className = 'hourly-item';
      div.innerHTML = `
        <div class="hourly-time">${item.time}:00</div>
        <div class="hourly-icon">${item.weather_info.icon}</div>
        <div class="hourly-temp">${item.temperature}°</div>
      `;
      fragment.appendChild(div);
    });
    
    // 一次性更新DOM
    container.innerHTML = '';
    container.appendChild(fragment);
  }

  // 更新3天预报 - 优化DOM操作，使用DocumentFragment
  updateDailyForecast(daily) {
    const container = this.domElements.dailyForecast;
    if (!container || !daily) return;

    // 使用DocumentFragment批量更新DOM
    const fragment = document.createDocumentFragment();
    
    daily.forEach(item => {
      const div = document.createElement('div');
      div.className = 'daily-item';
      div.setAttribute('data-weekday', item.weekday);
      div.innerHTML = `
        <div class="daily-left">
          <div class="daily-relative-day">${item.relativeDay || item.weekday}</div>
          <div class="daily-weekday">${item.weekday}</div>
        </div>
        <div class="daily-right">
          <div class="daily-weather">
            <div class="daily-icon">${item.weather_info.icon}</div>
            <div class="daily-desc">${item.weather_info.desc}</div>
          </div>
          <div class="daily-temp-range">${item.min_temp}° / ${item.max_temp}°</div>
        </div>
      `;
      fragment.appendChild(div);
    });
    
    // 一次性更新DOM
    container.innerHTML = '';
    container.appendChild(fragment);
  }

  // 更新生活指数提醒
  updateWeatherTips(daily) {
    if (!daily || !daily[0] || !daily[0].life_index) {
      return;
    }

    const todayLifeIndex = daily[0].life_index;
    const tips = [];

    // 生活指数图标映射
    const indexIcons = {
      ultraviolet: '☀️',
      carWashing: '🚗',
      dressing: '👕',
      comfort: '😊',
      coldRisk: '🤧'
    };

    // 生活指数名称映射
    const indexNames = {
      ultraviolet: '紫外线',
      carWashing: '洗车',
      dressing: '穿衣',
      comfort: '舒适度',
      coldRisk: '感冒'
    };

    // 生成提醒信息
    Object.keys(indexIcons).forEach(key => {
      const indexData = todayLifeIndex[key];
      if (indexData && indexData.desc && indexData.desc !== '暂无数据') {
        tips.push(`${indexIcons[key]} ${indexNames[key]}: ${indexData.desc}`);
      }
    });

    // 显示生活指数提醒
    if (tips.length > 0) {
      const tipsContainer = document.getElementById('weatherTips');
      const tipsCard = document.getElementById('weatherTipsCard');

      if (tipsContainer && tipsCard) {
        tipsContainer.innerHTML = tips.map(tip =>
          `<div class="weather-tip-item">${tip}</div>`
        ).join('');
        tipsCard.style.display = 'block';
      }
    }
  }

  // 更新位置和时间信息
  updateLocationInfo(forecastKeypoint, locationName = null) {
    const now = new Date();
    const timeString = now.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // 使用提供的位置名称，如果没有则使用默认值
    const displayLocation = locationName || '当前位置';

    document.getElementById('currentLocation').textContent = displayLocation;
    document.getElementById('updateTime').textContent = `更新时间: ${timeString}`;

    // 如果有预报要点，可以在某处显示
    if (forecastKeypoint) {
      console.log('预报要点:', forecastKeypoint);
    }
  }

  // 显示加载状态
  showLoading(message = '正在加载...') {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('weatherContent').style.display = 'none';
    
    const loadingText = document.querySelector('.loading-state p');
    if (loadingText) {
      loadingText.textContent = message;
    }
  }

  // 隐藏加载状态
  hideLoading() {
    document.getElementById('loadingState').style.display = 'none';
  }

  // 显示错误状态
  showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('weatherContent').style.display = 'none';

    // 支持HTML内容
    const errorMessageElement = document.getElementById('errorMessage');
    if (message.includes('<')) {
      errorMessageElement.innerHTML = message;
    } else {
      errorMessageElement.textContent = message;
    }
    

  }

  // 显示天气内容
  showWeatherContent() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('weatherContent').style.display = 'block';

    // 更新收藏和默认按钮状态
    this.updateLocationActionButtons();
  }

  // 本地存储相关方法
  loadFavoriteLocations() {
    try {
      const stored = localStorage.getItem('favoriteLocations');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('加载收藏位置失败:', error);
      return [];
    }
  }

  saveFavoriteLocations() {
    try {
      localStorage.setItem('favoriteLocations', JSON.stringify(this.favoriteLocations));
    } catch (error) {
      console.error('保存收藏位置失败:', error);
    }
  }

  loadDefaultLocation() {
    try {
      const stored = localStorage.getItem('defaultLocation');
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('加载默认位置失败:', error);
      return null;
    }
  }

  saveDefaultLocation(location) {
    try {
      localStorage.setItem('defaultLocation', JSON.stringify(location));
      this.defaultLocation = location;
    } catch (error) {
      console.error('保存默认位置失败:', error);
    }
  }

  // 收藏功能
  toggleFavorite() {
    if (!this.currentLocation) return;

    const currentLocationName = document.getElementById('currentLocation').textContent;
    const locationData = {
      name: currentLocationName,
      lat: this.currentLocation.lat,
      lng: this.currentLocation.lng,
      address: currentLocationName
    };

    const existingIndex = this.favoriteLocations.findIndex(
      loc => Math.abs(loc.lat - locationData.lat) < 0.001 && Math.abs(loc.lng - locationData.lng) < 0.001
    );

    if (existingIndex >= 0) {
      // 取消收藏
      this.favoriteLocations.splice(existingIndex, 1);
    } else {
      // 添加收藏
      this.favoriteLocations.push(locationData);
    }

    this.saveFavoriteLocations();
    this.updateLocationActionButtons();
    this.updateFavoriteList();
  }

  // 设为默认/取消默认
  setAsDefault() {
    if (!this.currentLocation) return;

    // 检查是否为当前默认位置
    const isCurrentDefault = this.defaultLocation &&
      Math.abs(this.defaultLocation.lat - this.currentLocation.lat) < 0.001 &&
      Math.abs(this.defaultLocation.lng - this.currentLocation.lng) < 0.001;

    if (isCurrentDefault) {
      // 取消默认位置
      this.clearDefaultLocation();
    } else {
      // 设为默认位置
      const currentLocationName = document.getElementById('currentLocation').textContent;
      const locationData = {
        name: currentLocationName,
        lat: this.currentLocation.lat,
        lng: this.currentLocation.lng,
        address: currentLocationName
      };
      this.saveDefaultLocation(locationData);
    }

    this.updateLocationActionButtons();
    this.updateFavoriteList();
  }

  // 清除默认位置
  clearDefaultLocation() {
    try {
      localStorage.removeItem('defaultLocation');
      this.defaultLocation = null;
    } catch (error) {
      console.error('清除默认位置失败:', error);
    }
  }

  // 更新当前位置操作区域
  updateCurrentLocationActions() {
    const currentLocationActions = document.getElementById('currentLocationActions');
    const modalCurrentLocation = document.getElementById('modalCurrentLocation');

    if (!this.currentLocation || !currentLocationActions) return;

    // 显示当前位置操作区域
    currentLocationActions.style.display = 'block';

    // 更新当前位置显示
    const currentLocationName = document.getElementById('currentLocation')?.textContent || '当前位置';
    if (modalCurrentLocation) {
      modalCurrentLocation.textContent = currentLocationName;
    }

    // 更新按钮状态
    this.updateModalActionButtons();
  }

  // 更新模态框中的操作按钮状态
  updateModalActionButtons() {
    if (!this.currentLocation) return;

    const modalFavoriteBtn = document.getElementById('modalFavoriteBtn');
    const modalSetDefaultBtn = document.getElementById('modalSetDefaultBtn');

    // 检查是否已收藏
    const isFavorited = this.favoriteLocations.some(
      loc => Math.abs(loc.lat - this.currentLocation.lat) < 0.001 && Math.abs(loc.lng - this.currentLocation.lng) < 0.001
    );

    // 检查是否为默认位置
    const isDefault = this.defaultLocation &&
      Math.abs(this.defaultLocation.lat - this.currentLocation.lat) < 0.001 &&
      Math.abs(this.defaultLocation.lng - this.currentLocation.lng) < 0.001;

    if (modalFavoriteBtn) {
      modalFavoriteBtn.classList.toggle('active', isFavorited);
      modalFavoriteBtn.title = isFavorited ? '取消收藏' : '收藏此位置';
      const favoriteIcon = modalFavoriteBtn.querySelector('.favorite-icon');
      const favoriteText = modalFavoriteBtn.querySelector('.action-text');
      if (favoriteIcon) favoriteIcon.textContent = isFavorited ? '⭐' : '☆';
      if (favoriteText) favoriteText.textContent = isFavorited ? '取消收藏' : '收藏';
    }

    if (modalSetDefaultBtn) {
      modalSetDefaultBtn.classList.toggle('default', isDefault);
      modalSetDefaultBtn.title = isDefault ? '取消默认位置' : '设为默认位置';
      const defaultIcon = modalSetDefaultBtn.querySelector('.default-icon');
      const defaultText = modalSetDefaultBtn.querySelector('.action-text');
      if (defaultIcon) defaultIcon.textContent = isDefault ? '📍' : '📌';
      if (defaultText) defaultText.textContent = isDefault ? '取消默认' : '设为默认';
    }
  }

  // 更新位置操作按钮状态（保留用于兼容性，但现在主要更新模态框按钮）
  updateLocationActionButtons() {
    this.updateModalActionButtons();
  }

  // 更新收藏列表显示 - 优化事件委托
  updateFavoriteList() {
    const favoriteLocations = document.getElementById('favoriteLocations');
    const favoriteList = document.getElementById('favoriteList');

    if (!favoriteList || !favoriteLocations) return;

    if (this.favoriteLocations.length === 0) {
      favoriteLocations.style.display = 'none';
      return;
    }

    favoriteLocations.style.display = 'block';
    
    // 使用DocumentFragment批量更新
    const fragment = document.createDocumentFragment();
    
    this.favoriteLocations.forEach((location, index) => {
      const isDefault = this.defaultLocation &&
        Math.abs(this.defaultLocation.lat - location.lat) < 0.001 &&
        Math.abs(this.defaultLocation.lng - location.lng) < 0.001;

      const div = document.createElement('div');
      div.className = `favorite-item ${isDefault ? 'default' : ''}`;
      div.setAttribute('data-index', index);
      div.innerHTML = `
        <div class="favorite-info">
          <div class="favorite-name">${location.name}</div>
          <div class="favorite-address">${location.address}</div>
        </div>
        <div class="favorite-actions">
          ${!isDefault ? `<button class="favorite-action-btn set-default" title="设为默认">📍</button>` : ''}
          <button class="favorite-action-btn delete" title="删除">🗑️</button>
        </div>
      `;
      fragment.appendChild(div);
    });
    
    favoriteList.innerHTML = '';
    favoriteList.appendChild(fragment);

    // 使用事件委托，只绑定一个事件监听器
    if (!favoriteList.hasAttribute('data-listener-attached')) {
      favoriteList.setAttribute('data-listener-attached', 'true');
      
      favoriteList.addEventListener('click', (e) => {
        const item = e.target.closest('.favorite-item');
        if (!item) return;
        
        const index = parseInt(item.dataset.index);
        const location = this.favoriteLocations[index];
        
        if (e.target.classList.contains('set-default')) {
          e.stopPropagation();
          this.saveDefaultLocation(location);
          this.updateFavoriteList();
        } else if (e.target.classList.contains('delete')) {
          e.stopPropagation();
          this.favoriteLocations.splice(index, 1);
          this.saveFavoriteLocations();
          this.updateFavoriteList();
          this.updateLocationActionButtons();
        } else if (!e.target.classList.contains('favorite-action-btn')) {
          this.selectLocation(location.lng, location.lat, location.name);
        }
      });
    }
  }
}

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
  console.log('[页面] DOMContentLoaded事件触发');
  try {
    globalThis.weatherApp = new WeatherApp();
    console.log('[页面] WeatherApp实例创建成功');
  } catch (error) {
    console.error('[页面] 初始化失败:', error);
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorMessage').textContent = '应用初始化失败: ' + error.message;
  }
}, { passive: true });

// 页面卸载时清理资源
globalThis.addEventListener('beforeunload', () => {
  if (globalThis.weatherApp) {
    globalThis.weatherApp.cleanup();
  }
}, { passive: true });

// 页面可见性变化时暂停/恢复动画
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 页面隐藏时暂停动画
    document.body.style.animationPlayState = 'paused';
  } else {
    // 页面显示时恢复动画
    document.body.style.animationPlayState = 'running';
  }
}, { passive: true });
