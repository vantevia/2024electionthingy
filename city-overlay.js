    window.TIGERWEB_PLACES_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/';
    window.TIGERWEB_COUSUB_LAYER = 1;
    window.TIGERWEB_COUSUB_POP_LAYER = 22;
    window.__MCD_CODES = { CT: 1, MA: 1, ME: 1, NH: 1, RI: 1, VT: 1, NJ: 1, NY: 1, PA: 1, MI: 1, WI: 1, MN: 1 };
    window.__isMcdState = function (code) { return !!(window.__MCD_CODES && window.__MCD_CODES[code]) || !!(window.__stateTable && window.__stateTable.flagByCode(code, 'mcd')); };
    (function () {
      var listeners = [], cache = {}, pending = {}, source = {};
      var snap = { state: '', fp: '', labels: false, fill: true, outlines: false, showCDP: true, status: 'idle', message: '' };
      function emit() { listeners.slice().forEach(function (l) { l(); }); }
      function set(patch) { snap = Object.assign({}, snap, patch); emit(); }

      function clockwise(r) { var a = 0; for (var i = 0; i < r.length - 1; i++) a += (r[i + 1][0] - r[i][0]) * (r[i + 1][1] + r[i][1]); return a > 0; }
      function orient(ring, wantCW) { return clockwise(ring) === wantCW ? ring : ring.slice().reverse(); }

      function thin(ring, minPts) {
        var tol = 0.001, out = [], last = null, r = [];
        for (var i = 0; i < ring.length; i++) {
          var x = Math.round(ring[i][0] * 1e4) / 1e4, y = Math.round(ring[i][1] * 1e4) / 1e4;
          r.push([x, y]);
          if (!last || Math.abs(x - last[0]) >= tol || Math.abs(y - last[1]) >= tol || i === ring.length - 1) { last = [x, y]; out.push(last); }
        }
        var f = out[0], l = out[out.length - 1];
        if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1]]);
        if (out.length >= 4) return out;
        return minPts ? r : null;
      }
      function thinPoly(poly) {
        var rings = [orient(thin(poly[0], true), true)];
        for (var i = 1; i < poly.length; i++) { var h = thin(poly[i], false); if (h) rings.push(orient(h, false)); }
        return rings;
      }
      function processGeo(g, forceCdp, pops) {
        return g.features.filter(function (f) { return f.geometry && f.properties && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'); }).map(function (f) {
          var p = f.properties, geom = f.geometry;
          var geometry = geom.type === 'Polygon'
            ? { type: 'Polygon', coordinates: thinPoly(geom.coordinates) }
            : { type: 'MultiPolygon', coordinates: geom.coordinates.map(thinPoly) };
          var cdp = forceCdp !== null ? forceCdp : (p.LSAD === '57' || String(p.CLASSFP || '').charAt(0) === 'U');
          return {
            type: 'Feature', geometry: geometry,
            properties: {
              name: (function (n) { var c = n.replace(/\s*\(balance\)\s*$/i, '').replace(/[\s,]*\(?\b(consolidated|unified|metropolitan|metro)\s+government\)?/ig, '').replace(/\s+county\s*$/i, '').trim(); return c || n; })(String(p.BASENAME || p.NAME || '')), aland: Number(p.AREALAND != null ? p.AREALAND : p.ALAND) || 0, pop: (pops && pops[p.GEOID]) || Number(p.POP100 != null ? p.POP100 : p.POP2020) || 0, cdp: cdp, geoid: String(p.GEOID || ''),
              lon: parseFloat(p.INTPTLON), lat: parseFloat(p.INTPTLAT)
            }
          };
        });
      }
      function getJSON(url) {
        var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = ctl ? setTimeout(function () { ctl.abort(); }, 90000) : null;
        return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
          if (timer) clearTimeout(timer);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
      }
      function fetchTiger(code, kind) {
        var mcd = window.__isMcdState(code);
        if (mcd && kind === 'cdp') return Promise.resolve([]);
        var layer = mcd ? window.TIGERWEB_COUSUB_LAYER : (kind === 'cdp' ? 5 : 4);
        var where = "STATE='" + window.CITY_STATES[code][1] + "'" + (mcd ? " AND COUSUB<>'00000'" : '');
        var url = window.TIGERWEB_PLACES_URL + layer + '/query?where=' + encodeURIComponent(where)
          + '&outFields=' + encodeURIComponent('BASENAME,NAME,AREALAND,INTPTLAT,INTPTLON,GEOID')
          + '&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&geometryPrecision=4&f=geojson';
        return Promise.all([getJSON(url), fetchPops(code, kind)]).then(function (res) {
          var g = res[0];
          if (g.error) throw new Error((g.error.message || 'service error'));
          if (!g.features) throw new Error('no features in response');
          return processGeo(g, kind === 'cdp', res[1]);
        });
      }
      function fetchPops(code, kind) {
        var layer = window.__isMcdState(code) ? window.TIGERWEB_COUSUB_POP_LAYER : (kind === 'cdp' ? 26 : 25);
        var url = window.TIGERWEB_PLACES_URL + layer + '/query?where=' + encodeURIComponent("STATE='" + window.CITY_STATES[code][1] + "'")
          + '&outFields=' + encodeURIComponent('GEOID,POP100') + '&returnGeometry=false&f=json';
        return getJSON(url).then(function (g) {
          var m = {};
          (g.features || []).forEach(function (f) { if (f.attributes) m[f.attributes.GEOID] = Number(f.attributes.POP100) || 0; });
          return m;
        }).catch(function (e) { console.warn('[city boundaries] population lookup failed:', e); return null; });
      }
      function load(code, kind) {
        var key = code + ':' + kind;
        if (cache[key]) return Promise.resolve();
        if (pending[key]) return pending[key];
        var pr = fetchTiger(code, kind).then(function (f) { cache[key] = f; source[key] = 'Census TIGERweb'; });
        pending[key] = pr;
        var done = function () { delete pending[key]; };
        pr.then(done, done);
        return pr;
      }
      function summary(codes) {
        var n = 0, cdp = 0, src = '';
        codes.forEach(function (code) {
          n += (cache[code + ':inc'] || []).length;
          if (snap.showCDP && cache[code + ':cdp']) cdp += cache[code + ':cdp'].length;
          if (!src) src = source[code + ':inc'] || '';
        });
        var code0 = codes[0] || '';
        var msg = n.toLocaleString() + (window.__isMcdState(code0) ? ' towns and cities (' : ' places (') + src + ')';
        if (cdp) msg += ' + ' + cdp.toLocaleString() + ' CDPs';
        return msg;
      }
      function ensure() {
        var code = snap.state, fp = snap.fp || (code && window.CITY_STATES[code] ? window.CITY_STATES[code][1] : '');
        if (!code) { set({ status: 'idle', message: '' }); return; }
        var codes = window.__cityNeededCodes(fp);
        if (!codes.length) codes = [code];
        codes.forEach(function (c) { loadCityResults(c); });
        var kinds = snap.showCDP ? ['inc', 'cdp'] : ['inc'];
        var hasInc = codes.some(function (c) { return cache[c + ':inc']; });
        if (codes.every(function (c) { return kinds.every(function (k) { return cache[c + ':' + k]; }); })) { set({ status: 'ready', message: summary(codes) }); return; }
        if (!hasInc) set({ status: 'loading', message: 'Loading city boundaries from the Census Bureau...' });
        else set({ message: 'Loading unincorporated places...' });
        var jobs = [];
        codes.forEach(function (c) { kinds.forEach(function (k) { jobs.push(load(c, k)); }); });
        Promise.all(jobs).then(function () {
          if (snap.state === code && snap.fp === fp) set({ status: 'ready', message: summary(codes) });
        }).catch(function (e) {
          if (snap.state === code && snap.fp === fp) set({ status: (hasInc || codes.some(function (c) { return cache[c + ':inc']; })) ? 'ready' : 'error', message: 'Could not load boundaries (' + e.message + ').' });
        });
      }
      window.CITY_DATA_BASE_URL = 'https://raw.githubusercontent.com/vantevia/2024electionthingy/city/';
      window.__splitCsv = function (ln) { if (ln.indexOf('"') < 0) return ln.split(','); var out = [], cur = '', q = false; for (var ci = 0; ci < ln.length; ci++) { var ch = ln[ci]; if (ch === '"') { if (q && ln[ci + 1] === '"') { cur += '"'; ci++; } else q = !q; } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
      window.__csvFields = function (ln, want) {
        var maxI = want[want.length - 1], out = [], wi = 0, start = 0, col = 0;
        for (var i = 0; i < ln.length; i++) {
          var ch = ln[i];
          if (ch === '"' && col <= maxI) { var full = window.__splitCsv(ln); var r = []; for (var k = 0; k < want.length; k++) r.push(full[want[k]] || ''); return r; }
          if (ch === ',') {
            if (col === want[wi]) { out.push(ln.slice(start, i)); wi++; if (wi >= want.length) return out; }
            col++; start = i + 1;
          }
        }
        if (col === want[wi]) out.push(ln.slice(start));
        while (out.length < want.length) out.push('');
        return out;
      };
      window.__latestCensusKey = function (ds) { return Object.keys(ds).filter(function (k) { return /^T_\d+_CENS$/.test(k); }).sort().reverse()[0]; };
window.__latestVapKey = function (ds) { return Object.keys(ds).filter(function (k) { return /^V_\d+_VAP$/.test(k); }).sort().reverse()[0]; };
      window.__parseDRAHeaders = function (hdr) {
        var cols = [], cens = [];
        hdr.forEach(function (h, i) {
          var m = /^(E_.+)_(Total|Dem|Rep)$/.exec(h); if (m) { cols.push([i, m[1], m[2]]); return; }
          var x = /^X_24_Copy_of_2024_presidential_(D|R|Tot)$/.exec(h); if (x) { cols.push([i, 'E_24_PRES', x[1] === 'D' ? 'Dem' : x[1] === 'R' ? 'Rep' : 'Total']); return; }
          var cp = /^X_\d+_Copy_of_(Senator|Senate|Governor|President|Congress|House|Attorney_General|Secretary_of_State|Treasurer|Auditor|Lieutenant_Governor|Lt_Governor|Comptroller|Superintendent|Corporation_Commissioner|Insurance_Commissioner|Labor_Commissioner)_(\d+)_(D|R|Tot)$/.exec(h); if (cp) { var off = { Senator: 'SEN', Senate: 'SEN', Governor: 'GOV', President: 'PRES', Congress: 'CONG', House: 'CONG', Attorney_General: 'AG', Secretary_of_State: 'SOS', Treasurer: 'TREAS', Auditor: 'AUD', Lieutenant_Governor: 'LTG', Lt_Governor: 'LTG', Comptroller: 'CMPTR', Superintendent: 'SUPT', Corporation_Commissioner: 'CORP', Insurance_Commissioner: 'INS', Labor_Commissioner: 'LAB' }; cols.push([i, 'E_' + String(cp[2]).slice(2) + '_' + off[cp[1]], cp[3] === 'D' ? 'Dem' : cp[3] === 'R' ? 'Rep' : 'Total']); return; }
          var tc = /^(T_\d+_CENS)_(Total|White|Hispanic|Black|Asian|Native|Pacific)$/.exec(h); if (tc) { cens.push([i, tc[1], tc[2]]); }
        });
        return { cols: cols, cens: cens };
      };
      var cityRes = {}, cityResLoading = {}, cityResLoaded = {};
      window.getCityResult = function (g) { if (!g) return null; var k = String(g).padStart(7, '0'); if (cityRes[k]) return cityRes[k]; if (k.length > 7) { var nk = k.slice(0, 2) + k.slice(-5); if (cityRes[nk]) return cityRes[nk]; } return null; };
      function loadCityResults(code) {
        if (!code || cityResLoading[code] || cityResLoaded[code]) return;
        cityResLoading[code] = true;
        var url = (window.CITY_DATA_URLS && window.CITY_DATA_URLS[code]) || (window.CITY_DATA_BASE_URL + code.toLowerCase() + 'city.zip');
        var parseText = function (text) {
          var lines = text.split(/\r?\n/);
          var hdr = window.__splitCsv(lines[0]), _ph = window.__parseDRAHeaders(hdr), cols = _ph.cols, cens = _ph.cens;
          var n = 0;
          for (var li = 1; li < lines.length; li++) { if (!lines[li]) continue; var cells = window.__splitCsv(lines[li]); var gid = String(cells[0] || '').trim(); if (!/^\d+$/.test(gid)) continue; gid = gid.padStart(7, '0');
            var ds = {};
            cols.forEach(function (c) { (ds[c[1]] || (ds[c[1]] = {}))[c[2]] = Number(cells[c[0]]) || 0; });
            cens.forEach(function (c) { (ds[c[1]] || (ds[c[1]] = {}))[c[2]] = Number(cells[c[0]]) || 0; });
            var ck = window.__latestCensusKey(ds);
            var cs = ck ? ds[ck] : {};
            var e = ds['E_24_PRES'] || {};
            var rep = Number(e.Rep) || 0, dem = Number(e.Dem) || 0, tot = Math.max(Number(e.Total) || 0, rep + dem);
            var _row = { '2024R': rep, '2024D': dem, '2024O': Math.max(0, tot - rep - dem), '2024TOT': tot,
              '2020POP': Number(cs.Total) || 0, White20: Number(cs.White) || 0, Hispanic20: Number(cs.Hispanic) || 0,
              Black20: Number(cs.Black) || 0, Asian20: Number(cs.Asian) || 0, Native20: Number(cs.Native) || 0, Pacific20: Number(cs.Pacific) || 0,
              datasets: ds };
            cityRes[gid] = _row;
            if (gid.length > 7) { var _nk = gid.slice(0, 2) + gid.slice(-5); if (_nk !== gid) cityRes[_nk] = _row; }
            n++;
          }
          return n;
        };
        var done = function (n) {
          delete cityResLoading[code];
          cityResLoaded[code] = true;
          window.__plog && window.__plog('city results loaded', code, 'rows=' + n);
          snap = Object.assign({}, snap, { resultsLoaded: Date.now() });
          emit();
        };
        var fail = function (e) { delete cityResLoading[code]; console.warn('[city results] failed to load ' + code + ':', e); };
        var fetchBuf = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }); };
        var toText = function (buf) { var u8 = new Uint8Array(buf); if (u8[0] === 0x50 && u8[1] === 0x4B) { if (!window.fflate) throw new Error('zip support not loaded'); var cf = window.fflate.unzipSync(u8, { filter: function (e) { return /\.csv$/i.test(e.name); } }); return window.fflate.strFromU8(cf[Object.keys(cf)[0]]); } return window.fflate ? window.fflate.strFromU8(u8) : new TextDecoder().decode(u8); };
        fetchBuf(url)
          .then(function (buf) { done(parseText(toText(buf))); })
          .catch(fail);
      }
      window.getCityBoundaries = function (code, includeCDP) {
        var inc = cache[code + ':inc'];
        if (!inc) return null;
        var cdp = includeCDP ? cache[code + ':cdp'] : null;
        return cdp ? inc.concat(cdp) : inc;
      };
      window.__cityNeededCodes = function (fp) {
        if (!fp) return [];
        var ctx = window.__peCtx, ov = (ctx && ctx.overrides) || {}, feats = (ctx && ctx.features) || [], out = {};
        for (var i = 0; i < feats.length; i++) {
          var f = feats[i], g = String(f.properties.GEOID || '');
          var now = window.__effCountyFp ? window.__effCountyFp(g, ov) : f.properties.STATEFP;
          if (String(now) !== String(fp)) continue;
          for (var c2 in window.CITY_STATES) if (String(window.CITY_STATES[c2][1]) === String(f.properties.STATEFP)) { out[c2] = 1; break; }
        }
        return Object.keys(out);
      };
      window.getCityBoundariesFor = function (fp, includeCDP) {
        var codes = window.__cityNeededCodes(fp), out = [];
        codes.forEach(function (c) { var b = window.getCityBoundaries(c, includeCDP); if (b) out = out.concat(b); });
        return out.length ? out : null;
      };
      window.__pointInPoly = function (pt, geom) {
        function inRing(x, y, ring) {
          var inside = false;
          for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
          }
          return inside;
        }
        function inPoly(x, y, poly) {
          if (!inRing(x, y, poly[0])) return false;
          for (var h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) return false;
          return true;
        }
        if (!geom) return false;
        var polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : null;
        if (!polys) return false;
        for (var k = 0; k < polys.length; k++) if (inPoly(pt[0], pt[1], polys[k])) return true;
        return false;
      };
      window.__planarBounds = function (g) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        function visit(c) { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; }
        function walk(a) { if (!a) return; if (typeof a[0] === 'number') visit(a); else a.forEach(walk); }
        var geom = g && g.type === 'Feature' ? g.geometry : g;
        if (geom) walk(geom.coordinates);
        return [[x0, y0], [x1, y1]];
      };
      var _cityHomeCache = new WeakMap();
      window.__cityHomeCounty = function (f) {
        if (!f || !f.geometry || !f.properties) return null;
        var ovTag = (window.PrecinctEdit && window.PrecinctEdit.ovTag) || 0;
        var hit = _cityHomeCache.get(f);
        if (hit && hit.ovTag === ovTag) return hit.county;
        var county = null;
        try {
          var d3g = window.d3; if (!d3g) return null;
          var ctx = window.__peCtx, feats = (ctx && ctx.features) || [];
          if (!feats.length) return null;
          var p = f.properties, pt = (isFinite(p.lon) && isFinite(p.lat)) ? [p.lon, p.lat] : d3g.geoCentroid(f);
          var bb = (window.__countyBoundsCache = window.__countyBoundsCache || new WeakMap());
          for (var i = 0; i < feats.length; i++) {
            var cf = feats[i]; if (!cf || !cf.geometry) continue;
            var b = bb.get(cf);
            if (!b) { b = window.__planarBounds(window.__fixGeo ? window.__fixGeo(cf) : cf); bb.set(cf, b); }
            var w = b[0][0], s = b[0][1], e = b[1][0], n = b[1][1], x = pt[0], y = pt[1];
            if (y < s || y > n) continue;
            if (w <= e ? (x < w || x > e) : (x < w && x > e)) continue;
            var gg = window.__fixGeo ? window.__fixGeo(cf) : cf;
            if (window.__pointInPoly(pt, gg.geometry || gg)) { county = cf; break; }
          }
        } catch (err) { county = null; }
        _cityHomeCache.set(f, { ovTag: ovTag, county: county });
        return county;
      };
      window.__cityVisible = function (f, fp, disC, disS, el) {
        if (!f) return false;
        var home = window.__cityHomeCounty(f);
        if (!home) return true;
        var ov = (window.__peCtx && window.__peCtx.overrides) || {};
        var cg = String(home.properties.GEOID || '');
        var eff = window.__effCountyFp ? String(window.__effCountyFp(cg, ov)) : String(home.properties.STATEFP || '');
        if (String(eff) !== String(fp)) return false;
        if (disC && disC.has(cg)) return false;
        if (disS && disS.has(eff)) return false;
        return 'full';
      };
      window.setCityOverlay = function (patch) {
        if (patch.state !== undefined && patch.fp === undefined) {
          patch = Object.assign({}, patch, { fp: patch.state && window.CITY_STATES[patch.state] ? window.CITY_STATES[patch.state][1] : '' });
        }
        snap = Object.assign({}, snap, patch);
        if (patch.state) loadCityResults(patch.state);
        if (patch.state !== undefined || patch.showCDP !== undefined) ensure(); else emit();
      };
      var lastCityState = '';
      window.getCityOverlayState = function () { return snap.state; };
      window.getCityOverlayFp = function () { return snap.fp; };
      window.toggleCityBoundaries = function (fips, countyGeoid) {
        var code = null;
        if (fips) for (var c in window.CITY_STATES) if (window.CITY_STATES[c][1] === String(fips)) { code = c; break; }
        code = code || lastCityState;
        if (!code) return;
        var fp = String(fips || (window.CITY_STATES[code] && window.CITY_STATES[code][1]) || '');
        if (countyGeoid && window.__effCountyFp) {
          var ov = (window.__peCtx && window.__peCtx.overrides) || {};
          fp = String(window.__effCountyFp(String(countyGeoid), ov) || fp);
        }
        if (snap.state) { if (snap.fp !== fp) window.setCityOverlay({ state: code, fp: fp }); return; }
        window.setCityOverlay({ state: code, fp: fp });
      };
      window.__cityProcess = processGeo;
      window.useCityOverlay = function () {
        return React.useSyncExternalStore(
          function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (l) { return l !== cb; }); }; },
          function () { return snap; }
        );
      };
    })();
