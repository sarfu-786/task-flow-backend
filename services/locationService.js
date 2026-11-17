/**
 * Location Service for Complaint Management
 * Supports 10/10 Hybrid Architecture: High-accuracy GPS with silent IP fallback.
 */

const getClientIp = (req) => {
  if (!req) return '';
  const forwarded = req.headers ? req.headers['x-forwarded-for'] : '';
  if (forwarded) {
    const list = String(forwarded).split(',');
    return list[0].trim();
  }
  const realIp = req.headers ? req.headers['x-real-ip'] : '';
  if (realIp) return String(realIp).trim();
  return req.ip || (req.socket ? req.socket.remoteAddress : '') || '';
};

const isPrivateOrLoopback = (ip) => {
  if (!ip) return true;
  const clean = ip.replace(/^::ffff:/, '').trim();
  if (clean === '::1' || clean === '127.0.0.1' || clean.startsWith('127.')) return true;
  if (clean.startsWith('10.') || clean.startsWith('192.168.') || clean.startsWith('172.16.')) return true;
  if (clean === 'localhost') return true;
  return false;
};

/**
 * Resolves submitter location from client payload and server request context.
 * @param {Object} clientLoc - Location object sent from frontend
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} Normalized location object
 */
const resolveComplaintLocation = async (clientLoc, req) => {
  const rawIp = getClientIp(req);
  const cleanIp = (rawIp || '').replace(/^::ffff:/, '').trim();
  const now = new Date();

  // 1. High-Precision GPS Branch: If client provided valid coordinates
  if (
    clientLoc &&
    clientLoc.type === 'GPS' &&
    typeof clientLoc.latitude === 'number' &&
    typeof clientLoc.longitude === 'number' &&
    !isNaN(clientLoc.latitude) &&
    !isNaN(clientLoc.longitude)
  ) {
    const lat = Number(clientLoc.latitude);
    const lng = Number(clientLoc.longitude);
    const mapsUrl =
      clientLoc.mapsUrl ||
      `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;

    return {
      type: 'GPS',
      latitude: lat,
      longitude: lng,
      accuracy: clientLoc.accuracy || '',
      address:
        (clientLoc.address || '').trim() ||
        `Lat: ${lat.toFixed(4)}, Lon: ${lng.toFixed(4)}`,
      city: (clientLoc.city || '').trim(),
      state: (clientLoc.state || '').trim(),
      country: (clientLoc.country || '').trim(),
      postalCode: (clientLoc.postalCode || '').trim(),
      ip: cleanIp || clientLoc.ip || '',
      mapsUrl,
      capturedAt: clientLoc.capturedAt ? new Date(clientLoc.capturedAt) : now,
    };
  }

  // 2. Silent IP Geolocation Fallback: If GPS was blocked, timed out, or omitted
  let ipInfo = null;

  if (cleanIp && !isPrivateOrLoopback(cleanIp)) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800);
      const res = await fetch(
        `http://ip-api.com/json/${cleanIp}?fields=status,country,regionName,city,zip,lat,lon,isp`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && data.status === 'success') {
          ipInfo = data;
        }
      }
    } catch (_) {
      // Graceful fallback on network timeout/offline
    }
  }

  if (ipInfo) {
    const lat = typeof ipInfo.lat === 'number' ? ipInfo.lat : null;
    const lon = typeof ipInfo.lon === 'number' ? ipInfo.lon : null;
    const city = (ipInfo.city || '').trim();
    const state = (ipInfo.regionName || '').trim();
    const country = (ipInfo.country || '').trim();
    const addressParts = [city, state, country].filter(Boolean);

    return {
      type: 'IP',
      latitude: lat,
      longitude: lon,
      accuracy: 'ISP / City Level',
      address: addressParts.join(', ') || 'Network Location',
      city,
      state,
      country,
      postalCode: (ipInfo.zip || '').trim(),
      ip: cleanIp,
      mapsUrl:
        lat && lon
          ? `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`
          : '',
      capturedAt: now,
    };
  }

  // 3. Client provided IP metadata (e.g. from client-side network detection)
  if (clientLoc && clientLoc.type === 'IP') {
    return {
      type: 'IP',
      latitude: typeof clientLoc.latitude === 'number' ? clientLoc.latitude : null,
      longitude: typeof clientLoc.longitude === 'number' ? clientLoc.longitude : null,
      accuracy: clientLoc.accuracy || 'Network Level',
      address:
        (clientLoc.address || '').trim() ||
        (isPrivateOrLoopback(cleanIp)
          ? 'Local / Development Network'
          : 'Network Location'),
      city: (clientLoc.city || '').trim(),
      state: (clientLoc.state || '').trim(),
      country: (clientLoc.country || '').trim(),
      postalCode: (clientLoc.postalCode || '').trim(),
      ip: cleanIp,
      mapsUrl: clientLoc.mapsUrl || '',
      capturedAt: clientLoc.capturedAt ? new Date(clientLoc.capturedAt) : now,
    };
  }

  // 4. Localhost / Private Dev Environment
  if (isPrivateOrLoopback(cleanIp)) {
    return {
      type: 'IP',
      latitude: null,
      longitude: null,
      accuracy: 'Localhost',
      address: 'Internal / Local Development Network',
      city: 'Localhost',
      state: '',
      country: '',
      postalCode: '',
      ip: cleanIp || '127.0.0.1',
      mapsUrl: '',
      capturedAt: now,
    };
  }

  // 5. Minimal Fallback
  return {
    type: 'Unknown',
    latitude: null,
    longitude: null,
    accuracy: '',
    address: 'Location Not Available',
    city: '',
    state: '',
    country: '',
    postalCode: '',
    ip: cleanIp,
    mapsUrl: '',
    capturedAt: now,
  };
};

module.exports = {
  resolveComplaintLocation,
  getClientIp,
};
