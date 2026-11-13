/* Lign: one canvas behind the page. A ray tracer for the flacon, a fluid solver for the smoke,
   and scroll as the director. No libraries. */
(function () {
  'use strict';

  /* ------------------------------------------------------------ query */
  var Q = new URLSearchParams(location.search);
  function qnum(k) { if (!Q.has(k)) return null; var v = parseFloat(Q.get(k)); return isFinite(v) ? v : null; }
  var qS = qnum('s'), qT = qnum('t'), qV = (Q.get('view') || '').toLowerCase();
  var VIEWS = { hero: 0, wood: 1, chip: 1, forests: 2, batch: 3, label: 3, notes: 4, thread: 4, sizes: 5, footer: 6 };
  var frozen = qT !== null;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* ------------------------------------------------------------ small maths */
  var DEG = Math.PI / 180;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function mix(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function mixv(a, b, t) { var o = []; for (var i = 0; i < a.length; i++) o.push(mix(a[i], b[i], t)); return o; }
  function rnd(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  /* ------------------------------------------------------------ GL */
  var canvas = document.getElementById('gl');
  var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) { document.documentElement.classList.add('nogl'); window.__ready = true; return; }
  var hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  gl.getExtension('OES_texture_float_linear');

  function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  /* programs are compiled off the main thread where the browser allows it, so the page stays alive meanwhile */
  var par = gl.getExtension('KHR_parallel_shader_compile');
  var PNAMES = ['scene', 'bright', 'blur', 'final', 'curl', 'vel', 'div', 'jac', 'grad', 'den'];
  var tCompile = performance.now(), compileMs = 0, P = {};
  PNAMES.forEach(function (k) {
    var p = gl.createProgram(), v = compile(gl.VERTEX_SHADER, SH.vs), f = compile(gl.FRAGMENT_SHADER, SH[k]);
    gl.attachShader(p, v); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    P[k] = { p: p, v: v, f: f, u: {} };
  });
  function programsDone() {
    if (!par) return true;
    for (var i = 0; i < PNAMES.length; i++) if (!gl.getProgramParameter(P[PNAMES[i]].p, par.COMPLETION_STATUS_KHR)) return false;
    return true;
  }
  function programsFinish() {
    for (var j = 0; j < PNAMES.length; j++) {
      var o = P[PNAMES[j]], p = o.p;
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('[lign] shader ' + PNAMES[j] + ': ' + gl.getShaderInfoLog(o.f) + ' | ' + gl.getShaderInfoLog(o.v) + ' | ' + gl.getProgramInfoLog(p));
        return false;
      }
      var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var a = gl.getActiveUniform(p, i); o.u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
    }
    compileMs = performance.now() - tCompile;
    return true;
  }

  var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  var vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  function tri() { gl.drawArrays(gl.TRIANGLES, 0, 3); }

  function target(w, h, ifmt, fmt, type, filter) {
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex: tex, fbo: fbo, w: w, h: h };
  }
  function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }
  function bindTex(unit, tex, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); }
  function into(t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null); if (t) gl.viewport(0, 0, t.w, t.h); }

  /* ------------------------------------------------------------ type drawn into textures */
  var FONT_D = '"Bodoni Moda","Bodoni 72","Didot","Bodoni MT",Georgia,serif';
  var FONT_S = 'Jost,"Century Gothic","Avenir Next",Futura,"Segoe UI",sans-serif';
  var WORDS = ['Lign', 'Resin', 'Forest', '07', 'Hours', 'Tola'];
  var words = [], labelTex = null;

  function bytesTex(old, w, h, ifmt, fmt, bytes) {
    var t = old || gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  }
  function buildWord(str, old) {
    var TW = 2048, pad = 70;
    var c = document.createElement('canvas'); c.width = TW; c.height = 64;
    var x = c.getContext('2d'), fs = 400;
    x.font = '500 ' + fs + 'px ' + FONT_D;
    var m = x.measureText(str);
    fs *= (TW - 2 * pad) / Math.max(10, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
    x.font = '500 ' + fs + 'px ' + FONT_D; m = x.measureText(str);
    var asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
    var TH = Math.min(2048, Math.ceil(asc + desc + 2 * pad)); c.height = TH; x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, TW, TH);
    x.fillStyle = '#fff'; x.font = '500 ' + fs + 'px ' + FONT_D; x.textBaseline = 'alphabetic';
    x.fillText(str, pad + m.actualBoundingBoxLeft, pad + asc);
    var d = x.getImageData(0, 0, TW, TH).data, out = new Uint8Array(TW * TH);
    for (var y = 0; y < TH; y++) { var ro = (TH - 1 - y) * TW, so = y * TW * 4; for (var i = 0; i < TW; i++) out[ro + i] = d[so + i * 4]; }
    return { tex: bytesTex(old, TW, TH, gl.R8, gl.RED, out), asp: TH / TW };
  }
  function spaced(x, str, cx, y, track) {
    if ('letterSpacing' in x) { x.letterSpacing = track + 'px'; x.textAlign = 'center'; x.fillText(str, cx + track / 2, y); x.letterSpacing = '0px'; return; }
    var w = 0, i; for (i = 0; i < str.length; i++) w += x.measureText(str[i]).width + track; w -= track;
    var px = cx - w / 2; x.textAlign = 'left';
    for (i = 0; i < str.length; i++) { x.fillText(str[i], px, y); px += x.measureText(str[i]).width + track; }
    x.textAlign = 'center';
  }
  function buildLabel(old) {
    var W = 1024, H = 1074, c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'), r = rnd(7), i;
    x.fillStyle = '#e9dec7'; x.fillRect(0, 0, W, H);
    for (i = 0; i < 900; i++) { x.fillStyle = 'rgba(' + (r() < .5 ? '120,92,52' : '255,250,236') + ',' + (0.02 + r() * 0.035) + ')'; var s = 4 + r() * 46; x.beginPath(); x.ellipse(r() * W, r() * H, s, s * (.4 + r() * .6), r() * 3.14, 0, 6.2832); x.fill(); }
    var ink = '#1c130d', red = '#b33a1a';
    x.strokeStyle = ink; x.lineWidth = 4; x.strokeRect(44, 44, W - 88, H - 88);
    x.lineWidth = 1.5; x.strokeRect(60, 60, W - 120, H - 120);
    x.fillStyle = ink; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    function big(str, cx, y, px, style, track) { var k = px / 26; x.save(); x.scale(k, k); x.font = style + ' 26px ' + FONT_D; spaced(x, str, cx / k, y / k, track / k); x.restore(); }
    big('LIGN', W / 2, 372, 226, '600', 34);
    x.font = '400 40px ' + FONT_S; spaced(x, 'DEHN AL OUD', W / 2, 468, 17);
    x.fillRect(W / 2 - 150, 536, 300, 2);
    x.fillStyle = red; x.beginPath(); x.arc(W / 2, 537, 9, 0, 6.2832); x.fill();
    x.fillStyle = ink;
    var kk = 78 / 26; x.save(); x.scale(kk, kk); x.font = 'italic 500 26px ' + FONT_D;
    var a = 'Batch ', b = 'Nº 07', wa = x.measureText(a).width, wb = x.measureText(b).width, x0 = W / 2 / kk - (wa + wb) / 2;
    x.textAlign = 'left'; x.fillText(a, x0, 668 / kk); x.fillStyle = red; x.fillText(b, x0 + wa, 668 / kk); x.restore();
    x.fillStyle = ink; x.textAlign = 'center';
    x.font = '400 36px ' + FONT_S; spaced(x, '12 ML  ·  ONE TOLA', W / 2, 772, 11);
    x.fillRect(W / 2 - 40, 836, 80, 1.5);
    x.font = '400 28px ' + FONT_S; spaced(x, 'NAHOR BARI  ·  2026', W / 2, 908, 9);
    x.font = 'italic 400 30px ' + FONT_D; x.fillText('No. 041 of 200', W / 2, 972);
    var d = x.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H * 4);
    for (var y = 0; y < H; y++) for (i = 0; i < W; i++) {
      var so = (y * W + i) * 4, dd = ((H - 1 - y) * W + i) * 4;
      var l = (d[so] * .3 + d[so + 1] * .59 + d[so + 2] * .11) / 255;
      out[dd] = d[so]; out[dd + 1] = d[so + 1]; out[dd + 2] = d[so + 2]; out[dd + 3] = Math.round(255 * sstep(.2, .72, l));
    }
    return bytesTex(old, W, H, gl.RGBA8, gl.RGBA, out);
  }
  function buildType() {
    for (var i = 0; i < WORDS.length; i++) words[i] = buildWord(WORDS[i], words[i] && words[i].tex);
    labelTex = buildLabel(labelTex);
  }

  /* ------------------------------------------------------------ the shots, one per section */
  var CHIP_D = { pos: [2.75, 0, 0.95], ang: -0.30 }, CHIP_M = { pos: [1.85, 0, 1.25], ang: -0.22 };
  var POSES = [
    { name: 'hero', T: [0.95, 2.15, 0], D: 16.5, yaw: 0, pitch: 3, fov: 28, sh: [0, 0.02], by: -0.44, lift: 0, sm: 1,
      word: 0, wc: [0.0, 0.23], ww: 0.56, lod: 0.2, pool: [-0.10, 0.16, 1.2, 1.22], boost: 1.4,
      m: { T: [0.45, 2.1, 0], D: 22, sh: [0, -0.42], wc: [0, 0.6], ww: 0.94, pool: [0, 0.5, 1.0, 1.5] } },
    { name: 'wood', rel: 1, T: [0.15, 0.52, 0], D: 4.4, yaw: -0.72, pitch: 9, fov: 30, sh: [0.55, -0.12], by: 0.2, lift: 0, sm: 1,
      word: 1, wc: [-0.35, 0.5], ww: 0.5, lod: 1.2, pool: [-0.45, 0.35, 0.85, 1.6], boost: 1.4,
      m: { T: [0, 0.55, 0], D: 6.2, yaw: -0.6, sh: [0.06, -0.5], wc: [0, 0.74], ww: 1.0, pool: [0, 0.6, 0.8, 2.2] } },
    { name: 'forests', T: [0.6, 2.0, 0], D: 17, yaw: 0.42, pitch: 8, fov: 28, sh: [-0.62, 0], by: 1.04, lift: 0, sm: 1,
      word: 2, wc: [0.40, 0.42], ww: 0.42, lod: 0.3, pool: [0.36, 0.3, 1.0, 1.2], boost: 1.4,
      m: { T: [0.45, 2.1, 0], D: 25, yaw: 0.3, sh: [0, -0.53], wc: [0, 0.72], ww: 0.94, pool: [0, 0.6, 1.0, 1.6] } },
    { name: 'batch', T: [0, 1.66, 0], D: 9.6, yaw: -0.3, pitch: 4, fov: 26, sh: [-0.62, 0], by: -0.2, lift: 0, sm: 0.6,
      word: 3, wc: [0.40, 0.22], ww: 0.34, lod: 1.0, pool: [0.36, 0.2, 0.95, 2.1], boost: 1.4,
      m: { T: [0, 1.55, 0], D: 13.5, yaw: -0.25, sh: [0, -0.5], wc: [0, 0.7], ww: 0.8, pool: [0, 0.55, 1.0, 1.8] } },
    { name: 'notes', T: [0.9, 3.3, 0], D: 15.5, yaw: -0.12, pitch: 5, fov: 28, sh: [0.55, 0], by: -0.74, lift: 2.3, sm: 1,
      word: 4, wc: [-0.42, 0.5], ww: 0.42, lod: 0.3, pool: [-0.45, 0.35, 1.0, 1.2], boost: 1.4,
      m: { T: [0.45, 2.95, 0], D: 25.5, lift: 1.5, sh: [0, -0.46], wc: [0, 0.7], ww: 1.0, pool: [0, 0.55, 1.0, 1.6] } },
    { name: 'sizes', T: [0.9, 1.3, 0], D: 15, yaw: 0.25, pitch: 22, fov: 28, sh: [-0.6, 0.05], by: 0.55, lift: 0, sm: 1,
      word: 5, wc: [0.38, 0.72], ww: 0.36, lod: 0.3, pool: [0.4, 0.6, 1.0, 1.3], boost: 1.4,
      m: { T: [0.45, 1.4, 0], D: 22, pitch: 20, sh: [0, -0.44], wc: [0, 0.8], ww: 0.9, pool: [0, 0.7, 1.0, 1.6] } },
    { name: 'footer', T: [0.9, 2.4, 0], D: 21, yaw: 0, pitch: 5, fov: 28, sh: [0, -0.22], by: 0.15, lift: 0, sm: 1,
      word: 0, wc: [0, 0.5], ww: 0.5, lod: 0.2, pool: [-0.05, 0.4, 1.0, 1.0], boost: 1.4,
      m: { T: [0.45, 2.3, 0], D: 25, sh: [0, -0.34], wc: [0, 0.6], ww: 0.92, pool: [0, 0.5, 1.0, 1.6] } }
  ];
  var NS = POSES.length, HOLDV = 0.7;
  var W = 1, H = 1, aspect = 1, mobile = false, dpr = 1, chip = CHIP_D, ember = [0, 0, 0];
  var secs = [], stages = [], secTop = [], maxScroll = 1, L = [];
  var SMW = 4.2, SMH = 6.3, SRC = [0.5, 0.035];

  function makeCam(p, dyaw, dpitch) {
    var yaw = p.yaw + dyaw, pit = (p.pitch + dpitch) * DEG, cp = Math.cos(pit);
    var pos = [p.T[0] + p.D * Math.sin(yaw) * cp, p.T[1] + p.D * Math.sin(pit), p.T[2] + p.D * Math.cos(yaw) * cp];
    var f = norm(sub(p.T, pos)), r = norm([-f[2], 0, f[0]]), u = cross(r, f);
    return { pos: pos, r: r, u: u, f: f, tan: Math.tan(p.fov * DEG / 2), sh: p.sh };
  }
  function rayOf(cam, nx, ny) {
    var a = (nx + cam.sh[0]) * cam.tan, b = (ny + cam.sh[1]) * cam.tan;
    return norm([cam.r[0] * a + cam.u[0] * b + cam.f[0], cam.r[1] * a + cam.u[1] * b + cam.f[1], cam.r[2] * a + cam.u[2] * b + cam.f[2]]);
  }
  function toWall(cam, nx, ny) {
    var d = rayOf(cam, nx, ny), dz = Math.min(d[2], -0.05), t = (-7 - cam.pos[2]) / dz;
    return [cam.pos[0] + d[0] * t, cam.pos[1] + d[1] * t, -7];
  }
  function project(cam, p) {
    var v = sub(p, cam.pos), z = Math.max(dot(v, cam.f), 1e-3);
    return [dot(v, cam.r) / z / cam.tan - cam.sh[0], dot(v, cam.u) / z / cam.tan - cam.sh[1]];
  }
  function chipToWorld(l) {
    var c = Math.cos(chip.ang), s = Math.sin(chip.ang);
    return [chip.pos[0] + c * l[0] + s * l[2], chip.pos[1] + l[1], chip.pos[2] - s * l[0] + c * l[2]];
  }
  function resolve() {
    mobile = aspect < 0.8;
    chip = mobile ? CHIP_M : CHIP_D;
    ember = chipToWorld([0.74, 0.46, 0]);
    L = POSES.map(function (p) {
      var o = {}, k;
      for (k in p) if (k !== 'm') o[k] = p[k];
      if (mobile && p.m) for (k in p.m) o[k] = p.m[k];
      o.T = o.rel ? [chip.pos[0] + o.T[0], o.T[1], chip.pos[2] + o.T[2]] : o.T.slice();
      o.sh = [o.sh[0] * (mobile ? 1 : Math.min(1, aspect / 1.7778)), o.sh[1]];
      var cam = makeCam(o, 0, 0);
      var c = toWall(cam, o.wc[0] * aspect, o.wc[1]);
      var dist = Math.max(1, dot(sub(c, cam.pos), cam.f));
      var hw = o.ww * aspect * cam.tan * dist;
      o.rect = [c[0], c[1], hw, hw * (words[o.word] ? words[o.word].asp : 0.4)];
      o.wpx = hw / (dist * cam.tan);
      var pc = toWall(cam, o.pool[0] * aspect, o.pool[1]);
      o.poolW = [pc[0], pc[1], o.pool[2], o.pool[3]];
      return o;
    });
  }

  /* ------------------------------------------------------------ render targets, adaptive resolution */
  var RT = null, scale = 1;
  function allocRT() {
    if (RT) { ['scene', 'b1a', 'b1b', 'b2a', 'b2b'].forEach(function (k) { freeTarget(RT[k]); }); }
    var w = Math.max(8, Math.round(canvas.width * scale)), h = Math.max(8, Math.round(canvas.height * scale));
    var IF = hdr ? gl.RGBA16F : gl.RGBA8, TY = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    var w4 = Math.max(2, w >> 2), h4 = Math.max(2, h >> 2), w8 = Math.max(2, w >> 3), h8 = Math.max(2, h >> 3);
    RT = { w: w, h: h, scene: target(w, h, IF, gl.RGBA, TY, gl.LINEAR),
      b1a: target(w4, h4, IF, gl.RGBA, TY, gl.LINEAR), b1b: target(w4, h4, IF, gl.RGBA, TY, gl.LINEAR),
      b2a: target(w8, h8, IF, gl.RGBA, TY, gl.LINEAR), b2b: target(w8, h8, IF, gl.RGBA, TY, gl.LINEAR) };
  }
  function measure() {
    W = window.innerWidth; H = window.innerHeight; aspect = W / H;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = Math.round(W * dpr), ch = Math.round(H * dpr), changed = false;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw; canvas.height = ch; changed = true;
      var px = cw * ch; scale = px > 2.6e6 ? clamp(Math.sqrt(2.6e6 / px), 0.5, 1) : 1;
    }
    secs = Array.prototype.slice.call(document.querySelectorAll('.sec'));
    stages = secs.map(function (s) { return s.querySelector('.stage'); });
    secTop = secs.map(function (s) { return s.offsetTop; });
    maxScroll = Math.max(1, document.documentElement.scrollHeight - H);
    resolve();
    if (changed || !RT) allocRT();
  }

  /* ------------------------------------------------------------ smoke */
  var small = Math.min(window.innerWidth, window.innerHeight) < 600;
  var SW = small ? 256 : 512, SHt = small ? 384 : 768, simT = 0, sim = null;
  if (hdr) {
    sim = {
      vel: [target(SW, SHt, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR), target(SW, SHt, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR)],
      den: [target(SW, SHt, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR), target(SW, SHt, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR)],
      prs: [target(SW, SHt, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST), target(SW, SHt, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST)],
      dvg: target(SW, SHt, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST),
      crl: target(SW, SHt, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST)
    };
  }
  var simIn = { ptr: [0.5, 0.5, 0, 0], on: 0, draft: 0, burst: 0 };
  function simStep() {
    if (!sim) return;
    var dt = 1 / 60, px = 1 / SW, py = 1 / SHt, u, t;
    simT += dt;
    gl.useProgram(P.curl.p); u = P.curl.u; gl.uniform2f(u.uPx, px, py); bindTex(0, sim.vel[0].tex, u.uVel); into(sim.crl); tri();
    gl.useProgram(P.vel.p); u = P.vel.u; gl.uniform2f(u.uPx, px, py); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uTime, simT);
    gl.uniform4fv(u.uPtr, simIn.ptr); gl.uniform1f(u.uPtrOn, simIn.on); gl.uniform1f(u.uDraft, simIn.draft);
    gl.uniform2f(u.uSrc, SRC[0], SRC[1]); gl.uniform1f(u.uBurst, simIn.burst);
    bindTex(0, sim.vel[0].tex, u.uVel); bindTex(1, sim.den[0].tex, u.uDen); bindTex(2, sim.crl.tex, u.uCurl);
    into(sim.vel[1]); tri(); t = sim.vel[0]; sim.vel[0] = sim.vel[1]; sim.vel[1] = t;
    gl.useProgram(P.div.p); u = P.div.u; gl.uniform2f(u.uPx, px, py); bindTex(0, sim.vel[0].tex, u.uVel); into(sim.dvg); tri();
    gl.useProgram(P.jac.p); u = P.jac.u; gl.uniform2f(u.uPx, px, py); bindTex(1, sim.dvg.tex, u.uDiv);
    for (var i = 0; i < 20; i++) { bindTex(0, sim.prs[0].tex, u.uP); into(sim.prs[1]); tri(); t = sim.prs[0]; sim.prs[0] = sim.prs[1]; sim.prs[1] = t; }
    gl.useProgram(P.grad.p); u = P.grad.u; gl.uniform2f(u.uPx, px, py); bindTex(0, sim.prs[0].tex, u.uP); bindTex(1, sim.vel[0].tex, u.uVel);
    into(sim.vel[1]); tri(); t = sim.vel[0]; sim.vel[0] = sim.vel[1]; sim.vel[1] = t;
    gl.useProgram(P.den.p); u = P.den.u; gl.uniform2f(u.uPx, px, py); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uTime, simT);
    gl.uniform2f(u.uSrc, SRC[0], SRC[1]); gl.uniform1f(u.uBurst, simIn.burst);
    bindTex(0, sim.vel[0].tex, u.uVel); bindTex(1, sim.den[0].tex, u.uDen);
    into(sim.den[1]); tri(); t = sim.den[0]; sim.den[0] = sim.den[1]; sim.den[1] = t;
  }

  /* ------------------------------------------------------------ input */
  var ptr = { x: 0, y: 0, last: -1e9, down: false, sx: 0, sy: 0, moved: 0, dx: 0 };
  var sp = { x: 0, y: 0 }, drag = { yaw: 0, vel: 0 }, burst = 0;
  function interactive(el) { return el && el.closest && el.closest('a,button'); }
  window.addEventListener('pointermove', function (e) {
    var nx = e.clientX / W * 2 - 1, ny = 1 - e.clientY / H * 2;
    if (ptr.down) { var dx = e.clientX - ptr.sx; ptr.sx = e.clientX; ptr.moved += Math.abs(dx); drag.vel += dx * 0.0045; }
    ptr.x = nx; ptr.y = ny; ptr.last = performance.now();
  }, { passive: true });
  window.addEventListener('pointerdown', function (e) { if (interactive(e.target)) return; ptr.down = true; ptr.sx = e.clientX; ptr.moved = 0; }, { passive: true });
  function up(e) { if (ptr.down && ptr.moved < 6 && e.type === 'pointerup') burst = 1; ptr.down = false; }
  document.addEventListener('selectstart', function (e) { if (ptr.down) e.preventDefault(); });
  window.addEventListener('pointerup', up, { passive: true });
  window.addEventListener('pointercancel', up, { passive: true });

  /* smooth scroll: the wheel sets a target, the page eases to it */
  var sc = { cur: 0, tgt: 0, set: -1 };
  function goTo(y, hard) { sc.tgt = clamp(y, 0, maxScroll); if (hard) { sc.cur = sc.tgt; sc.set = Math.round(sc.cur); window.scrollTo(0, sc.cur); } }
  window.addEventListener('wheel', function (e) {
    if (e.ctrlKey) return;
    e.preventDefault();
    var d = e.deltaY * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? H : 1);
    sc.tgt = clamp(sc.tgt + d, 0, maxScroll);
  }, { passive: false });
  window.addEventListener('scroll', function () {
    var y = window.scrollY;
    if (Math.abs(y - sc.set) > 2 && Math.abs(y - sc.cur) > 2) { sc.cur = y; sc.tgt = y; sc.set = y; }
  }, { passive: true });
  function uOf(y) {
    for (var i = 0; i < NS - 1; i++) if (y < secTop[i + 1]) return i + clamp((y - secTop[i]) / Math.max(1, secTop[i + 1] - secTop[i]), 0, 1);
    return NS - 1;
  }
  window.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key, i = Math.floor(uOf(sc.tgt) + 0.02), used = true;
    if (k === 'ArrowDown') sc.tgt = clamp(sc.tgt + 140, 0, maxScroll);
    else if (k === 'ArrowUp') sc.tgt = clamp(sc.tgt - 140, 0, maxScroll);
    else if (k === 'PageDown' || (k === ' ' && !e.shiftKey)) goTo(secTop[Math.min(NS - 1, i + 1)]);
    else if (k === 'PageUp' || (k === ' ' && e.shiftKey)) goTo(sc.tgt > secTop[i] + 8 ? secTop[i] : secTop[Math.max(0, i - 1)]);
    else if (k === 'Home') goTo(0);
    else if (k === 'End') goTo(maxScroll);
    else if (k === 'ArrowLeft') drag.vel -= 0.9;
    else if (k === 'ArrowRight') drag.vel += 0.9;
    else used = false;
    if (used && !interactive(document.activeElement)) e.preventDefault();
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); goTo(secTop[+a.getAttribute('data-go')] || 0); });
  });

  function copyFade(y) {
    for (var i = 0; i < stages.length; i++) {
      var st = stages[i]; if (!st) continue;
      var a = (y - secTop[i]) / H, o = 1;
      if (i > 0) o *= 1 - sstep(0.12, 0.62, -a);
      if (i < NS - 1) { var seg = (secTop[i + 1] - secTop[i]) / H - 1; o *= 1 - sstep(seg + 0.01, seg + 0.30, a); }
      o = Math.round(o * 1000) / 1000;
      if (st.__o !== o) { st.__o = o; st.style.opacity = o; st.style.visibility = o <= 0 ? 'hidden' : 'visible'; }
    }
  }

  /* ------------------------------------------------------------ sound: made here, silent until asked */
  var AC = null, master = null, soundOn = false, noiseBuf = null, crackT = 0;
  var sbtn = document.getElementById('sound');
  function initAudio() {
    var Ctor = window.AudioContext || window.webkitAudioContext; if (!Ctor) return false;
    AC = new Ctor(); master = AC.createGain(); master.gain.value = 0; master.connect(AC.destination);
    var n = AC.sampleRate * 2, i; noiseBuf = AC.createBuffer(1, n, AC.sampleRate); var d = noiseBuf.getChannelData(0), b = 0;
    for (i = 0; i < n; i++) { var w = Math.random() * 2 - 1; b = b * 0.98 + w * 0.02; d[i] = w * 0.35 + b * 4; }
    [[55, 'sine', 0.20, 0.05], [82.5, 'sine', 0.11, 0.07], [110.4, 'triangle', 0.030, 0.11], [164.8, 'sine', 0.018, 0.031]].forEach(function (v) {
      var o = AC.createOscillator(); o.type = v[1]; o.frequency.value = v[0];
      var g = AC.createGain(); g.gain.value = v[2];
      var l = AC.createOscillator(); l.frequency.value = v[3]; var lg = AC.createGain(); lg.gain.value = v[2] * 0.6;
      l.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(master); o.start(); l.start();
    });
    var air = AC.createBufferSource(); air.buffer = noiseBuf; air.loop = true;
    var lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; var ag = AC.createGain(); ag.gain.value = 0.05;
    air.connect(lp); lp.connect(ag); ag.connect(master); air.start();
    return true;
  }
  function crackle(gain) {
    if (!AC || !soundOn) return;
    var s = AC.createBufferSource(); s.buffer = noiseBuf;
    var bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 4200; bp.Q.value = 2.5;
    var g = AC.createGain(), t = AC.currentTime, len = 0.012 + Math.random() * 0.04;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t, Math.random() * 1.5, len + 0.02);
  }
  if (sbtn) sbtn.addEventListener('click', function () {
    if (!AC && !initAudio()) return;
    soundOn = !soundOn;
    if (soundOn) AC.resume();
    master.gain.setTargetAtTime(soundOn ? 0.55 : 0, AC.currentTime, 0.25);
    sbtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    sbtn.querySelector('.lbl').textContent = soundOn ? 'Mute sound' : 'Enable sound';
  });

  /* ------------------------------------------------------------ state */
  var S = {}, time = frozen ? qT : 0;
  var by0 = null, yawLag = 0, slosh = { x: 0, z: 0, vx: 0, vz: 0 }, draft = 0, lastPu = [0.5, 0.5];
  var KEY0 = norm([-0.6, 0.55, 0.6]);

  function update(dt) {
    var now = performance.now();
    /* scroll */
    if (Math.abs(sc.tgt - sc.cur) > 0.3) {
      sc.cur += (sc.tgt - sc.cur) * (1 - Math.exp(-dt * 6.5));
      sc.set = Math.round(sc.cur); window.scrollTo(0, sc.cur);
    }
    copyFade(sc.cur);
    var u = uOf(sc.cur), i = clamp(Math.floor(u), 0, NS - 1), f = u - i;
    if (i >= NS - 1) { i = NS - 2; f = 1; }
    var hold = HOLDV / Math.max(1.01, (secTop[i + 1] - secTop[i]) / H);
    var x = clamp((f - hold) / (1 - hold), 0, 1), g = mix(x, x * x * (3 - 2 * x), 0.8);
    var a = L[i], b = L[i + 1];

    /* pointer, with an idle drift so the picture never stands still */
    var idle = frozen ? 0 : sstep(1500, 5000, now - ptr.last);
    var tx = frozen ? 0 : mix(ptr.x, 0.45 * Math.sin(time * 0.21), idle), ty = frozen ? 0 : mix(ptr.y, 0.25 * Math.sin(time * 0.17 + 1), idle);
    var k = frozen ? 1 : 1 - Math.exp(-dt * 3.2);
    sp.x += (tx - sp.x) * k; sp.y += (ty - sp.y) * k;

    var p = { T: mixv(a.T, b.T, g), D: mix(a.D, b.D, g), yaw: mix(a.yaw, b.yaw, g), pitch: mix(a.pitch, b.pitch, g), fov: mix(a.fov, b.fov, g), sh: mixv(a.sh, b.sh, g) };
    var cam = makeCam(p, -sp.x * 0.045, sp.y * 1.3);

    /* bottle: turned by the scroll, by the drag, a little by the pointer */
    if (!frozen) { drag.yaw += drag.vel * dt * 3; drag.vel *= Math.exp(-dt * 2.4); drag.yaw *= Math.exp(-dt * 0.5); }
    var by = mix(a.by, b.by, g) + drag.yaw + sp.x * 0.14 + (frozen ? 0 : 0.03 * Math.sin(time * 0.37));
    if (by0 === null || frozen) { by0 = by; yawLag = by; }
    var wv = dt > 0 ? (by - by0) / dt : 0; by0 = by;
    if (!frozen) {
      yawLag += (by - yawLag) * (1 - Math.exp(-dt * 1.1));
      var ax = -30 * slosh.x - 3.4 * slosh.vx + clamp(wv, -3, 3) * 2.4, az = -30 * slosh.z - 3.4 * slosh.vz + (tx - sp.x) * 1.6;
      slosh.vx += ax * dt; slosh.vz += az * dt; slosh.x = clamp(slosh.x + slosh.vx * dt, -0.24, 0.24); slosh.z = clamp(slosh.z + slosh.vz * dt, -0.24, 0.24);
    }
    var liqY = 2.3, lag = by - yawLag, cl = Math.cos(-lag), sl = Math.sin(-lag);
    function bub(period, ph0, rad, r, wob) {
      var ph = (time / period + ph0) % 1, top = liqY - r - 0.035;
      var y = mix(0.84, top, Math.pow(ph, 0.85));
      var rr = r * mix(0.8, 1, ph) * sstep(0, 0.03, ph) * (1 - sstep(0.965, 1, ph));
      var lx = -0.52 + rad * 0.3 * Math.cos(wob + time * 0.11) + 0.04 * Math.sin(time * 0.9 + wob), lz = 0.30 + rad * 0.3 * Math.sin(wob + time * 0.11);
      return [cl * lx + sl * lz, y, -sl * lx + cl * lz, Math.max(rr, 1e-4)];
    }
    var b1 = bub(17, 0.42, 0.40, 0.105, 0.6), b2 = [0, 1.2, 0, 1e-4];

    /* smoke sheet faces the lens */
    var A = [ember[0], ember[1] - SMH * SRC[1], ember[2]];
    var nx = cam.pos[0] - A[0], nz = cam.pos[2] - A[2], nl = Math.sqrt(nx * nx + nz * nz) || 1; nx /= nl; nz /= nl;
    var N = [nx, 0, nz], R = [nz, 0, -nx];
    /* pointer on the sheet */
    var pd = rayOf(cam, sp.x * aspect, sp.y), den = dot(pd, N), on = 0, pu = lastPu;
    if (Math.abs(den) > 1e-4) {
      var t = dot(sub(A, cam.pos), N) / den, hp = [cam.pos[0] + pd[0] * t - A[0], cam.pos[1] + pd[1] * t - A[1], cam.pos[2] + pd[2] * t - A[2]];
      pu = [dot(hp, R) / SMW + 0.5, hp[1] / SMH];
    }
    var pvx = dt > 0 ? (pu[0] - lastPu[0]) / dt * SW : 0, pvy = dt > 0 ? (pu[1] - lastPu[1]) / dt * SHt : 0;
    var pm = Math.sqrt(pvx * pvx + pvy * pvy); if (pm > 520) { pvx *= 520 / pm; pvy *= 520 / pm; }
    on = (1 - idle) * sstep(8, 90, pm); lastPu = pu;
    var es = project(cam, ember);
    draft += ((clamp(sp.x * aspect - es[0], -1.2, 1.2)) * 20 - draft) * (frozen ? 1 : 1 - Math.exp(-dt * 0.8));
    if (!frozen) burst *= Math.exp(-dt * 2.6);
    simIn.ptr = [pu[0], pu[1], pvx, pvy]; simIn.on = on; simIn.draft = frozen ? 0 : draft; simIn.burst = burst;

    var wa = 1 - sstep(0.02, 0.46, g), wb = sstep(0.54, 0.98, g);
    var px = RT ? RT.h : H;
    function lodOf(o) { return Math.max(0, Math.log2(2048 / Math.max(8, o.wpx * px))) + o.lod; }
    var poolW = mixv(a.poolW, b.poolW, g);
    var flick = 0.78 + 0.14 * Math.sin(time * 2.3) * Math.sin(time * 0.71 + 1) + 0.08 * Math.sin(time * 7.1);
    var labDist = Math.sqrt(dot(sub(cam.pos, [0, 1.45, 0]), sub(cam.pos, [0, 1.45, 0])));
    var labPx = 1.24 / (labDist * cam.tan) * px * 0.5;

    S = { time: time, cam: cam, by: by, lift: mix(a.lift, b.lift, g), liqN: norm([slosh.x, 1, slosh.z]), liqY: liqY, bub: b1.concat(b2),
      ember: clamp(flick + burst * 0.9, 0, 2), wordA: a.word, wordB: b.word, rectA: a.rect, rectB: b.rect, ww: [wa, wb], lod: [lodOf(a), lodOf(b)],
      labLod: clamp(Math.log2(1024 / Math.max(8, labPx)) - 0.35, 0, 6),
      key: norm([KEY0[0] + sp.x * 0.3, KEY0[1] + sp.y * 0.12, KEY0[2]]), smA: A, smR: R, smN: N, sm: mix(a.sm, b.sm, g),
      pool: poolW, boost: mix(a.boost, b.boost, g), u: u };

    if (soundOn && !frozen) { crackT -= dt; if (crackT <= 0) { crackle(0.05 + Math.random() * 0.12 + burst * 0.2); crackT = 0.05 + Math.random() * Math.random() * 1.3; } }
  }

  function render() {
    var s = S, u, c = s.cam, enc = hdr ? 0 : 1;
    into(RT.scene); gl.useProgram(P.scene.p); u = P.scene.u;
    gl.uniform2f(u.uRes, RT.w, RT.h); gl.uniform1f(u.uTime, s.time);
    gl.uniform3fv(u.uCam, c.pos); gl.uniformMatrix3fv(u.uCamM, false, [c.r[0], c.r[1], c.r[2], c.u[0], c.u[1], c.u[2], c.f[0], c.f[1], c.f[2]]);
    gl.uniform1f(u.uTan, c.tan); gl.uniform2f(u.uShift, c.sh[0], c.sh[1]);
    gl.uniform2f(u.uBotCS, Math.cos(s.by), Math.sin(s.by)); gl.uniform1f(u.uLift, s.lift);
    gl.uniform3fv(u.uLiqN, s.liqN); gl.uniform1f(u.uLiqY, s.liqY); gl.uniform4fv(u.uBub, s.bub);
    gl.uniform3fv(u.uChip, chip.pos); gl.uniform2f(u.uChipCS, Math.cos(chip.ang), Math.sin(chip.ang)); gl.uniform1f(u.uEmber, s.ember);
    bindTex(0, words[s.wordA].tex, u.uWordA); bindTex(1, words[s.wordB].tex, u.uWordB); bindTex(2, labelTex, u.uLabel);
    bindTex(3, sim ? sim.den[0].tex : labelTex, u.uSmoke);
    gl.uniform4fv(u.uRectA, s.rectA); gl.uniform4fv(u.uRectB, s.rectB); gl.uniform2fv(u.uWordW, s.ww); gl.uniform2fv(u.uWordLod, s.lod); gl.uniform1f(u.uLabLod, s.labLod);
    gl.uniform3fv(u.uKey, s.key);
    gl.uniform3fv(u.uSmA, s.smA); gl.uniform3fv(u.uSmR, s.smR); gl.uniform3fv(u.uSmN, s.smN); gl.uniform2f(u.uSmSize, SMW, SMH); gl.uniform1f(u.uSmAmt, sim ? s.sm : 0);
    gl.uniform4fv(u.uPool, s.pool); gl.uniform1f(u.uSS, scale >= 0.7 ? 1 : 0); gl.uniform1f(u.uEnc, enc); gl.uniform1f(u.uBoost, s.boost); gl.uniform1i(u.uZ, 0);
    tri();

    gl.useProgram(P.bright.p); u = P.bright.u; bindTex(0, RT.scene.tex, u.uTex); gl.uniform2f(u.uPx, 1 / RT.w, 1 / RT.h); gl.uniform1f(u.uThr, 1.0); gl.uniform1f(u.uEnc, enc);
    into(RT.b1a); tri();
    gl.useProgram(P.blur.p); u = P.blur.u;
    bindTex(0, RT.b1a.tex, u.uTex); gl.uniform2f(u.uDir, 1 / RT.b1a.w, 0); into(RT.b1b); tri();
    bindTex(0, RT.b1b.tex, u.uTex); gl.uniform2f(u.uDir, 0, 1 / RT.b1a.h); into(RT.b1a); tri();
    bindTex(0, RT.b1a.tex, u.uTex); gl.uniform2f(u.uDir, 1 / RT.b2a.w, 0); into(RT.b2a); tri();
    bindTex(0, RT.b2a.tex, u.uTex); gl.uniform2f(u.uDir, 0, 1 / RT.b2a.h); into(RT.b2b); tri();
    bindTex(0, RT.b2b.tex, u.uTex); gl.uniform2f(u.uDir, 1.6 / RT.b2a.w, 0); into(RT.b2a); tri();
    bindTex(0, RT.b2a.tex, u.uTex); gl.uniform2f(u.uDir, 0, 1.6 / RT.b2a.h); into(RT.b2b); tri();

    into(null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(P.final.p); u = P.final.u;
    bindTex(0, RT.scene.tex, u.uTex); bindTex(1, RT.b1a.tex, u.uB1); bindTex(2, RT.b2b.tex, u.uB2);
    gl.uniform1f(u.uTime, s.time); gl.uniform1f(u.uEnc, enc); gl.uniform1f(u.uAspect, aspect); gl.uniform1f(u.uBloom, hdr ? 1 : 0.6);
    tri();
  }

  /* ------------------------------------------------------------ loop */
  var last = 0, acc = 0, ema = 16.7, slow = 0, good = 0, retry = 240, stats = { fps: 60, ms: 16.7, scale: 1 };
  function frame(now) {
    requestAnimationFrame(frame);
    var raw = now - last; last = now;
    var dt = clamp(raw / 1000, 0.001, 0.1);
    if (!frozen) time += dt;
    update(frozen ? 0 : dt);
    if (!frozen) { acc += dt; var n = 0; while (acc >= 1 / 60 && n < 2) { simStep(); acc -= 1 / 60; n++; } if (acc > 0.05) acc = 0; }
    render();
    if (raw > 0 && raw < 250) {
      ema += (raw - ema) * 0.06; stats.ms = ema; stats.fps = 1000 / ema; stats.scale = scale;
      if (!frozen) {
        if (ema > 19.5) { slow++; good = 0; } else if (ema < 17.6) { good++; slow = 0; }
        if (slow > 24 && scale > 0.5) { scale = Math.max(0.5, scale * 0.86); allocRT(); slow = 0; ema = 16.7; retry = Math.min(retry * 2, 3600); }
        else if (good > retry && scale < 1) { scale = Math.min(1, scale * 1.08); allocRT(); good = 0; ema = 16.7; }
      }
    }
  }

  /* ------------------------------------------------------------ start */
  function start() {
    buildType(); measure();
    var y0 = qS !== null ? clamp(qS, 0, 1) * maxScroll : (VIEWS.hasOwnProperty(qV) ? secTop[VIEWS[qV]] : 0);
    goTo(y0, true);
    var steps = frozen ? Math.min(3600, 900 + Math.round(qT * 60)) : 900;
    for (var i = 0; i < steps; i++) simStep();
    last = performance.now(); update(0); render();
    canvas.classList.add('on'); document.documentElement.classList.add('ready');
    window.__ready = true;
    requestAnimationFrame(function (t) { last = t; requestAnimationFrame(frame); });
  }
  var started = false, fontsIn = false;
  function tryStart() {
    if (started || !fontsIn) return;
    if (!programsDone()) { setTimeout(tryStart, 40); return; }
    started = true;
    if (!programsFinish()) { document.documentElement.classList.add('nogl'); window.__ready = true; return; }
    start();
  }
  function go() { fontsIn = true; tryStart(); }
  var fontsWanted = ['500 120px "Bodoni Moda"', 'italic 400 60px "Bodoni Moda"', '400 40px Jost'];
  if (document.fonts && document.fonts.load) {
    Promise.all(fontsWanted.map(function (f) { return document.fonts.load(f, 'LignRes07 º'); })).then(go, go);
    setTimeout(go, 2600);
    document.fonts.ready.then(function () { if (started) { buildType(); resolve(); } });
  } else go();
  window.addEventListener('resize', function () { if (started) { measure(); goTo(sc.tgt, true); } });

  /* for the headless checks */
  window.__lign = {
    stats: stats, compileMs: compileMs, hdr: hdr,
    info: function () { var e = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), w: RT.w, h: RT.h, scale: scale, compileMs: compileMs, hdr: hdr, par: !!par }; },
    bench: function (n) { var px = new Uint8Array(4), t0 = performance.now(); for (var i = 0; i < n; i++) { time += 1 / 60; update(1 / 60); simStep(); render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return (performance.now() - t0) / n; }
  };
})();
