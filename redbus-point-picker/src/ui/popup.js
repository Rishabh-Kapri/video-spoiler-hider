/**
 * Map picker + saved locations + recon export.
 * Leaflet is vendored locally; MV3 forbids remote script.
 */
(function () {
  'use strict';

  var geo = RB.geo;
  var storage = RB.storage;

  var INDIA_CENTER = [20.5937, 78.9629];

  var state = {
    activeSlot: 'origin',
    pins: { origin: null, destination: null },
    saved: []
  };

  var map = null;
  var markers = { origin: null, destination: null };

  var $ = function (id) { return document.getElementById(id); };

  function pinIcon(slot) {
    return L.divIcon({
      className: '',
      html: '<span class="rbpp-pin rbpp-pin-' + slot + '"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  }

  function fmt(pin) {
    if (!pin) return 'not set';
    var coords = pin.lat.toFixed(5) + ', ' + pin.lng.toFixed(5);
    return pin.label ? pin.label + ' · ' + coords : coords;
  }

  // --- map -------------------------------------------------------------------

  function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView(INDIA_CENTER, 5);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    map.on('click', function (e) {
      setPin(state.activeSlot, { lat: e.latlng.lat, lng: e.latlng.lng });
    });
  }

  function syncMarker(slot) {
    var pin = state.pins[slot];
    if (!pin) {
      if (markers[slot]) {
        map.removeLayer(markers[slot]);
        markers[slot] = null;
      }
      return;
    }
    if (markers[slot]) {
      markers[slot].setLatLng([pin.lat, pin.lng]);
      return;
    }
    var m = L.marker([pin.lat, pin.lng], { icon: pinIcon(slot), draggable: true });
    m.on('dragend', function () {
      var ll = m.getLatLng();
      // Dragging is a fresh choice — the old label no longer describes it.
      setPin(slot, { lat: ll.lat, lng: ll.lng }, true);
    });
    m.addTo(map);
    markers[slot] = m;
  }

  function fitToPins() {
    var pts = [];
    if (state.pins.origin) pts.push([state.pins.origin.lat, state.pins.origin.lng]);
    if (state.pins.destination) pts.push([state.pins.destination.lat, state.pins.destination.lng]);
    if (pts.length === 1) map.setView(pts[0], 14);
    else if (pts.length === 2) map.fitBounds(pts, { padding: [40, 40] });
  }

  function setPin(slot, coord, keepView) {
    if (!coord || !isFinite(coord.lat) || !isFinite(coord.lng)) return;
    state.pins[slot] = { lat: coord.lat, lng: coord.lng, label: coord.label || null };
    storage.setPins(state.pins);
    syncMarker(slot);
    if (!keepView) map.panTo([coord.lat, coord.lng]);
    renderSlots();
  }

  // --- slots -----------------------------------------------------------------

  function renderSlots() {
    $('val-origin').textContent = fmt(state.pins.origin);
    $('val-destination').textContent = fmt(state.pins.destination);
    $('slot-origin').setAttribute('aria-pressed', String(state.activeSlot === 'origin'));
    $('slot-destination').setAttribute('aria-pressed', String(state.activeSlot === 'destination'));
    $('hint').innerHTML = '';
    var label = state.activeSlot === 'origin' ? 'pickup' : 'drop-off';
    $('hint').appendChild(document.createTextNode('Tap the map to place your '));
    var strong = document.createElement('strong');
    strong.textContent = label;
    $('hint').appendChild(strong);
    $('hint').appendChild(document.createTextNode(' pin. Drag a pin to fine-tune.'));
  }

  function bindSlots() {
    ['origin', 'destination'].forEach(function (slot) {
      $('slot-' + slot).addEventListener('click', function () {
        state.activeSlot = slot;
        renderSlots();
        var pin = state.pins[slot];
        if (pin) map.panTo([pin.lat, pin.lng]);
      });
    });
  }

  // --- coordinate paste ------------------------------------------------------

  function parseCoordText(text) {
    if (typeof text !== 'string') return null;
    // Accepts "12.97, 77.59" and Google Maps URLs containing @lat,lng or q=lat,lng
    var m = text.match(/(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/);
    if (!m) return null;
    var lat = Number(m[1]);
    var lng = Number(m[2]);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  function bindCoordInput() {
    function apply() {
      var parsed = parseCoordText($('coord-input').value);
      if (!parsed) {
        $('coord-input').setAttribute('aria-invalid', 'true');
        return;
      }
      $('coord-input').removeAttribute('aria-invalid');
      $('coord-input').value = '';
      setPin(state.activeSlot, parsed);
      map.setView([parsed.lat, parsed.lng], 15);
    }
    $('coord-apply').addEventListener('click', apply);
    $('coord-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') apply();
    });
  }

  // --- saved locations -------------------------------------------------------

  function renderSaved() {
    var ul = $('saved-list');
    ul.textContent = '';
    if (!state.saved.length) {
      var empty = document.createElement('li');
      empty.className = 'micro';
      empty.textContent = 'Nothing saved yet.';
      ul.appendChild(empty);
      return;
    }
    state.saved.forEach(function (loc) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = loc.label;
      li.appendChild(name);

      var use = document.createElement('button');
      use.textContent = 'Use';
      use.addEventListener('click', function () {
        setPin(state.activeSlot, { lat: loc.lat, lng: loc.lng, label: loc.label });
        map.setView([loc.lat, loc.lng], 15);
      });
      li.appendChild(use);

      var del = document.createElement('button');
      del.textContent = 'Delete';
      del.addEventListener('click', function () {
        state.saved = state.saved.filter(function (x) { return x.id !== loc.id; });
        storage.setSavedLocations(state.saved);
        renderSaved();
      });
      li.appendChild(del);

      ul.appendChild(li);
    });
  }

  function bindSave() {
    $('save-current').addEventListener('click', function () {
      var pin = state.pins[state.activeSlot];
      var label = ($('save-label').value || '').trim();
      if (!pin || !label) return;
      state.saved.push({ id: String(Date.now()), label: label, lat: pin.lat, lng: pin.lng });
      storage.setSavedLocations(state.saved);
      $('save-label').value = '';
      renderSaved();
    });
  }

  // --- recon -----------------------------------------------------------------

  function refreshCaptureCount() {
    storage.getCaptures().then(function (list) {
      var withPoints = list.filter(function (c) { return c.pointCount > 0; }).length;
      $('capture-count').textContent = list.length
        ? list.length + ' capture(s) stored, ' + withPoints + ' containing point lists.'
        : 'No captures stored.';
    });
  }

  function bindRecon() {
    $('capture-mode').addEventListener('change', function () {
      storage.setSettings({ captureMode: $('capture-mode').checked });
    });

    $('export').addEventListener('click', function () {
      storage.getCaptures().then(function (list) {
        var payload = {
          exportedAt: new Date().toISOString(),
          note: 'redBus Point Picker recon export. Check `discoveries` for scored ' +
                'candidate arrays and `shape` for the payload structure.',
          captures: list
        };
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'redbus-point-picker-captures.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      });
    });

    $('clear').addEventListener('click', function () {
      storage.clearCaptures().then(refreshCaptureCount);
    });
  }

  // --- boot ------------------------------------------------------------------

  function boot() {
    initMap();
    bindSlots();
    bindCoordInput();
    bindSave();
    bindRecon();

    Promise.all([storage.getPins(), storage.getSavedLocations(), storage.getSettings()])
      .then(function (vals) {
        state.pins = vals[0] || { origin: null, destination: null };
        state.saved = vals[1] || [];
        $('capture-mode').checked = !!(vals[2] && vals[2].captureMode);
        syncMarker('origin');
        syncMarker('destination');
        fitToPins();
        renderSlots();
        renderSaved();
        refreshCaptureCount();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
