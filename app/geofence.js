// Geofence module, ported from Sanctuary Watch (proven demo 2026-08).
// Browser geolocation only works while the page is open; the QR scan is the
// primary enter event, GPS is the bonus layer. Do not sell it as background
// geofencing (that needs a native app).
(function () {
  function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // One-shot: are we on campus right now?
  function checkOnce(campus) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ supported: false });
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const dist = distanceMeters(pos.coords.latitude, pos.coords.longitude, campus.lat, campus.lng);
          resolve({
            supported: true, ok: true,
            inside: dist <= campus.fenceRadius,
            distance: Math.round(dist),
            accuracy: Math.round(pos.coords.accuracy)
          });
        },
        (err) => resolve({ supported: true, ok: false, error: err.message }),
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 12000 }
      );
    });
  }

  // Continuous watcher with enter/exit state machine ("Sunday mode").
  function createWatcher(campus, { onEnter, onExit, onUpdate, onError } = {}) {
    let watchId = null;
    let inside = null; // unknown until first fix
    return {
      start() {
        if (!navigator.geolocation || watchId !== null) return false;
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const dist = distanceMeters(pos.coords.latitude, pos.coords.longitude, campus.lat, campus.lng);
            const nowInside = dist <= campus.fenceRadius;
            const info = { distance: Math.round(dist), accuracy: Math.round(pos.coords.accuracy), inside: nowInside };
            if (onUpdate) onUpdate(info);
            if (inside === null) { inside = nowInside; if (nowInside && onEnter) onEnter(info); return; }
            if (nowInside !== inside) {
              inside = nowInside;
              if (nowInside && onEnter) onEnter(info);
              if (!nowInside && onExit) onExit(info);
            }
          },
          (err) => { if (onError) onError(err); },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
        return true;
      },
      stop() {
        if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; inside = null; }
      },
      get active() { return watchId !== null; }
    };
  }

  window.GCCGeo = { distanceMeters, checkOnce, createWatcher };
})();
