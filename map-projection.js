// ===== MAP PROJECTION SETTING =====
// Options: 'albersUsa' (default, AK/HI insets), 'albers', 'mercator',
//          'equalEarth', 'conformalConic', 'equirectangular', 'orthographic'
window.MAP_PROJECTION = 'albersUsa';
window.MAP_PROJECTION_OPTIONS = [
  ['albersUsa', 'Albers USA (AK/HI insets)'],
  ['albers', 'Albers (true positions)'],
  ['mercator', 'Mercator'],
  ['equalEarth', 'Equal Earth'],
  ['conformalConic', 'Lambert Conformal Conic'],
  ['equirectangular', 'Equirectangular'],
  ['orthographic', 'Orthographic (globe)']
];

// Tiny store so the Settings dropdown can change the projection live.
(function () {
  var listeners = [];
  try {
    var saved = localStorage.getItem('mapProjection');
    if (saved && window.MAP_PROJECTION_OPTIONS.some(function (o) { return o[0] === saved; })) window.MAP_PROJECTION = saved;
  } catch (e) {}
  window.setMapProjection = function (name) {
    window.MAP_PROJECTION = name;
    try { localStorage.setItem('mapProjection', name); } catch (e) {}
    listeners.slice().forEach(function (l) { l(); });
  };
  window.useMapProjection = function () {
    return React.useSyncExternalStore(
      function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (l) { return l !== cb; }); }; },
      function () { return window.MAP_PROJECTION; }
    );
  };
})();

// Builds the chosen projection. Pass [w, h] + a GeoJSON object to auto-fit,
// or omit them to use the hand-tuned scale/center for the main map.
window.makeProjection = function (size, fitTo) {
  var w = 975, h = 610;
  var c = [w / 2, h / 2];
  var makers = {
    albersUsa: function () { return d3.geoAlbersUsa().scale(1300).translate(c); },
    albers: function () { return d3.geoAlbers().scale(1300).translate(c); },
    mercator: function () { return d3.geoMercator().center([-96, 38]).scale(1000).translate(c); },
    equalEarth: function () { return d3.geoEqualEarth().center([-96, 38]).scale(1000).translate(c); },
    conformalConic: function () { return d3.geoConicConformal().parallels([33, 45]).rotate([96, 0]).center([0, 38]).scale(1300).translate(c); },
    equirectangular: function () { return d3.geoEquirectangular().center([-96, 38]).scale(900).translate(c); },
    orthographic: function () { return d3.geoOrthographic().rotate([96, -38]).scale(1000).translate(c).clipAngle(90); }
  };
  var base = {
    albersUsa: d3.geoAlbersUsa, albers: d3.geoAlbers, mercator: d3.geoMercator,
    equalEarth: d3.geoEqualEarth, conformalConic: function () { return d3.geoConicConformal().parallels([33, 45]).rotate([96, 0]); },
    equirectangular: d3.geoEquirectangular, orthographic: function () { return d3.geoOrthographic().rotate([96, -38]).clipAngle(90); }
  };
  var name = makers[window.MAP_PROJECTION] ? window.MAP_PROJECTION : 'albersUsa';
  if (size && fitTo) return base[name]().fitSize(size, fitTo);
  return makers[name]();
};