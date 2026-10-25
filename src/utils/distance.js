/**
 * OpenStreetMap & OSRM Real Road Distance & Duration Routing Utility
 * 
 * Uses OpenStreetMap's OSRM routing engine (https://router.project-osrm.org)
 * to calculate real driving road distance and duration between coordinates [longitude, latitude].
 */

// In-memory cache to prevent redundant HTTP requests and rate limits
const routeCache = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const MAX_CACHE_SIZE = 1500;

function getCacheKey(lon1, lat1, lon2, lat2) {
  // Round to 4 decimal places (~11m resolution)
  return `${Number(lon1).toFixed(4)},${Number(lat1).toFixed(4)};${Number(lon2).toFixed(4)},${Number(lat2).toFixed(4)}`;
}

function getFromCache(key) {
  const cached = routeCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }
  return cached.data;
}

function setInCache(key, data) {
  if (routeCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = routeCache.keys().next().value;
    routeCache.delete(oldestKey);
  }
  routeCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Robust HTTP GET helper that supports native fetch, axios, or native https
 */
async function fetchJson(url, timeoutMs = 4000) {
  // 1. Try global fetch (Node 18+)
  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'EnPanneApp/1.0 (dz.enpanne.mobile)',
          'Accept': 'application/json'
        }
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      clearTimeout(timer);
    }
  }

  // 2. Try axios if installed
  try {
    const axios = require('axios');
    const res = await axios.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'EnPanneApp/1.0 (dz.enpanne.mobile)' }
    });
    return res.data;
  } catch (_) {}

  // 3. Fallback to native https
  return new Promise((resolve) => {
    try {
      const https = require('https');
      const req = https.get(url, {
        headers: { 'User-Agent': 'EnPanneApp/1.0 (dz.enpanne.mobile)' },
        timeout: timeoutMs
      }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return resolve(null);
        }
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (_) {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Calculates straight line distance (Haversine) in km
 */
function calculateHaversineDistance(lon1, lat1, lon2, lat2) {
  if (lon1 == null || lat1 == null || lon2 == null || lat2 == null) return null;
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Heuristic fallback for driving road distance when offline or OSRM unavailable
 */
function calculateDrivingDistanceFallback(lon1, lat1, lon2, lat2) {
  const straight = calculateHaversineDistance(lon1, lat1, lon2, lat2);
  if (straight == null) return null;
  const roadFactor = straight < 5 ? 1.25 : (straight < 25 ? 1.35 : 1.42);
  return Math.round(straight * roadFactor * 10) / 10;
}

/**
 * Computes exact road driving distance & duration using OpenStreetMap OSRM
 * Format expected by OSRM: longitude,latitude
 * 
 * @param {number} lon1 - Start longitude
 * @param {number} lat1 - Start latitude
 * @param {number} lon2 - Destination longitude
 * @param {number} lat2 - Destination latitude
 * @returns {Promise<{ distanceKm: number, durationMin: number, source: string } | null>}
 */
async function getOsrmRoute(lon1, lat1, lon2, lat2) {
  if (lon1 == null || lat1 == null || lon2 == null || lat2 == null) return null;

  const numLon1 = parseFloat(lon1);
  const numLat1 = parseFloat(lat1);
  const numLon2 = parseFloat(lon2);
  const numLat2 = parseFloat(lat2);

  if (isNaN(numLon1) || isNaN(numLat1) || isNaN(numLon2) || isNaN(numLat2)) return null;

  // Very close / identical points (< 20 meters)
  if (Math.abs(numLon1 - numLon2) < 0.0002 && Math.abs(numLat1 - numLat2) < 0.0002) {
    return { distanceKm: 0.1, durationMin: 1, source: 'osrm' };
  }

  const cacheKey = getCacheKey(numLon1, numLat1, numLon2, numLat2);
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const start = `${numLon1},${numLat1}`; // longitude,latitude
  const end = `${numLon2},${numLat2}`;     // longitude,latitude
  const url = `https://router.project-osrm.org/route/v1/driving/${start};${end}?overview=false`;

  try {
    const data = await fetchJson(url, 4000);
    if (data && data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
      const distanceMeters = data.routes[0].distance;
      const durationSeconds = data.routes[0].duration;

      const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
      const durationMin = Math.max(1, Math.round(durationSeconds / 60));

      const result = {
        distanceKm,
        durationMin,
        distanceMeters: Math.round(distanceMeters),
        durationSeconds: Math.round(durationSeconds),
        source: 'osrm'
      };

      setInCache(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.warn(`[OSRM Routing]: ${err.message || err}. Falling back.`);
  }

  // Graceful Fallback
  const fallbackKm = calculateDrivingDistanceFallback(numLon1, numLat1, numLon2, numLat2);
  if (fallbackKm == null) return null;

  return {
    distanceKm: fallbackKm,
    durationMin: Math.max(1, Math.round((fallbackKm / 45) * 60)),
    distanceMeters: Math.round(fallbackKm * 1000),
    durationSeconds: Math.round((fallbackKm / 45) * 3600),
    source: 'haversine_fallback'
  };
}

/**
 * Returns driving road distance in km (Promise)
 */
async function getDrivingDistance(lon1, lat1, lon2, lat2) {
  const route = await getOsrmRoute(lon1, lat1, lon2, lat2);
  return route ? route.distanceKm : null;
}

/**
 * Computes road driving distances for multiple destinations from a single origin
 * Uses OSRM Table API (/table/v1/driving) or concurrent route calls with caching
 * 
 * @param {number} originLon
 * @param {number} originLat
 * @param {Array<[number, number] | null>} destinations - Array of [longitude, latitude]
 * @returns {Promise<Array<{ distanceKm: number, durationMin: number } | null>>}
 */
async function getOsrmDistanceBatch(originLon, originLat, destinations) {
  if (!destinations || !Array.isArray(destinations) || destinations.length === 0) return [];
  if (originLon == null || originLat == null) return destinations.map(() => null);

  const numOriginLon = parseFloat(originLon);
  const numOriginLat = parseFloat(originLat);

  // If small batch (<= 6), query in parallel with individual route cache
  if (destinations.length <= 6) {
    return Promise.all(
      destinations.map(d => {
        if (!d || !Array.isArray(d) || d.length < 2) return null;
        return getOsrmRoute(numOriginLon, numOriginLat, d[0], d[1]);
      })
    );
  }

  // For larger batches, try OSRM Table service
  try {
    const validCoords = [`${numOriginLon},${numOriginLat}`];
    const indexMap = [];

    destinations.forEach((d, idx) => {
      if (d && Array.isArray(d) && d.length >= 2 && d[0] != null && d[1] != null) {
        validCoords.push(`${parseFloat(d[0])},${parseFloat(d[1])}`);
        indexMap.push(idx);
      }
    });

    if (validCoords.length > 1) {
      const coordsString = validCoords.slice(0, 60).join(';');
      const tableUrl = `https://router.project-osrm.org/table/v1/driving/${coordsString}?sources=0&annotations=distance,duration`;

      const data = await fetchJson(tableUrl, 5000);
      if (data && data.code === 'Ok' && data.distances && data.distances[0]) {
        const results = destinations.map(() => null);
        const rowDistances = data.distances[0];
        const rowDurations = data.durations ? data.durations[0] : null;

        indexMap.forEach((destIdx, i) => {
          const meters = rowDistances[i + 1];
          if (meters != null && !isNaN(meters)) {
            const distanceKm = Math.round((meters / 1000) * 10) / 10;
            const seconds = rowDurations ? rowDurations[i + 1] : null;
            const durationMin = seconds != null ? Math.max(1, Math.round(seconds / 60)) : Math.round((distanceKm / 45) * 60);
            results[destIdx] = { distanceKm, durationMin, source: 'osrm_table' };
          }
        });

        // Fill any null entries with fallback or individual route
        for (let i = 0; i < destinations.length; i++) {
          if (!results[i] && destinations[i]) {
            results[i] = await getOsrmRoute(numOriginLon, numOriginLat, destinations[i][0], destinations[i][1]);
          }
        }

        return results;
      }
    }
  } catch (err) {
    console.warn(`[OSRM Table API]: ${err.message || err}. Falling back to individual routes.`);
  }

  // Fallback: parallel route queries
  return Promise.all(
    destinations.map(d => {
      if (!d || !Array.isArray(d) || d.length < 2) return null;
      return getOsrmRoute(numOriginLon, numOriginLat, d[0], d[1]);
    })
  );
}

module.exports = {
  getOsrmRoute,
  getDrivingDistance,
  getOsrmDistanceBatch,
  calculateHaversineDistance,
  calculateDrivingDistance: calculateDrivingDistanceFallback
};
