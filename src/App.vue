<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from "vue";
import { PARKING_POINTS } from "./data/parkingPoints.js";
import { PARKING_DETAILS } from "./data/parkingDetails.js";

const AMAP_KEY = "b2839d2e087e1de306b56506ab2179bf";
const AUTH_STORAGE_KEY = "parking-map-authenticated";
const LOGIN_USERNAME = "admin";
const LOGIN_PASSWORD = "mszb@2026!";

const isAuthenticated = ref(
  typeof window !== "undefined" &&
    window.sessionStorage.getItem(AUTH_STORAGE_KEY) === "true"
);
const loginForm = reactive({
  username: "",
  password: "",
});
const loginError = ref("");
const showPassword = ref(false);
const keyword = ref("");
const messageText = ref("");
const messageError = ref(false);
const suggestions = ref([]);
const showSuggestions = ref(false);
const detailOpen = ref(false);
const detail = reactive({
  name: "",
  address: "",
  district: "",
  cost: [],
  sale: [],
  note: "",
});

const mapEl = ref(null);

let map = null;
let placeSearch = null;
let geolocation = null;
let autoComplete = null;
let searchMarker = null;
let nearestLine = null;
let walkingLine = null;
let drivingLine = null;
let distancePopup = null;
let walking = null;
let driving = null;
let routeRequestId = 0;
let mapLoading = false;
const parkingLocations = [];

function showMessage(text, isError = false) {
  messageText.value = text;
  messageError.value = isError;
}

function formatDistance(meters) {
  return meters < 1000
    ? `${Math.round(meters)} 米`
    : `${(meters / 1000).toFixed(1)} 公里`;
}

function openDetail(point) {
  const info = PARKING_DETAILS[point.name] || {};
  detail.name = point.name;
  detail.address = point.address;
  detail.district = info.district || "杭州市";
  detail.cost = info.cost || [];
  detail.sale = info.sale || [];
  detail.note = info.note || "";
  detailOpen.value = true;
}

function closeDetails() {
  detailOpen.value = false;
}

function addParkingMarkers() {
  const markers = [];
  PARKING_POINTS.forEach((point) => {
    const position = point.fallback;
    const marker = new AMap.Marker({
      map,
      position,
      title: point.name,
      content: `<div class="station-marker type-${point.type}" aria-label="${point.name}"><span></span></div>`,
      offset: new AMap.Pixel(-14, -34),
      label: {
        content: point.name,
        direction: "top",
        offset: new AMap.Pixel(0, -4),
      },
      zIndex: 100,
    });
    marker.on("click", () => openDetail(point));
    markers.push(marker);
    parkingLocations.push({ point, position, marker });
    if (markers.length === PARKING_POINTS.length)
      map.setFitView(markers, false, [60, 60, 60, 60]);
  });
}

function addSearchMarker(poi) {
  const position = [poi.location.lng, poi.location.lat];
  map.setCenter(position);
  map.setZoom(15);
  if (searchMarker) searchMarker.setMap(null);
  clearRouteOverlays();
  searchMarker = new AMap.Marker({
    map,
    position,
    title: poi.name,
    content:
      '<div class="search-marker" aria-label="搜索位置"><span></span></div>',
    offset: new AMap.Pixel(-14, -34),
  });
  drawNearestLine(position);
}

function clearRouteOverlays() {
  routeRequestId += 1;
  [nearestLine, walkingLine, drivingLine, distancePopup].forEach((overlay) => {
    if (overlay) overlay.setMap(null);
  });
  nearestLine = null;
  walkingLine = null;
  drivingLine = null;
  distancePopup = null;
}

function coordinateDistance(a, b) {
  const latDistance = (a[1] - b[1]) * 111.32;
  const lngDistance = (a[0] - b[0]) * 111.32 * Math.cos((a[1] * Math.PI) / 180);
  return Math.sqrt(latDistance ** 2 + lngDistance ** 2);
}

function drawNearestLine(searchPosition) {
  if (!parkingLocations.length) return;
  const nearest = parkingLocations.reduce((current, item) => {
    if (!current) return item;
    return coordinateDistance(searchPosition, item.position) <
      coordinateDistance(searchPosition, current.position)
      ? item
      : current;
  }, null);
  const distance = coordinateDistance(searchPosition, nearest.position);
  nearestLine = new AMap.Polyline({
    map,
    path: [searchPosition, nearest.position],
    strokeColor: "#64748b",
    strokeOpacity: 0.65,
    strokeWeight: 2,
    strokeStyle: "dashed",
    lineJoin: "round",
    zIndex: 70,
  });
  updateDistancePopup(searchPosition, nearest.position, distance, distance);
  getRouteDistances(searchPosition, nearest.position, distance);
  showMessage(`最近点位：${nearest.point.name}`);
}

function getRoutePath(route) {
  if (route?.path?.length) return route.path;
  return (route?.steps || []).flatMap((step) => step.path || []);
}

function updateDistancePopup(from, to, walkingMeters, drivingMeters) {
  const midpoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const content = `<div class="distance-popup"><div><span class="route-icon">♧</span>步行 <b>${formatDistance(
    walkingMeters * 1000
  )}</b></div><div><span class="route-icon">▣</span>驾车 <b>${formatDistance(
    drivingMeters * 1000
  )}</b></div></div>`;
  if (distancePopup) {
    distancePopup.setPosition(midpoint);
    distancePopup.setContent(content);
  } else {
    distancePopup = new AMap.Marker({
      map,
      position: midpoint,
      content,
      offset: new AMap.Pixel(-72, -42),
      zIndex: 120,
    });
  }
}

function getRouteDistances(from, to, fallbackKm) {
  const requestId = ++routeRequestId;
  let walkingMeters = fallbackKm * 1000;
  let drivingMeters = fallbackKm * 1000;
  let completed = 0;
  const update = () => {
    if (requestId !== routeRequestId) return;
    completed += 1;
    if (completed === 2)
      updateDistancePopup(from, to, walkingMeters / 1000, drivingMeters / 1000);
  };
  walking.search(from, to, (status, result) => {
    if (requestId !== routeRequestId) return;
    if (walkingLine) walkingLine.setMap(null);
    walkingLine = null;
    if (status === "complete" && result.routes?.[0]) {
      const route = result.routes[0];
      walkingMeters = route.distance || walkingMeters;
      const path = getRoutePath(route);
      if (path.length > 1)
        walkingLine = new AMap.Polyline({
          map,
          path,
          strokeColor: "#1677ff",
          strokeOpacity: 0.9,
          strokeWeight: 5,
          lineJoin: "round",
          zIndex: 110,
        });
    }
    update();
  });
  driving.search(from, to, (status, result) => {
    if (requestId !== routeRequestId) return;
    if (drivingLine) drivingLine.setMap(null);
    drivingLine = null;
    if (status === "complete" && result.routes?.[0]) {
      const route = result.routes[0];
      drivingMeters = route.distance || drivingMeters;
      const path = getRoutePath(route);
      if (path.length > 1)
        drivingLine = new AMap.Polyline({
          map,
          path,
          strokeColor: "#e53935",
          strokeOpacity: 0.9,
          strokeWeight: 5,
          lineJoin: "round",
          zIndex: 111,
        });
    }
    update();
  });
}

function locateCurrentPosition() {
  showMessage("正在获取当前位置…");
  geolocation.getCurrentPosition((status, result) => {
    if (status === "complete") {
      const position = result.position;
      map.setCenter(position);
      map.setZoom(16);
      new AMap.Marker({ map, position, title: "当前位置" });
      showMessage("已定位到当前位置");
    } else {
      showMessage("定位失败，请检查浏览器定位权限", true);
    }
  });
}

function selectSuggestion(item) {
  keyword.value = item.name || item.address || "";
  suggestions.value = [];
  showSuggestions.value = false;
  if (item.location) {
    addSearchMarker({ name: item.name, location: item.location });
    showMessage(`已定位：${item.name}`);
  } else {
    searchPlace();
  }
}

function renderSuggestions(result) {
  const tips = result?.tips || [];
  suggestions.value = tips.filter((item) => item.name).slice(0, 8);
  showSuggestions.value = suggestions.value.length > 0;
}

function searchPlace() {
  const kw = keyword.value.trim();
  if (!kw) {
    showMessage("请输入要搜索的地点或地址", true);
    return;
  }
  showMessage("正在搜索…");
  placeSearch.search(kw, (status, result) => {
    if (status === "complete" && result.poiList?.pois?.length) {
      addSearchMarker(result.poiList.pois[0]);
      showMessage(`已定位：${result.poiList.pois[0].name}`);
    } else {
      showMessage("没有找到相关地点，请换一个关键词", true);
    }
  });
}

function onInput() {
  const kw = keyword.value.trim();
  if (!kw) {
    suggestions.value = [];
    showSuggestions.value = false;
    return;
  }
  if (autoComplete) autoComplete.search(kw);
}

function onKeydown(event) {
  if (event.key === "Enter") searchPlace();
  if (event.key === "Escape") {
    suggestions.value = [];
    showSuggestions.value = false;
  }
}

function onDocumentClick(event) {
  if (!event.target.closest(".search-box")) {
    showSuggestions.value = false;
  }
}

function handleLogin() {
  const username = loginForm.username.trim();
  if (username === LOGIN_USERNAME && loginForm.password === LOGIN_PASSWORD) {
    loginError.value = "";
    isAuthenticated.value = true;
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, "true");
    nextTick(initMap);
    return;
  }
  loginError.value = "账号或密码错误";
  loginForm.password = "";
}

function handleLogout() {
  window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
  isAuthenticated.value = false;
  loginForm.password = "";
  destroyMap();
}

function destroyMap() {
  document.removeEventListener("click", onDocumentClick);
  clearRouteOverlays();
  if (searchMarker) searchMarker.setMap(null);
  if (map) map.destroy();
  map = null;
  placeSearch = null;
  geolocation = null;
  autoComplete = null;
  searchMarker = null;
  walking = null;
  driving = null;
  mapLoading = false;
  parkingLocations.splice(0);
}

function initMap() {
  if (map || mapLoading || !mapEl.value) return;
  mapLoading = true;
  AMapLoader.load({
    key: AMAP_KEY,
    version: "2.0",
    plugins: [
      "AMap.PlaceSearch",
      "AMap.AutoComplete",
      "AMap.Geolocation",
      "AMap.ToolBar",
      "AMap.Scale",
      "AMap.Geocoder",
      "AMap.Walking",
      "AMap.Driving",
    ],
  })
    .then((AMap) => {
      mapLoading = false;
      window.AMap = AMap;
      map = new AMap.Map(mapEl.value, {
        zoom: 11,
        center: [120.15507, 30.274085],
        viewMode: "2D",
      });
      map.addControl(new AMap.ToolBar());
      map.addControl(new AMap.Scale());
      placeSearch = new AMap.PlaceSearch({ map, pageSize: 10 });
      autoComplete = new AMap.AutoComplete({ city: "杭州市" });
      autoComplete.on("complete", renderSuggestions);
      walking = new AMap.Walking();
      driving = new AMap.Driving({ policy: AMap.DrivingPolicy.LEAST_TIME });
      geolocation = new AMap.Geolocation({
        enableHighAccuracy: true,
        timeout: 10000,
        zoomToAccuracy: true,
      });
      map.addControl(geolocation);
      addParkingMarkers();
      document.addEventListener("click", onDocumentClick);
      showMessage("地图加载完成");
      window.setTimeout(() => showMessage(""), 1800);
    })
    .catch((error) => {
      mapLoading = false;
      console.error("高德地图加载失败：", error);
      showMessage("地图加载失败，请检查网络或高德地图 Key 配置", true);
    });
}

onMounted(() => {
  if (isAuthenticated.value) {
    nextTick(initMap);
  }
});

onBeforeUnmount(() => {
  destroyMap();
});
</script>

<template>
  <main v-if="!isAuthenticated" class="login-page">
    <form class="login-panel" @submit.prevent="handleLogin">
      <h1>停车地图登录</h1>
      <label>
        <span>用户名</span>
        <input
          v-model="loginForm.username"
          type="text"
          autocomplete="username"
          autofocus
        />
      </label>
      <label>
        <span>密码</span>
        <div class="password-field">
          <input
            v-model="loginForm.password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
          />
          <button
            class="password-toggle"
            :class="{ 'is-visible': showPassword }"
            type="button"
            :aria-label="showPassword ? '隐藏密码' : '显示密码'"
            @click="showPassword = !showPassword"
          >
            <span></span>
          </button>
        </div>
      </label>
      <div
        class="login-error"
        :class="{ 'is-visible': !!loginError }"
        role="alert"
      >
        {{ loginError }}
      </div>
      <button class="login-submit" type="submit">登录</button>
    </form>
  </main>
  <main v-else class="map-page">
    <header class="toolbar">
      <div class="search-box">
        <input
          id="keyword"
          v-model="keyword"
          type="search"
          placeholder="搜索地点或地址"
          autocomplete="off"
          @keydown="onKeydown"
          @input="onInput"
        />
        <button id="searchButton" type="button" @click="searchPlace">
          搜索
        </button>
        <div
          id="suggestions"
          class="suggestions"
          :class="{ 'is-visible': showSuggestions }"
          role="listbox"
        >
          <button
            v-for="item in suggestions"
            :key="item.id"
            type="button"
            class="suggestion-item"
            role="option"
            @click="selectSuggestion(item)"
          >
            <strong>{{ item.name }}</strong>
            <span>{{ item.district || item.address || "杭州" }}</span>
          </button>
        </div>
      </div>
      <!-- <button class="logout-button" type="button" @click="handleLogout">退出</button> -->
    </header>
    <section class="map-container">
      <div ref="mapEl" id="map" aria-label="高德地图"></div>
      <div class="route-legend" aria-label="路线图例">
        <div>
          <span class="legend-swatch legend-swatch-walking"></span>步行路线
        </div>
        <div>
          <span class="legend-swatch legend-swatch-driving"></span>驾车路线
        </div>
        <div>
          <span class="legend-swatch legend-swatch-reference"></span>直线参考
        </div>
      </div>
      <div
        id="message"
        class="message"
        :class="{ 'is-visible': !!messageText, 'is-error': messageError }"
        role="status"
      >
        {{ messageText }}
      </div>
      <aside
        id="detailPanel"
        class="detail-panel"
        :class="{ 'is-open': detailOpen }"
        :aria-hidden="!detailOpen"
      >
        <button
          id="closeDetail"
          class="detail-close"
          type="button"
          aria-label="关闭详情"
          @click="closeDetails"
        >
          ×
        </button>
        <div id="detailContent">
          <h2>{{ detail.name }}</h2>
          <div class="detail-address">{{ detail.address }}</div>
          <dl>
            <dt>成本</dt>
            <dd>
              <div v-for="item in detail.cost" :key="item">{{ item }}</div>
              <div v-if="!detail.cost.length" class="muted">暂无信息</div>
            </dd>
            <dt>销售价</dt>
            <dd>
              <div v-for="item in detail.sale" :key="item">{{ item }}</div>
              <div v-if="!detail.sale.length" class="muted">暂无信息</div>
            </dd>
            <dt>备注</dt>
            <dd>
              <span v-if="detail.note" v-html="detail.note"></span>
              <span v-else class="muted">暂无备注</span>
            </dd>
          </dl>
        </div>
      </aside>
      <button
        id="locateButton"
        class="locate-button"
        type="button"
        @click="locateCurrentPosition"
      >
        定位当前位置
      </button>
    </section>
  </main>
</template>
