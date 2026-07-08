// Weather App
// Using Open-Meteo API because it's free and doesn't need an API key
// Docs: https://open-meteo.com/en/docs

const searchForm = document.getElementById('searchForm');
const cityInput = document.getElementById('cityInput');
const locationBtn = document.getElementById('locationBtn');
const unitToggle = document.getElementById('unitToggle');
const suggestionsBox = document.getElementById('suggestions');
const errorMsg = document.getElementById('errorMsg');
const weatherCard = document.getElementById('weatherCard');
const loading = document.getElementById('loading');
const weatherBg = document.getElementById('weatherBg');

let unit = 'C'; // switches to F when the toggle button is clicked
let lastData = null; // keep the last response around so toggling units doesn't need a new fetch
let lastLocationName = '';
let utcOffsetSeconds = 0; // how far the searched location is from UTC, used for the live clock
let clockInterval = null; // reference to the ticking clock, so we can stop the old one when searching a new city

// weather codes from open-meteo, mapped to something readable
// (list is from their docs page, didn't need all of them)
const weatherCodes = {
  0: ['Clear sky', '☀️', 'clear'],
  1: ['Mainly clear', '🌤️', 'clear'],
  2: ['Partly cloudy', '⛅', 'cloudy'],
  3: ['Overcast', '☁️', 'cloudy'],
  45: ['Fog', '🌫️', 'cloudy'],
  48: ['Fog', '🌫️', 'cloudy'],
  51: ['Light drizzle', '🌦️', 'rain'],
  53: ['Drizzle', '🌦️', 'rain'],
  55: ['Heavy drizzle', '🌦️', 'rain'],
  61: ['Light rain', '🌧️', 'rain'],
  63: ['Rain', '🌧️', 'rain'],
  65: ['Heavy rain', '🌧️', 'rain'],
  71: ['Light snow', '🌨️', 'snow'],
  73: ['Snow', '🌨️', 'snow'],
  75: ['Heavy snow', '🌨️', 'snow'],
  80: ['Rain showers', '🌦️', 'rain'],
  81: ['Rain showers', '🌦️', 'rain'],
  82: ['Violent rain showers', '⛈️', 'storm'],
  95: ['Thunderstorm', '⛈️', 'storm'],
  96: ['Thunderstorm', '⛈️', 'storm'],
  99: ['Thunderstorm', '⛈️', 'storm'],
};

// background gradient per weather "mood" - just something nicer than plain white
const gradients = {
  clear: ['#f7971e', '#ffd200'],
  cloudy: ['#757f9a', '#d7dde8'],
  rain: ['#3a6186', '#89253e'],
  snow: ['#83a4d4', '#b6fbff'],
  storm: ['#232526', '#414345'],
};

// The geocoding API only indexes actual cities/towns, not state or country
// boundaries - so searching a bare state name like "Kerala" normally returns
// nothing. This table redirects common Indian state/UT names (and "India"
// itself) to a real, well-known city in that region, the same way Google
// or any weather app quietly does under the hood.
const regionToCity = {
  'andhra pradesh': 'Vijayawada',
  'arunachal pradesh': 'Itanagar',
  'assam': 'Guwahati',
  'bihar': 'Patna',
  'chhattisgarh': 'Raipur',
  'goa': 'Panaji',
  'gujarat': 'Ahmedabad',
  'haryana': 'Chandigarh',
  'himachal pradesh': 'Shimla',
  'jharkhand': 'Ranchi',
  'karnataka': 'Bengaluru',
  'kerala': 'Thiruvananthapuram',
  'madhya pradesh': 'Bhopal',
  'maharashtra': 'Mumbai',
  'manipur': 'Imphal',
  'meghalaya': 'Shillong',
  'mizoram': 'Aizawl',
  'nagaland': 'Kohima',
  'odisha': 'Bhubaneswar',
  'punjab': 'Chandigarh',
  'rajasthan': 'Jaipur',
  'sikkim': 'Gangtok',
  'tamil nadu': 'Chennai',
  'telangana': 'Hyderabad',
  'tripura': 'Agartala',
  'uttar pradesh': 'Lucknow',
  'uttarakhand': 'Dehradun',
  'west bengal': 'Kolkata',
  'andaman and nicobar islands': 'Port Blair',
  'chandigarh': 'Chandigarh',
  'dadra and nagar haveli and daman and diu': 'Daman',
  'delhi': 'New Delhi',
  'jammu and kashmir': 'Srinagar',
  'ladakh': 'Leh',
  'lakshadweep': 'Kavaratti',
  'puducherry': 'Puducherry',
  'india': 'New Delhi',
};

// checks the table above, ignoring extra spaces/casing so "tamilnadu" and
// "Tamil Nadu" both match
function findRegionCity(query) {
  const normalized = query.toLowerCase().trim();
  const collapsed = normalized.replace(/\s+/g, '');

  for (const key in regionToCity) {
    if (key === normalized || key.replace(/\s+/g, '') === collapsed) {
      return regionToCity[key];
    }
  }
  return null;
}

function getWeatherInfo(code) {
  // fallback in case a code isn't in the list above
  return weatherCodes[code] || ['Unknown', '❓', 'clear'];
}

searchForm.addEventListener('submit', function (e) {
  e.preventDefault();
  hideSuggestions();
  const city = cityInput.value.trim();
  if (city === '') return;
  getWeatherByCity(city);
});

// autocomplete - wait a bit after typing stops before hitting the API,
// so we're not sending a request on every single keystroke
let typingTimer;
cityInput.addEventListener('input', function () {
  clearTimeout(typingTimer);
  const query = cityInput.value.trim();

  if (query.length < 2) {
    hideSuggestions();
    return;
  }

  typingTimer = setTimeout(function () {
    fetchSuggestions(query);
  }, 300);
});

// hide the dropdown if you click anywhere else on the page
document.addEventListener('click', function (e) {
  if (e.target !== cityInput && !suggestionsBox.contains(e.target)) {
    hideSuggestions();
  }
});

async function fetchSuggestions(query) {
  try {
    const res = await fetch(
      'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=8'
    );
    const data = await res.json();
    showSuggestions(data.results || []);
  } catch (err) {
    console.log(err);
    hideSuggestions(); // fail quietly, autocomplete isn't critical
  }
}

function showSuggestions(results) {
  if (results.length === 0) {
    hideSuggestions();
    return;
  }

  suggestionsBox.innerHTML = '';

  results.forEach(function (place) {
    const region = [place.admin1, place.country].filter(Boolean).join(', ');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = place.name + '<span>' + region + '</span>';

    btn.addEventListener('click', function () {
      cityInput.value = place.name;
      hideSuggestions();
      const locationName = buildLocationName(place);
      getWeatherByCoords(place.latitude, place.longitude, locationName);
    });

    suggestionsBox.appendChild(btn);
  });

  suggestionsBox.classList.remove('hidden');
}

function hideSuggestions() {
  suggestionsBox.classList.add('hidden');
  suggestionsBox.innerHTML = '';
}

locationBtn.addEventListener('click', function () {
  if (!navigator.geolocation) {
    showError('Your browser does not support geolocation.');
    return;
  }

  showLoading();
  navigator.geolocation.getCurrentPosition(
    function (position) {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      getWeatherByCoords(lat, lon, 'My Location');
    },
    function (err) {
      hideLoading();
      console.log(err);
      // err.code: 1 = permission denied, 2 = position unavailable, 3 = timed out
      if (err.code === 1) {
        showError('Location access was denied. Please allow it in your browser settings or search manually.');
      } else {
        showError('Could not get your location. Please try again or search manually.');
      }
    },
    { timeout: 8000 } // stop waiting after 8 seconds instead of hanging forever
  );
});

unitToggle.addEventListener('click', function () {
  unit = unit === 'C' ? 'F' : 'C';
  unitToggle.textContent = '°' + unit;
  if (lastData) {
    displayWeather(lastData, lastLocationName); // re-render with the data we already have
  }
});

// Step 1: turn a city, state, or country name into coordinates using the geocoding API
async function getWeatherByCity(city) {
  showLoading();
  errorMsg.textContent = '';

  // if someone searched a whole state/UT or "India" itself, redirect to a
  // real city in that region instead of asking the geocoding API for
  // something it will never have
  const regionCity = findRegionCity(city);
  const searchTerm = regionCity || city;

  try {
    const geoRes = await fetch(
      'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(searchTerm) + '&count=8'
    );
    const geoData = await geoRes.json();

    if (!geoData.results || geoData.results.length === 0) {
      hideLoading();
      showError('Location not found. Try a nearby city instead - weather is shown for a specific point, so very large regions sometimes don\u2019t have one result.');
      return;
    }

    // prefer an exact name match (this is what catches states/countries like
    // "Kerala" or "India" - without this we'd just grab whatever city happens
    // to be ranked first, which is often wrong)
    const exactMatch = geoData.results.find(
      (r) => r.name.toLowerCase() === searchTerm.toLowerCase()
    );
    const place = exactMatch || geoData.results[0];

    const locationName = buildLocationName(place);

    getWeatherByCoords(place.latitude, place.longitude, locationName);
  } catch (err) {
    console.log(err);
    hideLoading();
    showError('Something went wrong. Please try again.');
  }
}

// combines city + state + country into one readable label, e.g. "Chennai, Tamil Nadu, India"
function buildLocationName(place) {
  return [place.name, place.admin1, place.country].filter(Boolean).join(', ');
}

// Step 2: get the actual weather using lat/lon
async function getWeatherByCoords(lat, lon, locationName) {
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
      '&longitude=' + lon +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,surface_pressure' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&timezone=auto';

    const res = await fetch(url);
    const data = await res.json();

    lastData = data;
    lastLocationName = locationName;
    utcOffsetSeconds = data.utc_offset_seconds || 0;
    displayWeather(data, locationName);
  } catch (err) {
    console.log(err);
    showError('Something went wrong fetching the weather. Please try again.');
  } finally {
    hideLoading();
  }
}

function celsiusToFahrenheit(c) {
  return (c * 9) / 5 + 32;
}

function formatTemp(celsius) {
  const value = unit === 'F' ? celsiusToFahrenheit(celsius) : celsius;
  return Math.round(value) + '°';
}

// updates the on-screen clock using the searched location's UTC offset,
// so it ticks in real time (with seconds) no matter where you are
function updateClock() {
  const nowMs = Date.now() + utcOffsetSeconds * 1000;
  const d = new Date(nowMs);

  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  });

  document.getElementById('dateTime').textContent = weekday + ', ' + time;
}

function startLiveClock() {
  clearInterval(clockInterval); // stop the previous city's clock, if there was one
  updateClock(); // show it immediately instead of waiting a full second
  clockInterval = setInterval(updateClock, 1000);
}

function displayWeather(data, locationName) {
  const current = data.current;
  const weatherInfo = getWeatherInfo(current.weather_code);
  const mood = weatherInfo[2];

  document.getElementById('cityName').textContent = locationName;
  startLiveClock();

  document.getElementById('weatherIcon').textContent = weatherInfo[1];
  document.getElementById('temp').textContent = formatTemp(current.temperature_2m);
  document.getElementById('description').textContent = weatherInfo[0];
  document.getElementById('feelsLike').textContent =
    'Feels like ' + formatTemp(current.apparent_temperature);

  document.getElementById('humidity').textContent = current.relative_humidity_2m + '%';
  document.getElementById('wind').textContent = Math.round(current.wind_speed_10m) + ' km/h';
  document.getElementById('pressure').textContent = Math.round(current.surface_pressure) + ' hPa';

  buildForecast(data.daily);
  setBackground(mood);

  weatherCard.classList.remove('hidden');
  errorMsg.textContent = '';
}

function buildForecast(daily) {
  const forecastDiv = document.getElementById('forecast');
  forecastDiv.innerHTML = ''; // clear old forecast before adding new one

  // only showing 5 days, skipping today (index 0)
  for (let i = 1; i <= 5; i++) {
    const date = new Date(daily.time[i]);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const info = getWeatherInfo(daily.weather_code[i]);
    const max = formatTemp(daily.temperature_2m_max[i]);
    const min = formatTemp(daily.temperature_2m_min[i]);

    const dayBox = document.createElement('div');
    dayBox.className = 'forecast-day';
    dayBox.innerHTML =
      '<p>' + dayName + '</p>' +
      '<p class="f-icon">' + info[1] + '</p>' +
      '<p class="f-temps">' + max + '/' + min + '</p>';

    forecastDiv.appendChild(dayBox);
  }
}

function setBackground(mood) {
  const colors = gradients[mood] || gradients.clear;
  document.documentElement.style.setProperty('--grad-1', colors[0]);
  document.documentElement.style.setProperty('--grad-2', colors[1]);

  // swap which background element is visible (sun / clouds / rain) to match
  // the actual weather - CSS handles the fade in/out via the mood-* class
  weatherBg.className = 'weather-bg mood-' + mood;
}

function showLoading() {
  loading.classList.remove('hidden');
  weatherCard.classList.add('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

function showError(msg) {
  errorMsg.textContent = msg;
}

// load a default city on first visit so the page isn't empty.
// we already know Guntur's coordinates, so we skip the geocoding step
// entirely and go straight to the forecast - cuts the initial load roughly in half
window.addEventListener('DOMContentLoaded', function () {
  getWeatherByCoords(16.3067, 80.4365, 'Guntur, Andhra Pradesh, India');
});