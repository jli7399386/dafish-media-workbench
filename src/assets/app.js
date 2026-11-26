/* 错误钩子：写进应用私有 error.log，方便排查 */
window.onerror = function (m, src, line, col, err) {
  try {
    const stack = (err && err.stack) ? String(err.stack).split('\n').slice(0, 4).join(' | ') : '';
    AndroidBridge.logError('JS错误: ' + m + ' @' + line + ':' + col + ' :: ' + stack);
  } catch (e) {}
  return false;
};
window.addEventListener('unhandledrejection', function (e) {
  try { AndroidBridge.logError('Promise错误: ' + (e.reason && e.reason.message || e.reason)); } catch (x) {}
});

/* 文件类型（必须定义在使用它们的函数之前：const 不提升） */
/* 全局可变状态（必须前置声明，否则 TDZ 报错） */
const T_LASTSAVE = {};
let BG_PLAY = false;   // 后台播放开关（默认关闭）
let bgActive = false;

const A_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
let aSpeedIdx = 2;
let AB2_A = null, AB2_B = null;
let MEM_RESTORE = true;
let browsePath = '/storage/emulated/0';
let TOOL_SRC = '';
let SEL_MODE = false;
const SEL = {};
let VSEL_MODE = false;
const VSEL = {};
let OUT_DIR = '/storage/emulated/0/大肥鱼工作台';

const AUD_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|ape|amr|aiff|dsf|mid|midi|mka|ac3|dts)$/i;
const VID_EXT = /\.(mp4|mkv|avi|mov|webm|flv|ts|rmvb|3gp|m4v|wmv)$/i;

window.addEventListener('DOMContentLoaded', function () {
  try { AndroidBridge.logError('=== 页面加载完成 ==='); } catch (e) {}
});

const MEDIA_MEM = 'mediaMemory';
function memSave(path, pos, dur) {
  try {
    const m = JSON.parse(localStorage.getItem(MEDIA_MEM) || '{}');
    m[path] = { pos: Math.round(pos || 0), dur: Math.round(dur || 0), at: Date.now() };
    localStorage.setItem(MEDIA_MEM, JSON.stringify(m));
  } catch (e) {}
}
function memGet(path) {
  try {
    const m = JSON.parse(localStorage.getItem(MEDIA_MEM) || '{}');
    return m[path] || null;
  } catch (e) { return null; }
}
window.onload = function () {};

function diag(msg) {}
window.onerror = function (m, src, line, col, err) {
  try { if (typeof AndroidBridge !== 'undefined' && AndroidBridge.logError) AndroidBridge.logError(m + ' @' + line + ':' + col); } catch (e) {}
  return false;
};
try {
} catch (e) {}

'use strict';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
let songs = [], view = [], cur = -1, loop = 'list';   // list | one | shuffle
const LOOP = { list: '🔁 列表', one: '🔂 单曲', shuffle: '🔀 随机' };
const au = $('#au');

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* 播放列表由用户手动添加，存本地，不扫描全盘 */
function load() {
  try { songs = JSON.parse(localStorage.getItem('mediaPlaylist') || '[]'); } catch (e) { songs = []; }
  $('#count').textContent = songs.length ? ('共 ' + songs.length + ' 项 · 长按可移除') : '点右上角「＋ 添加」选择音频/视频';
  render();
}

function savePL() {
  try { localStorage.setItem('mediaPlaylist', JSON.stringify(songs)); } catch (e) {}
}

function render() {
  const q = ($('#q').value || '').trim().toLowerCase();
  const auds = songs.filter(function (x) {
    if (x.type) return x.type === 'audio';      // 外部导入：按探测结果
    return AUD_EXT.test(x.path);
  });
  view = q ? auds.filter(s => (s.title || '').toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q)) : auds;

  const box = $('#list');
  if (!view.length) {
    box.innerHTML = '<div class="empty">还没有音乐<br>把音频文件放进手机，点右上角「刷新」</div>';
    return;
  }
  box.innerHTML = '';
  view.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'item' + (songs[cur] && songs[cur].id === s.id ? ' on' : '');
    el.innerHTML = '<div class="n">' + (i + 1) + '</div>' +
      '<div class="info"><b></b><span></span></div>' +
      '<div class="d">' + fmt(s.dur || 0) + '</div>';
    el.querySelector('b').textContent = s.title || '未知曲目';
    const am = memGet(s.path);
    el.querySelector('span').textContent = (s.artist || '未知歌手') + (s.album ? ' · ' + s.album : '') +
      (am && am.dur
        ? '  · ' + (am.pos >= am.dur - 5 ? '已听完' : ('听到 ' + Math.floor(am.pos / am.dur * 100) + '%'))
        : '');
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-del]')) return;
      if (SEL_MODE) {
        const key = s.path;
        if (SEL[key]) delete SEL[key]; else SEL[key] = 1;
        el.classList.toggle('sel', !!SEL[key]);
        renderBatchCount();
        return;
      }
      playIndex(i);
    });
    if (SEL_MODE) {
      el.classList.add('selmode');
      if (SEL[s.path]) el.classList.add('sel');
      const chk = document.createElement('div');
      chk.className = 'chk';
      chk.textContent = SEL[s.path] ? '✓' : '';
      el.appendChild(chk);
    }
    const del = document.createElement('button');
    del.className = 'delbtn';
    del.dataset.del = s.path;
    del.textContent = '✕';
    el.appendChild(del);
    box.appendChild(el);
  });
}

/* ---------- FFmpeg：不支持格式转 mp3 后播放 ---------- */
const FF_CACHE = {};
window.onFfProbe = function (id, out) {
  if (window.__probeCb) window.__probeCb(0, String(out || ''));
};

window.onFfStat = function (timeMs, speed) {
  const st = document.getElementById('jobState');
  if (!st) return;
  const t = Math.floor(timeMs / 1000000);   // 微秒 → 秒
  const mm = Math.floor(t / 60), ss = t % 60;
  st.textContent = '处理中… 已处理 ' + mm + ':' + String(ss).padStart(2, '0') + (speed > 0 ? ('  速度 ' + speed.toFixed(1) + '×') : '');
};

window.onFf = function (id, res) { if (window.__ffCb) window.__ffCb(id, res); };

function ffHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function ffTranscode(path, cb) {
  if (FF_CACHE[path]) { cb(FF_CACHE[path]); return; }
  const out = '/data/data/com.dafish.media/cache/ff_' + ffHash(path) + '.mp3';
  const args = ['-y', '-i', path, '-vn', '-acodec', 'libmp3lame', '-b:a', '192k', out];
  window.__ffCb = function (id, res) {
    const code = parseInt(String(res).split('\n')[0], 10);
    if (code === 0) { FF_CACHE[path] = out; cb(out); }
    else cb(null, String(res).slice(-200));
  };
  try { AndroidBridge.ffExec(JSON.stringify(args), 'job1'); }
  catch (e) { cb(null, String(e)); }
}

function tryTranscode(song) {
  if (!song || song.tried) return;
  song.tried = true;
  toast2('这个格式需要转换，请稍等…');
  ffTranscode(song.path, function (out, err) {
    if (out) {
      au.onerror = null;
      au.src = 'file://' + out;
      au.play().catch(function () {});
      toast2('转换完成，开始播放');
    } else {
      toast2('这个格式放不了' + (err ? '：' + String(err).split('\n').pop() : ''));
    }
  });
}

function playIndex(i) {
  if (i < 0 || i >= view.length) return;
  try { const v0 = document.getElementById('vid'); if (v0) v0.pause(); } catch (e) {}

  const s = view[i];
  if (!fileOk(s.path)) return;
  const real = songs.findIndex(x => x.id === s.id);
  cur = real >= 0 ? real : i;
  const song = songs[cur];
  au.src = 'file://' + song.path;
  au.onerror = function () { tryTranscode(song); };
  au.play().catch(function () { tryTranscode(song); });
  $('#nowTitle').textContent = song.title || '未知曲目';
  $('#nowArtist').textContent = (song.artist || '') + (song.album ? ' · ' + song.album : '');
  updatePlayBtn();
  render();
}

function curSong() { return songs[cur] || null; }

function next(step) {
  AB2_A = null; AB2_B = null;
  const abB = document.getElementById('aAB');
  if (abB) { abB.textContent = 'A-B'; abB.classList.remove('on'); }
  if (!songs.length) return;
  if (loop === 'shuffle') {
    let n = cur;
    while (songs.length > 1 && n === cur) n = Math.floor(Math.random() * songs.length);
    cur = n;
  } else {
    cur = (cur + step + songs.length) % songs.length;
  }
  const s = songs[cur];
  au.src = 'file://' + s.path;
  au.play().catch(() => {});
  $('#nowTitle').textContent = s.title || '';
  $('#nowArtist').textContent = (s.artist || '') + (s.album ? ' · ' + s.album : '');
  updatePlayBtn();
  render();
}

function updatePlayBtn() { $('#btnPlay').innerHTML = au.paused ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'; }

/* 音频倍速 & A-B（与视频页对齐） */
function cycleAudioSpeed() {
  aSpeedIdx = (aSpeedIdx + 1) % A_SPEEDS.length;
  const sp = A_SPEEDS[aSpeedIdx];
  au.playbackRate = sp;
  const b = document.getElementById('aSpeed');
  if (b) b.textContent = (sp === 1 ? '1.0' : String(sp)) + '×';
  toast2('速度 ' + sp + '×');
}

function toggleAudioAB() {
  if (AB2_A === null) {
    AB2_A = au.currentTime;
    const b = document.getElementById('aAB');
    if (b) b.textContent = 'A…';
    toast2('A 点：' + fmt(AB2_A * 1000));
  } else if (AB2_B === null) {
    AB2_B = au.currentTime;
    const b = document.getElementById('aAB');
    if (b) { b.textContent = 'A-B'; b.classList.add('on'); }
    toast2('B 点：' + fmt(AB2_B * 1000) + '，开始循环');
  } else {
    AB2_A = null; AB2_B = null;
    const b = document.getElementById('aAB');
    if (b) { b.textContent = 'A-B'; b.classList.remove('on'); }
    toast2('已取消 A-B 循环');
  }
}

function bindAudioExtras() {
  const sp = document.getElementById('aSpeed');
  if (sp && !sp.dataset.b) { sp.dataset.b = '1'; sp.addEventListener('click', cycleAudioSpeed); }
  const ab = document.getElementById('aAB');
  if (ab && !ab.dataset.b) { ab.dataset.b = '1'; ab.addEventListener('click', toggleAudioAB); }
}

au.addEventListener('timeupdate', function () {
  const cs = curSong();
  const d = (isFinite(au.duration) && au.duration > 0) ? au.duration : (cs && cs.dur ? cs.dur / 1000 : 0);
  if (d > 0) {
    const pr = document.getElementById('prog');
    const ct = document.getElementById('curTime');
    const at = document.getElementById('allTime');
    if (pr) pr.value = Math.round(au.currentTime / d * 1000);
    if (ct) ct.textContent = fmt(au.currentTime * 1000);
    if (at) at.textContent = fmt(d * 1000);
  }
  /* 关键：每个 timeupdate 都问原生「我还在前台吗」 */
  if (cs && d > 0) {
    try {
      if (AndroidBridge.isForeground && !AndroidBridge.isForeground() && !BG_PLAY) {
        const dd = d;
        if (dd > 0) memSave(cs.path, au.currentTime, dd);
        au.pause();
        stopBg();
        toast2('已停止播放（后台播放未开启）');
        return;
      }
    } catch (e) {}
  }
  if (cs && d > 0) {
    const now = au.currentTime;
    const last = T_LASTSAVE[cs.path] || 0;
    if (Math.abs(now - last) > 1 || au.paused) {   // 每秒写一次，暂停时也写
      memSave(cs.path, now, d);
      T_LASTSAVE[cs.path] = now;
    }
  }
  if (AB2_A !== null && AB2_B !== null && au.currentTime >= AB2_B) au.currentTime = AB2_A;
});
au.addEventListener('loadedmetadata', function () {
  const cs = curSong();
  if (!cs || !MEM_RESTORE) return;
  MEM_RESTORE = false;
  const m = memGet(cs.path);
  if (m && m.pos > 5 && m.dur && m.pos < m.dur - 5) {
    au.currentTime = m.pos;
    const pr = document.getElementById('prog');
    if (pr) pr.value = Math.round(m.pos / m.dur * 1000);
    const ct = document.getElementById('curTime');
    if (ct) ct.textContent = fmt(m.pos * 1000);
    const at = document.getElementById('allTime');
    if (at) at.textContent = fmt(m.dur * 1000);
    toast2('从上次位置继续：' + fmt(m.pos * 1000));
  }
});

au.addEventListener('timeupdate2', () => {
  const d = au.duration || (curSong() ? curSong().dur / 1000 : 0);
  if (d > 0) {
    $('#prog').value = Math.round(au.currentTime / d * 1000);
    $('#curTime').textContent = fmt(au.currentTime * 1000);
    $('#allTime').textContent = fmt(d * 1000);
  }
});
au.addEventListener('ended', () => {
  if (loop === 'one') { au.currentTime = 0; au.play().catch(() => {}); return; }
  next(1);
});
au.addEventListener('play', function () { updatePlayBtn(); startBg(); updateBg(); });
au.addEventListener('pause', function () {
  updatePlayBtn();
  updateBg();
  const cs = curSong();
  if (cs && au.currentTime > 1) {
    const d = (isFinite(au.duration) && au.duration > 0) ? au.duration : (cs.dur ? cs.dur / 1000 : 0);
    if (d > 0) memSave(cs.path, au.currentTime, d);
  }
});

$('#btnPlay').addEventListener('click', () => {
  if (!curSong()) { if (songs.length) playIndex(0); return; }
  if (au.paused) au.play().catch(() => {}); else au.pause();
});
$('#btnNext').addEventListener('click', () => next(1));
$('#btnPrev').addEventListener('click', () => next(-1));
$('#btnLoop').addEventListener('click', () => {
  loop = loop === 'list' ? 'one' : (loop === 'one' ? 'shuffle' : 'list');
  $('#btnLoop').textContent = LOOP[loop];
});

/* 页面切换 */
function showScreen(id) {
  const home = document.getElementById('home');
  const audio = document.getElementById('audio');
  const tools = document.getElementById('tools');
  const f = document.getElementById('files');
  if (home) { home.style.display = (id === 'home') ? 'flex' : 'none'; }
  if (audio) { audio.style.display = (id === 'audio') ? 'flex' : 'none'; }
  if (tools) { tools.style.display = (id === 'tools') ? 'flex' : 'none'; }
  const vid = document.getElementById('video');
  if (vid) {
    vid.style.display = (id === 'video') ? 'flex' : 'none';
    if (id !== 'video') { const v2 = document.getElementById('vid'); if (v2) { v2.pause(); } }
  }
  /* 底部播放条只在音频页显示；离开音频页就停掉音频 */
  const bar = document.getElementById('bar');
  if (bar) bar.style.display = (id === 'audio') ? 'block' : 'none';
  if (id !== 'audio') { try { au.pause(); } catch (e) {} }
  if (f) { f.style.display = 'none'; f.classList.remove('show'); }
  document.body.setAttribute('data-screen', id);
}

function toast2(msg) {
  const d = document.createElement('div');
  d.className = 'toast2';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2200);
}

/* 系统返回键 */
window.dshBack = function () {
  const f = $('#files');
  if (f && f.classList.contains('show')) {
    if (browsePath !== '/storage/emulated/0') { browsePath = browsePath.replace(/\/[^/]+$/, '') || '/storage/emulated/0'; renderFiles(); }
    else f.classList.remove('show');
    return true;
  }
  const a = document.getElementById('audio');
  if (a && a.classList.contains('on')) { showScreen('home'); return true; }
  return false;
};

showScreen('home');
$('#btnLoop').textContent = LOOP[loop];
$('#prog').addEventListener('input', ev => {
  const d = au.duration || 0;
  if (d > 0) au.currentTime = ev.target.value / 1000 * d;
});
$('#q').addEventListener('input', render);
const MEDIA_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|ape|amr|aiff|mp4|mkv|avi|mov|webm|flv|ts|rmvb|3gp)$/i;

function openFiles() {
  browsePath = '/storage/emulated/0';
  const f = document.getElementById('files');
  if (f) f.style.display = 'flex';
  renderFiles();
}

/* 选择输出目录：只显示文件夹 + 一个"用这个文件夹"按钮 */
function pickOutDir() {
  window.__dirMode = true;
  openFiles();
  const fh = document.getElementById('fHint');
  if (fh) fh.textContent = '点文件夹进入，点「用这个文件夹」确认当前目录';
  let btn = document.getElementById('useDir');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'useDir';
    btn.className = 'ghost';
    btn.style.cssText = 'position:absolute;right:12px;bottom:24px;z-index:90';
    btn.textContent = '用这个文件夹';
    document.getElementById('files').appendChild(btn);
    /* 点击由全局委托处理 */
  }
  btn.style.display = 'block';
}

function renderFiles() {
  $('#fPath').textContent = browsePath;
  const from = window.__from || '';
  const hint = document.getElementById('fHint');
  if (hint) hint.textContent = from === 'audio' ? '只显示音频' : (from === 'video' ? '只显示视频' : '全部文件');
  const box = $('#fList');
  let list = [];
  try { list = JSON.parse(AndroidBridge.listDir(browsePath) || '[]'); } catch (e) { list = []; }
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="empty">这个文件夹是空的</div>'; return; }
  list.forEach(f => {
    const el = document.createElement('div');
    const isMedia = !f.dir && (MEDIA_EXT.test(f.name) || (window.__pickMode === 'tool' && !/\.[A-Za-z0-9]{1,6}$/.test(f.name)));
    const added = songs.some(x => x.path === f.path);
    el.className = 'fitem' + (added ? ' added' : '');
    el.innerHTML = '<div class="ic">' + (f.dir ? '📁' : (isMedia ? '🎵' : '📄')) + '</div>' +
      '<div class="nm"></div>' + (added ? '<div class="ic">✓</div>' : '');
    el.querySelector('.nm').textContent = f.name;
    el.addEventListener('click', () => {
      if (f.dir) { browsePath = f.path; renderFiles(); return; }
      if (!isMedia) return;
      /* 按来源过滤：音频页只列音频，视频页只列视频，工具页两个都要 */
      const from = window.__from;
      const isTool = window.__pickMode === 'tool';
      const noExt = !/\.[A-Za-z0-9]{1,6}$/.test(f.name);
      const isAud = AUD_EXT.test(f.path), isVid = VID_EXT.test(f.path);
      if (!isTool) {
        if (from === 'audio' && !isAud) { toast2('这里只显示音频文件'); return; }
        if (from === 'video' && !isVid) { toast2('这里只显示视频文件'); return; }
      }
      if (window.__pickMode === 'tool') {
        window.__pickMode = '';
        TOOL_SRC = f.path;
        const btn = document.getElementById('pickSrc');
        if (btn) btn.textContent = f.name;
        const sn = document.getElementById('srcName');
        if (sn) sn.textContent = f.path;
        const tb = document.getElementById('toolHint');
        if (tb) tb.textContent = '已选：' + f.name;
        const ff = document.getElementById('files');
        if (ff) ff.style.display = 'none';
        loadToolDuration();
        return;
      }
      const idx = songs.findIndex(x => x.path === f.path);
      if (idx >= 0) { songs.splice(idx, 1); savePL(); load(); renderFiles(); return; }
      songs.push({ id: f.path, title: f.name.replace(/\.[^.]+$/, ''), artist: '', album: '',
                   dur: 0, path: f.path });
      savePL();
      load();
      renderFiles();
      if (document.getElementById('video') && document.getElementById('video').style.display !== 'none') {
        renderVideoList();
      }
    });
    box.appendChild(el);
  });
}

const btnAddEl = $('#btnAdd');
if (btnAddEl) btnAddEl.addEventListener('click', openFiles);
const fCloseEl = $('#fClose');
if (fCloseEl) fCloseEl.addEventListener('click', () => { const f = $('#files'); if (f) f.style.display = 'none'; });
const fBackEl = $('#fBack');
if (fBackEl) fBackEl.addEventListener('click', () => {
  if (browsePath === '/storage/emulated/0') return;
  browsePath = browsePath.replace(/\/[^/]+$/, '') || '/storage/emulated/0';
  renderFiles();
});

$('#btnLoop').textContent = LOOP[loop];
if (typeof AndroidBridge === 'undefined') {
  $('#count').textContent = '网页预览模式（无本地扫描）';
} else {
  load();
}

function showVideo() {
  showScreen('video');
  renderVideoList();
}

function renderVideoList() {
  const box = document.getElementById('vList');
  if (!box) return;
  const vids = songs.filter(function (x) {
    if (x.type) return x.type === 'video';      // 外部导入：按探测结果
    return VID_EXT.test(x.path);
  });
  const cnt = document.getElementById('vCount');
  if (cnt) cnt.textContent = vids.length ? ('共 ' + vids.length + ' 个视频') : '播放列表里还没有视频';
  box.innerHTML = '';
  if (!vids.length) {
    box.innerHTML = '<div class="empty">先在「音频」页用「＋ 添加」把视频加进播放列表</div>';
    return;
  }
  bindVideoEvents();
  vids.forEach(function (v) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = '<div class="info"><b></b><span></span></div>';
    el.querySelector('b').textContent = v.title;
    const m = memGet(v.path);
    el.querySelector('span').textContent = v.path.split('/').slice(-2).join('/') +
      (m && m.dur ? '  · 看到 ' + Math.floor(m.pos / m.dur * 100) + '%' : '');
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-del]')) return;
      if (VSEL_MODE) {
        if (VSEL[v.path]) delete VSEL[v.path]; else VSEL[v.path] = 1;
        el.classList.toggle('sel', !!VSEL[v.path]);
        renderVBatchCount();
        return;
      }
      box.querySelectorAll('.item').forEach(function (x) { x.classList.remove('on'); });
      el.classList.add('on');
      playVideo(v);
    });
    if (VSEL_MODE) {
      el.classList.add('selmode');
      if (VSEL[v.path]) el.classList.add('sel');
      const chk = document.createElement('div');
      chk.className = 'chk';
      chk.textContent = VSEL[v.path] ? '✓' : '';
      el.appendChild(chk);
    }
    const dv = document.createElement('button');
    dv.className = 'delbtn';
    dv.dataset.del = v.path;
    dv.textContent = '✕';
    el.appendChild(dv);
    box.appendChild(el);
  });
}

function fileOk(path) {
  let ok = true;
  try { ok = AndroidBridge.fileExists(path); } catch (e) { ok = true; }
  if (!ok) {
    toast2('文件不存在了，可能被移动或删除了');
    return false;
  }
  return true;
}

let V_MEM = true;

const V_MODES = ['stop', 'one', 'next'];
const V_MODE_LABEL = { stop: '播完：停止', one: '播完：重播', next: '播完：下一个' };
let vModeIdx = 0;

function cycleVideoMode() {
  vModeIdx = (vModeIdx + 1) % V_MODES.length;
  const m = V_MODES[vModeIdx];
  const b = document.getElementById('vMode');
  if (b) b.textContent = V_MODE_LABEL[m];
  try { localStorage.setItem('videoEndMode', m); } catch (e) {}
  toast2(V_MODE_LABEL[m]);
}

const VSPEED = [0.5, 0.75, 1, 1.25, 1.5, 2];
let vSpeedIdx = 2;
let AB_A = null, AB_B = null;

let V_FULL = false;

let ctlTimer = 0;
let VOL = 100;
let volTimer = 0;

function showVolBar(pct) {
  let el = document.getElementById('volBar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'volBar';
    el.className = 'volbar';
    el.innerHTML = '<div class="vt"><span>音量</span><b id="volNum">100</b></div><div class="vbar"><i id="volFill"></i></div>';
    const wrap = document.querySelector('.vwrap');
    if (wrap) wrap.appendChild(el);
    else document.body.appendChild(el);
  }
  paintVol(pct);
  el.classList.add('show');
  clearTimeout(volTimer);
  volTimer = setTimeout(function () { el.classList.remove('show'); }, 1500);
}

function paintVol(pct) {
  const v = (pct === undefined || pct === null) ? readSysVol() : pct;
  const n = document.getElementById('volNum');
  const f = document.getElementById('volFill');
  if (n) n.textContent = v;
  if (f) f.style.height = v + '%';
  return v;
}

function readSysVol() {
  try { if (AndroidBridge.getSysVol) return AndroidBridge.getSysVol(); } catch (e) {}
  const v = document.getElementById('vid');
  return Math.round((v && v.volume ? v.volume : 1) * 100);
}

window.onVolShow = function (pct) { showVolBar(pct); };

function applyVol() {
  const v = document.getElementById('vid');
  if (v) v.volume = Math.max(0, Math.min(1, VOL / 100));
  paintVol();
}

window.onVolKey = function () { return false; };

function ctlAutoHideSmall() {
  if (V_FULL) return;
  const c = document.querySelector('.vctl');
  if (!c) return;
  c.style.opacity = '1';
  clearTimeout(ctlTimer);
  ctlTimer = setTimeout(function () {
    if (!V_FULL) c.style.opacity = '0.25';     // 半透明，不完全消失（小窗需要能看到）
  }, 3000);
}

function ctlAutoHide() {
  if (!V_FULL) return;
  clearTimeout(ctlTimer);
  const c = document.querySelector('.vctl');
  if (c) c.style.opacity = '1';
  ctlTimer = setTimeout(function () {
    if (V_FULL && c) c.style.opacity = '0';
  }, 3000);
}

function toggleFullscreen() {
  V_FULL = !V_FULL;
  const wrap = document.querySelector('.vwrap');
  const page = document.getElementById('video');
  try {
    if (typeof AndroidBridge !== 'undefined' && AndroidBridge.goFullscreen) {
      const v = document.getElementById('vid');
      const portrait = v && v.videoHeight && v.videoWidth && (v.videoHeight > v.videoWidth);
      AndroidBridge.goFullscreen(V_FULL, !portrait);   // 竖屏视频不强制横屏
    }
  } catch (e) {}
  if (wrap) {
    wrap.classList.toggle('fullview', V_FULL);
    if (V_FULL) { wrap.style.height = ''; } else { const v = document.getElementById('vid'); if (v) fitVideoBox(v); }
  }
  if (page) page.classList.toggle('fullpage', V_FULL);
  ctlAutoHide();
  if (V_FULL) showVolBar();
  if (!V_FULL) {
    const v = document.getElementById('vid');
    if (wrap) wrap.classList.remove('fullview');
    if (v) fitVideoBox(v);
  }
  const f = document.getElementById('vFull');
  if (f) f.textContent = '⛶';
  toast2(V_FULL ? '已全屏（退出请再点一次或按返回）' : '已退出全屏');
}

function cycleSpeed() {
  vSpeedIdx = (vSpeedIdx + 1) % VSPEED.length;
  const v = document.getElementById('vid');
  if (v) v.playbackRate = VSPEED[vSpeedIdx];
  const b = document.getElementById('vSpeed');
  if (b) b.textContent = VSPEED[vSpeedIdx].toFixed(vSpeedIdx === 2 ? 1 : 2).replace(/0$/, '') + '×';
  toast2('速度 ' + VSPEED[vSpeedIdx] + '×');
}

function toggleAB() {
  const v = document.getElementById('vid');
  if (!v) return;
  if (AB_A === null) {
    AB_A = v.currentTime;
    const b = document.getElementById('vAB');
    if (b) b.textContent = 'A…';
    toast2('A 点：' + fmt(AB_A * 1000) + '（再点设置 B 点）');
  } else if (AB_B === null) {
    AB_B = v.currentTime;
    const b = document.getElementById('vAB');
    if (b) { b.textContent = 'A-B'; b.classList.add('on'); }
    toast2('B 点：' + fmt(AB_B * 1000) + '，开始循环');
  } else {
    AB_A = null; AB_B = null;
    const b = document.getElementById('vAB');
    if (b) { b.textContent = 'A-B'; b.classList.remove('on'); }
    toast2('已取消 A-B 循环');
  }
}

let volHideTimer = 0;


function fitVideoBox(v) {
  const wrap = document.querySelector('.vwrap');
  if (!wrap || !v) return;
  if (!v.videoWidth || !v.videoHeight) return;
  const ratio = v.videoHeight / v.videoWidth;
  const maxH = window.innerHeight * 0.46;          // 最多占 46% 屏高
  const w = window.innerWidth;
  let h = w * ratio;
  if (h > maxH) h = maxH;                          // 竖屏视频也不会太高
  wrap.style.height = Math.round(h) + 'px';
}

let MORE_ON = false;

function toggleMore() {
  MORE_ON = !MORE_ON;
  document.querySelectorAll('.vopt').forEach(function (el) {
    el.classList.toggle('vopt-show', MORE_ON);
  });
  const b = document.getElementById('vMore');
  if (b) b.textContent = MORE_ON ? '×' : '⋯';
}

function bindVideoFull() {
  const b1 = document.getElementById('vFull');
  if (b1 && !b1.dataset.b) { b1.dataset.b = '1'; b1.addEventListener('click', toggleFullscreen); }
  const b2 = document.getElementById('vSpeed');
  if (b2 && !b2.dataset.b) { b2.dataset.b = '1'; b2.addEventListener('click', cycleSpeed); }
  const bm = document.getElementById('vMore');
  if (bm && !bm.dataset.b) { bm.dataset.b = '1'; bm.addEventListener('click', function (ev) { ev.stopPropagation(); toggleMore(); }); }
  const b3 = document.getElementById('vAB');
  if (b3 && !b3.dataset.b) { b3.dataset.b = '1'; b3.addEventListener('click', toggleAB); }
  const pr = document.getElementById('vProg');
  if (pr && !pr.dataset.b) {
    pr.dataset.b = '1';
    pr.addEventListener('input', function () {
      const v = document.getElementById('vid');
      if (v && v.duration) v.currentTime = pr.value / 1000 * v.duration;
    });
  }
}

window.addEventListener('resize', function () {
  const v = document.getElementById('vid');
  if (v) fitVideoBox(v);
});

function bindVideoEvents() {
  bindVideoFull();
  const mb = document.getElementById('vMode');
  if (mb && !mb.dataset.b) {
    mb.dataset.b = '1';
    try {
      const saved = localStorage.getItem('videoEndMode');
      if (saved) { const i = V_MODES.indexOf(saved); if (i >= 0) vModeIdx = i; }
    } catch (e) {}
    mb.textContent = V_MODE_LABEL[V_MODES[vModeIdx]];
    mb.addEventListener('click', cycleVideoMode);
  }
  const wrap = document.querySelector('.vwrap');
  if (wrap && !wrap.dataset.tapb) {
    wrap.dataset.tapb = '1';
    wrap.addEventListener('click', function (ev) {
      if (ev.target.closest('.vctl') || ev.target.closest('.vvol')) return;
      if (!V_FULL) return;
      const c = document.querySelector('.vctl');
      if (!c) return;
      const hidden = c.style.opacity === '0';
      c.style.opacity = hidden ? '1' : '0';
      if (hidden) ctlAutoHide();
      else clearTimeout(ctlTimer);
    });
  }
  const vp2 = document.getElementById('vPlay');
  if (vp2 && !vp2.dataset.b) {
    vp2.dataset.b = '1';
    vp2.addEventListener('click', function () {
      const v3 = document.getElementById('vid');
      if (!v3) return;
      if (v3.paused) v3.play().catch(function () {}); else v3.pause();
    });
  }
  const vid = document.getElementById('vid');
  if (!vid || vid.dataset.bound) return;
  vid.dataset.bound = '1';
  vid.addEventListener('timeupdate', function () {
    if (vid.duration > 0 && !vid.paused && vid.currentSrc) {
      memSave(decodeURI(vid.currentSrc.replace('file://', '')), vid.currentTime, vid.duration);
    }
  });
  const upd = function () {
    const b = document.getElementById('vPlay');
    const t = document.getElementById('vTime');
    if (b) b.innerHTML = vid.paused ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    if (t) t.textContent = fmt(vid.currentTime * 1000) + ' / ' + fmt((vid.duration || 0) * 1000);
    const pr = document.getElementById('vProg');
    if (pr && vid.duration > 0) pr.value = Math.round(vid.currentTime / vid.duration * 1000);
    if (AB_A !== null && AB_B !== null && vid.currentTime >= AB_B) vid.currentTime = AB_A;
  };
  ['play', 'pause', 'timeupdate', 'loadedmetadata'].forEach(function (e) { vid.addEventListener(e, upd); });
  vid.addEventListener('ended', function () {
    const m = V_MODES[vModeIdx];
    if (m === 'one') { vid.currentTime = 0; vid.play().catch(function () {}); return; }
    if (m === 'next') {
      const box = document.getElementById('vList');
      const items = box ? Array.from(box.querySelectorAll('.item')) : [];
      const idx = items.findIndex(function (el) { return el.classList.contains('on'); });
      if (idx >= 0 && idx + 1 < items.length) { items[idx + 1].click(); return; }
      toast2('已经是最后一个视频');
      return;
    }
    // stop：什么都不做
  });
  vid.addEventListener('loadedmetadata', function () {
    fitVideoBox(vid);
    if (!V_MEM) return;
    V_MEM = false;
    const p = decodeURI(vid.currentSrc.replace('file://', ''));
    const m = memGet(p);
    if (m && m.pos > 5 && m.dur && m.pos < m.dur - 5) {
      vid.currentTime = m.pos;
      toast2('从上次位置继续：' + fmt(m.pos * 1000));
    }
  });
}

function playVideo(v) {
  const vid = document.getElementById('vid');
  if (!vid) return;
  try { au.pause(); } catch (e) {}          // 播视频时停掉音频

  if (!fileOk(v.path)) return;
  try { localStorage.setItem('lastVideo', v.path); } catch (e) {}
  V_MEM = true;
  vid.src = 'file://' + v.path;
  vid.volume = 1.0;   // 音量交给系统媒体音量控制
  vid.play().catch(function () { toast2('这个视频格式浏览器放不了，可能需要在格式工具里转成 MP4'); });
}

/* 统一委托：任何按钮点击都走这里，避免某处绑定失败导致整片失效 */
document.addEventListener('click', function (ev) {
  try {
    const t0 = ev.target;
    AndroidBridge.logError('点击: ' + (t0 && t0.id ? '#' + t0.id : (t0 && t0.className ? '.' + String(t0.className).split(' ')[0] : (t0 && t0.nodeName))));
  } catch (e) {}
  /* 删除按钮优先 */
  const delBtn = ev.target && ev.target.closest ? ev.target.closest('[data-del]') : null;
  if (delBtn) { delItem(delBtn.dataset.del); return; }

  const t = ev.target && ev.target.closest ? ev.target.closest('[id],[data-id]') : null;
  if (!t) return;
  const id = t.id;
  if (id === 'btnSettings') { openSettings(); return; }
  if (id === 'btnLog') { closeSettings(); openLog(); return; }
  if (id === 'btnHomeLog') { openLog(); return; }
  if (id === 'btnClean') { cleanIncomingCache(true); return; }
  if (id === 'logClose') { const lp = document.getElementById('logPanel'); if (lp) lp.classList.remove('show'); return; }
  if (id === 'logRefresh') { renderLog(); return; }
  if (id === 'logClear') { try { AndroidBridge.clearLog(); } catch (e) {} renderLog(); toast2('日志已清空'); return; }
  if (id === 'pickOutDir') { pickOutDir(); return; }
  if (id === 'useDir') {
    const r = AndroidBridge.setOutDir(browsePath);
    if (r === 'ok') {
      OUT_DIR = browsePath;
      const el = document.getElementById('outPath');
      if (el) el.textContent = OUT_DIR.endsWith('/') ? OUT_DIR : (OUT_DIR + '/');
      toast2('输出目录已更改');
    } else {
      toast2('设置失败：' + r);
    }
    const b2 = document.getElementById('useDir');
    if (b2) b2.style.display = 'none';
    const f2 = document.getElementById('files');
    if (f2) f2.style.display = 'none';
    return;
  }
  if (id === 'goAudio') { showScreen('audio'); load(); return; }
  if (id === 'goVideo') { showVideo(); return; }
  if (id === 'goTools') { showScreen('tools'); return; }
  if (id === 'vBack' || id === 'aBack') { showScreen('home'); return; }
  if (id === 'doSplit') { doSplitN(); return; }
  if (id === 'doFixExt') { doFixExt(); return; }
  if (id === 'vAdd') { window.__pickMode = ''; window.__from = 'video'; openFiles(); return; }
  if (id === 'fClose') { (function(){var f=document.getElementById('files'); if(f) f.style.display='none';})(); return; }
  if (id === 'fBack') { backDir(); return; }
  if (id === 'btnAdd') { window.__from = 'audio'; window.__pickMode = ''; openFiles(); return; }
  if (t.dataset && t.dataset.del) { delItem(t.dataset.del); return; }
});

function backDir() {
  if (browsePath === '/storage/emulated/0') { (function(){var f=document.getElementById('files'); if(f) f.style.display='none';})(); return; }
  browsePath = browsePath.replace(/\/[^/]+$/, '') || '/storage/emulated/0';
  renderFiles();
}

function delItem(path) {
  const s2 = songs.find(x => x.path === path);
  if (!s2) return;
  const mask = document.createElement('div');
  mask.className = 'dialog-mask';
  mask.innerHTML = '<div class="dialog"><h4>从列表移除？</h4><p></p>' +
    '<div class="dialog-acts"><button data-a="0">取消</button><button data-a="1" class="danger">移除</button></div></div>';
  mask.querySelector('p').textContent = s2.title || '';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (ev2) {
    const b = ev2.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === '1') {
      const i = songs.findIndex(x => x.path === path);
      const cs = curSong();
      const wasPlaying = cs && cs.path === path;
      if (i >= 0) songs.splice(i, 1);
      // 音频正在放这个 → 停
      if (wasPlaying) { try { au.pause(); au.removeAttribute('src'); au.load(); } catch (e) {} cur = -1; }
      // 视频正在放这个 → 停并清空画面
      const vEl = document.getElementById('vid');
      if (vEl) {
        let cur2 = '';
        try { cur2 = decodeURI(vEl.currentSrc || '').replace('file://', ''); } catch (e) {}
        if (cur2 === path) {
          try { vEl.pause(); vEl.removeAttribute('src'); vEl.load(); } catch (e) {}
          const wr = document.querySelector('.vwrap');
          if (wr) {
            wr.style.height = '0px';
            wr.classList.remove('fullview');
          }
          const pg = document.getElementById('video');
          if (pg) { pg.classList.remove('fullpage'); if (pg.classList.contains('on')) {} }
          try { const f2 = document.getElementById('vFull'); if (f2) f2.textContent = '⛶'; } catch (e) {}
          try { if (typeof AndroidBridge !== 'undefined' && AndroidBridge.goFullscreen) AndroidBridge.goFullscreen(false, false); } catch (e) {}
        }
      }
      savePL();
      load();
      const vp = document.getElementById('video');
      if (vp && vp.style.display !== 'none') renderVideoList();
      toast2('已从列表移除');
    }
    mask.remove();
  });
}
window.delItem = delItem;

/* ================= 格式工具 ================= */
/* OUT_DIR 已在文件顶部声明 */

function toolSet(fn) {
  try { AndroidBridge.toolMkdir(OUT_DIR); } catch (e) {}
  return OUT_DIR + '/' + fn;
}

function baseName(p) {
  const b = p.split('/').pop() || 'file';
  return b.replace(/\.[^.]+$/, '');
}

function ensureOutDir() {
  try { AndroidBridge.toolMkdir(OUT_DIR); } catch (e) {}
}

function runJob(args, label) {
  ensureOutDir();
  if (window.__busy) { toast2('正在处理上一个任务，请稍候'); return; }
  window.__busy = true;
  try { AndroidBridge.logError('命令 ' + label + ' :: ' + JSON.stringify(args)); } catch (e) {}
  const st = document.getElementById('jobState');
  if (st) st.textContent = label + '：处理中…（大文件请耐心等）';
  const t0 = Date.now();
  window.__ffCb = function (id, res) {
    const s2 = String(res || '');
    const code = parseInt(s2.split('\n')[0], 10);
    const lines = s2.split('\n');
    const tail = lines.slice(-3).join(' ').slice(0, 200);
    window.__busy = false;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (code === 0) {
      if (st) st.textContent = label + '：完成（' + secs + ' 秒）';
      toast2('完成：' + label);
      if (window.__afterFf) { const f = window.__afterFf; window.__afterFf = null; f(0); }
      if (window.__lastOut) {
        const ov = document.getElementById('outPath');
        if (ov) ov.textContent = '输出完成：' + window.__lastOut;
        if (!songs.some(function (x) { return x.path === window.__lastOut; })) {
          songs.push({ id: window.__lastOut, title: baseName(window.__lastOut),
                       artist: '', album: '', dur: 0, path: window.__lastOut });
          savePL();
        }
        const addBtn = document.getElementById('addOut');
        if (addBtn) addBtn.style.display = 'block';
      }
    } else {
      if (st) st.textContent = label + '：失败（' + code + '）' + tail;
      const m = s2.match(/\[error\][^\n]*/g);
      const real = m && m.length ? m[m.length - 1] : tail;
      try { AndroidBridge.logError('FF失败 ' + label + ' code=' + code + ' :: ' + s2.slice(-800)); } catch (e) {}
      toast2('失败：' + String(real).slice(0, 120));
      if (window.__afterFf) { const f = window.__afterFf; window.__afterFf = null; f(code); }
    }
  };
  try { AndroidBridge.ffExec(JSON.stringify(args), 'job'); }
  catch (e) {
    if (st) st.textContent = '出错：' + e.message;
  }
}

function pickToolSrc(cb) {
  const old = window.__pickCb;
  window.__pickCb = cb;
  openFiles();
}

/* 转换 */
let TOOL_DUR = 0;
let CUT_A = 0, CUT_B = 0;

function fmtT(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
  return (h > 0 ? (h + ':' + String(m).padStart(2, '0')) : String(m)) + ':' + String(s2).padStart(2, '0');
}

function applyToolType(path) {
  const isVid = VID_EXT.test(path);
  document.querySelectorAll('[data-for]').forEach(function (el) {
    el.style.display = (el.dataset.for === 'video') === isVid ? '' : 'none';
  });
  const fmt = document.getElementById('fmtSel');
  if (fmt) {
    fmt.innerHTML = isVid
      ? '<option value="mp4">MP4（视频，H.264）</option><option value="webm">WebM（视频）</option><option value="mp3">只取音频（MP3）</option><option value="m4a">只取音频（M4A）</option>'
      : '<option value="mp3">MP3（音频，通用）</option>' +
        '<option value="mp4audio">MP4（音频轨 · 剪映等编辑器识别最好）</option>' +
        '<option value="m4a">M4A / AAC（音频）</option>' +
        '<option value="flac">FLAC（无损音频）</option>' +
        '<option value="wav">WAV（无损音频）</option>' +
        '<option value="ogg">OGG（音频）</option>';
  }
  const ex = document.getElementById('extractTitle');
  if (ex) ex.textContent = isVid ? '提取音频' : '转成通用音频';
}

function loadToolDuration() {
  if (TOOL_SRC) applyToolType(TOOL_SRC);
  let ms = 0;
  try { ms = AndroidBridge.mediaDurationMs(TOOL_SRC) || 0; } catch (e) { ms = 0; }
  TOOL_DUR = Math.max(0, Math.round(ms / 1000));
  CUT_A = 0; CUT_B = TOOL_DUR;
  const info = document.getElementById('cutInfo');
  if (info) info.textContent = TOOL_DUR > 0 ? ('总长 ' + fmtT(TOOL_DUR)) : '读不到时长（可手填数字秒）';
  syncCutUI();
}

function syncCutUI() {
  const ra = document.getElementById('cutStartR'), rb = document.getElementById('cutEndR');
  const la = document.getElementById('cutA'), lb = document.getElementById('cutB');
  const len = document.getElementById('cutLen');
  if (ra) { ra.value = TOOL_DUR ? (CUT_A / TOOL_DUR * 1000) : 0; }
  if (rb) { rb.value = TOOL_DUR ? (CUT_B / TOOL_DUR * 1000) : 1000; }
  if (la) la.textContent = '起 ' + fmtT(CUT_A);
  if (lb) lb.textContent = '止 ' + fmtT(CUT_B);
  if (len) len.textContent = '长度 ' + fmtT(Math.max(0, CUT_B - CUT_A));
}

function bindSliders() {
  const ra = document.getElementById('cutStartR'), rb = document.getElementById('cutEndR');
  if (!ra || !rb) return;
  ra.addEventListener('input', function () {
    if (!TOOL_DUR) return;
    CUT_A = Math.round(ra.value / 1000 * TOOL_DUR);
    if (CUT_A > CUT_B - 1) CUT_A = Math.max(0, CUT_B - 1);
    syncCutUI();
  });
  rb.addEventListener('input', function () {
    if (!TOOL_DUR) return;
    CUT_B = Math.round(rb.value / 1000 * TOOL_DUR);
    if (CUT_B < CUT_A + 1) CUT_B = Math.min(TOOL_DUR, CUT_A + 1);
    syncCutUI();
  });
}
bindSliders();

const applyBtn = document.getElementById('applyCutNum');
if (applyBtn) applyBtn.addEventListener('click', function () {
  const a = parseFloat(document.getElementById('cutStartT').value);
  const b = parseFloat(document.getElementById('cutEndT').value);
  if (!isNaN(a) && !isNaN(b) && b > a) {
    CUT_A = Math.max(0, Math.min(TOOL_DUR, a));
    CUT_B = Math.max(CUT_A + 1, Math.min(TOOL_DUR, b));
    syncCutUI();
    toast2('已应用到滑块');
  } else {
    toast2('请填两个数字秒，且结束大于开始');
  }
});

/* 平均分段：把文件按份数等分，每段单独输出（剪映等软件对超长文件不友好时用） */
function pickContainer(info) {
  if (info.video) return 'mp4';
  const a = (info.audio || '').toLowerCase();
  if (a.indexOf('aac') >= 0) return 'm4a';
  if (a.indexOf('mp3') >= 0) return 'mp3';   // mp3 / mp3float
  if (a.indexOf('flac') >= 0) return 'flac';
  if (a.indexOf('vorbis') >= 0 || a.indexOf('opus') >= 0) return 'ogg';
  if (a.indexOf('pcm') >= 0) return 'wav';
  return 'm4a';
}

function doSplitN() {
  if (!TOOL_SRC) { toast2('先选一个源文件'); return; }
  if (!TOOL_DUR) { toast2('读不到时长'); return; }
  if (window.__busy) { toast2('正在处理上一个任务，请稍候'); return; }
  const n = parseInt((document.getElementById('splitN') || {}).value || '3', 10);
  if (n < 2 || n > 10) { toast2('份数选 2~10'); return; }
  const st = document.getElementById('jobState');
  if (st) st.textContent = '正在分析格式…';
  window.__busy = true;
  // 先用系统判断（对怪扩展名更准）
  let kind = 0;
  try { kind = AndroidBridge.mediaKind(TOOL_SRC) || 0; } catch (e) {}
  if (kind > 0) {
    window.__busy = false;
    const isVid = (kind === 2);
    const info = { audio: isVid ? '' : 'aac', video: isVid ? 'h264' : '' };
    const ext = isVid ? 'mp4' : ((TOOL_SRC.match(/\.([^.]+)$/) || [null, ''])[1].toLowerCase() || 'm4a');
    const base = baseName(TOOL_SRC);
    const seg = TOOL_DUR / n;
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const a = Math.round(seg * i), b = (i === n - 1) ? TOOL_DUR : Math.round(seg * (i + 1));
      jobs.push({ a: a, b: b, out: toolSet(base + '_第' + (i + 1) + '段.' + ext), isVid: isVid });
    }
    runSplitJobs(jobs, 0, base);
    return;
  }
  probeMedia(TOOL_SRC, function (info) {
    if (!info.audio && !info.video) {
      const e0 = (TOOL_SRC.match(/\.([^.]+)$/) || [null, ''])[1].toLowerCase();
      if (e0 === 'mp3') info.audio = 'mp3';
      else if (e0 === 'm4a' || e0 === 'mp4' || e0 === 'aac') info.audio = 'aac';
      else if (e0 === 'flac') info.audio = 'flac';
      else if (e0 === 'wav') info.audio = 'pcm';
    }
    window.__busy = false;
    const ext = pickContainer(info);
    const isVid = !!info.video;
    const base = baseName(TOOL_SRC);
    const seg = TOOL_DUR / n;
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const a = Math.round(seg * i), b = (i === n - 1) ? TOOL_DUR : Math.round(seg * (i + 1));
      const out = toolSet(base + '_第' + (i + 1) + '段.' + ext);
      jobs.push({ a: a, b: b, out: out, isVid: isVid });
    }
    runSplitJobs(jobs, 0, base);
  });
}

function runSplitJobs(jobs, i, base) {
  const st = document.getElementById('jobState');
  if (i >= jobs.length) {
    if (st) st.textContent = '分段完成：共 ' + jobs.length + ' 段 → ' + OUT_DIR;
    toast2('分段完成，共 ' + jobs.length + ' 段');
    return;
  }
  const jb = jobs[i];
  if (st) st.textContent = '分段中 ' + (i + 1) + '/' + jobs.length + '…';
  const args = ['-y', '-ss', fmtT(jb.a), '-to', fmtT(jb.b), '-i', TOOL_SRC]
    .concat(jb.isVid ? ['-c', 'copy'] : ['-vn', '-c:a', 'copy'])
    .concat([jb.out]);
  window.__lastOut = jb.out;
  window.__afterFf = function (code) {
    if (code === 0) setTimeout(function () { runSplitJobs(jobs, i + 1, base); }, 150);
    else {
      if (st) st.textContent = '第 ' + (i + 1) + ' 段失败，已停止';
      toast2('第 ' + (i + 1) + ' 段失败');
    }
  };
  runJob(args, '第 ' + (i + 1) + '/' + jobs.length + ' 段');
}

function doConvert() {
  if (!TOOL_SRC) { toast2('先选一个源文件'); return; }
  const fmt = document.getElementById('fmtSel').value;
  const isVid = VID_EXT.test(TOOL_SRC);
  const realFmt = (fmt === 'mp4audio') ? 'mp4' : fmt;
  const out = toolSet(baseName(TOOL_SRC) + '_转换.' + realFmt);
  const args = ['-y', '-i', TOOL_SRC];
  if (fmt === 'mp4audio') {
    // 只有音频轨的 MP4：编辑软件最稳
    args.push('-vn', '-c:a', 'aac', '-b:a', '192k');
  } else if (fmt === 'mp3' || fmt === 'm4a' || fmt === 'flac' || fmt === 'wav' || fmt === 'ogg') {
    args.push('-vn');
  }
  if (fmt === 'mp3') args.push('-vn', '-acodec', 'libmp3lame', '-b:a', '256k');
  else if (fmt === 'm4a') args.push('-vn', '-acodec', 'aac', '-b:a', '256k');
  else if (fmt === 'flac') args.push('-vn', '-acodec', 'flac');
  else if (fmt === 'wav') args.push('-vn', '-acodec', 'pcm_s16le');
  else if (fmt === 'ogg') args.push('-vn', '-acodec', 'libvorbis', '-q:a', '6');
  else if (fmt === 'mp4') args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '192k');
  else if (fmt === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus');
  args.push(out);
  window.__lastOut = out;
  runJob(args, '转换为 ' + fmt.toUpperCase());
}

/* 剪切 */
function doCut() {
  if (!TOOL_SRC) { toast2('先选一个源文件'); return; }
  if (!TOOL_DUR) { toast2('读不到这个文件的时长，换个文件试试'); return; }
  if (CUT_B - CUT_A < 1) { toast2('结束时间要比开始时间晚'); return; }
  const st_ = fmtT(CUT_A);
  const en_ = fmtT(CUT_B);
  const ext = (TOOL_SRC.match(/\.([^.]+)$/) || [null, 'mp3'])[1].toLowerCase();
  const out = toolSet(baseName(TOOL_SRC) + '_剪切.' + ext);
  const args = ['-y', '-ss', st_, '-to', en_, '-i', TOOL_SRC, '-c', 'copy', out];
  window.__lastOut = out;
  runJob(args, '剪切 ' + st_ + ' → ' + en_);
}

/* 提取音频 */
function doExtract() {
  if (!TOOL_SRC) { toast2('先选一个源文件'); return; }
  const out = toolSet(baseName(TOOL_SRC) + '_音频.mp3');
  window.__lastOut = out;
  runJob(['-y', '-i', TOOL_SRC, '-vn', '-acodec', 'libmp3lame', '-b:a', '256k', out], '提取音频');
}

/* 合并：用播放列表里的音频 */
function doMerge() {
  if (!songs.length) { toast2('播放列表是空的'); return; }
  const listFile = '/data/data/com.dafish.media/cache/merge.txt';
  const out = toolSet('合并_' + Date.now() + '.mp3');
  const lines = songs.map(x => "file '" + x.path.replace(/'/g, "'\\''") + "'").join('\n');
  window.__mergeWrite = function (ok) {
    if (!ok) { toast2('写清单失败'); return; }
    window.__lastOut = out;
    runJob(['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
            '-acodec', 'libmp3lame', '-b:a', '256k', out], '合并 ' + songs.length + ' 个文件');
  };
  try { AndroidBridge.writeFile(listFile, lines + '\n'); }
  catch (e) { toast2('写清单失败：' + e.message); }
}

/* 修复 / 重封装：分析后按实际编码选容器，避免把 AAC 塞进 mp3 */
const PROBE_CACHE = {};

const PROBE_WAIT = {};

function probeMedia(path, cb) {
  if (PROBE_CACHE[path]) { cb(PROBE_CACHE[path]); return; }
  const id = 'p' + Date.now() + Math.floor(Math.random() * 1000);
  let done = false;
  const finish = function (out) {
    if (done) return;
    done = true;
    delete PROBE_WAIT[id];
    const text = String(out || '');
    let audio = '', video = '';
    const am = text.match(/Audio:\s*([A-Za-z0-9_\-]+)/i);
    const vm = text.match(/Video:\s*([A-Za-z0-9_\-]+)/i);
    if (am) audio = am[1].toLowerCase();
    if (vm) video = vm[1].toLowerCase();
    if (!audio && !video) {
      const e = (path.match(/\.([A-Za-z0-9]{1,6})$/) || [null, ''])[1].toLowerCase();
      if (e === 'mp3') audio = 'mp3';
      else if (e === 'm4a' || e === 'mp4' || e === 'aac') audio = 'aac';
      else if (e === 'flac') audio = 'flac';
      else if (e === 'wav') audio = 'pcm';
      else if (e === 'mkv' || e === 'avi' || e === 'mov') video = 'unknown';
    }
    const info = { audio: audio, video: video };
    PROBE_CACHE[path] = info;
    try { AndroidBridge.logError('探测结果 ' + path.split('/').pop() + ' => ' + JSON.stringify(info)); } catch (e) {}
    cb(info);
  };
  PROBE_WAIT[id] = finish;
  // 超时保护
  setTimeout(function () { finish(''); }, 8000);
  try { AndroidBridge.ffProbe(JSON.stringify(['-hide_banner', '-i', path]), id); }
  catch (e) { finish(''); }
}

window.onFfProbe = function (id, out) {
  const f = PROBE_WAIT[id];
  if (f) f(out);
};

function doFix() {
  if (!TOOL_SRC) { toast2('先选一个源文件'); return; }
  const rank = parseInt((document.getElementById('fixMode') || {}).value || '0', 10);
  window.__fixArgs = { rank: rank };
  toast2('正在分析文件…');
  probeMedia(TOOL_SRC, function (info) {
    if (!info.audio && !info.video) {
      // 探测不出来：直接走彻底模式，保证产出可用
      const out0 = toolSet(baseName(TOOL_SRC) + '_修复.mp3');
      window.__lastOut = out0;
      runJob(['-y', '-err_detect', 'ignore_err', '-i', TOOL_SRC, '-vn',
              '-acodec', 'libmp3lame', '-b:a', '192k', out0], '重新编码修复');
      return;
    }
    // 音频编码 → 合适的容器
    let ext = 'm4a';
    if (info.audio.indexOf('mp3') >= 0) ext = 'mp3';
    else if (info.audio.indexOf('flac') >= 0) ext = 'flac';
    else if (info.audio.indexOf('vorbis') >= 0 || info.audio.indexOf('opus') >= 0) ext = 'ogg';
    else if (info.audio.indexOf('pcm') >= 0) ext = 'wav';
    const curExt = (TOOL_SRC.match(/\.([A-Za-z0-9]{1,6})$/) || [null, ''])[1].toLowerCase();
    const sameFam = (curExt === ext) ||
                    (ext === 'm4a' && (curExt === 'mp4' || curExt === 'm4a')) ||
                    (ext === 'mp3' && curExt === 'mp3');
    if (rank === 0 && !sameFam) {
      // 扩展名会变 → 不能 -c copy，自动改走重新编码
      toast2('需要换容器，已自动改用重新编码');
      rank = 1;
    }
    const out = toolSet(baseName(TOOL_SRC) + '_修复.' + (rank === 1 ? 'mp3' : ext));
    window.__lastOut = out;
    const args = ['-y', '-err_detect', 'ignore_err', '-i', TOOL_SRC];
    if (rank === 1) {
      // 稳：重新编码成 mp3
      runJob(args.concat(['-vn', '-acodec', 'libmp3lame', '-b:a', '192k', out]), '重新编码修复');
    } else {
      runJob(args.concat(['-c', 'copy', out]), '快速修复 → ' + ext);
    }
  });
}

/* 绑定工具页按钮 */
const pickSrcBtn = document.getElementById('pickSrc');
if (pickSrcBtn) pickSrcBtn.addEventListener('click', function () {
  window.__pickMode = 'tool';
  window.__from = 'tool';
  openFiles();
});
[['doConvert', doConvert], ['doCut', doCut], ['doExtract', doExtract],
 ['doMerge', doMerge], ['doFix', doFix]].forEach(function (pair) {
  const el = document.getElementById(pair[0]);
  if (el) el.addEventListener('click', pair[1]);
});
const toolBackBtn = document.getElementById('toolBack');
if (toolBackBtn) toolBackBtn.addEventListener('click', function () { showScreen('home'); });

/* ================= 设置与后台播放 ================= */
try { BG_PLAY = localStorage.getItem('bgPlay') === '1'; } catch (e) {}
const bgSw = document.getElementById('bgSwitch');
if (bgSw) {
  bgSw.checked = BG_PLAY;
  bgSw.addEventListener('change', function () {
    BG_PLAY = bgSw.checked;
    try { localStorage.setItem('bgPlay', BG_PLAY ? '1' : '0'); } catch (e) {}
    toast2(BG_PLAY ? '后台播放已开启' : '后台播放已关闭');
    if (!BG_PLAY) {
      try { AndroidBridge.stopBgPlay(); } catch (e) {}
      bgActive = false;
      if (!au.paused) au.pause();      // 关掉后台播放 → 立即暂停（进度会保存在 pause 里）
    } else if (!au.paused) {
      startBg();
    }
  });
}
function openSettings() {
  const p = document.getElementById('settingPanel');
  const m = document.getElementById('mask');
  if (p) p.classList.add('show');
  if (m) m.classList.add('show');
}

const setBtn = document.getElementById('btnSettings');
if (setBtn) setBtn.addEventListener('click', openSettings);

const maskEl = document.getElementById('mask');
if (maskEl) maskEl.addEventListener('click', closeSettings);
const setClose = document.getElementById('setClose');
if (setClose) setClose.addEventListener('click', closeSettings);

function closeSettings() {
  const p = document.getElementById('settingPanel');
  const m = document.getElementById('mask');
  if (p) p.classList.remove('show');
  if (m) m.classList.remove('show');
}

function startBg() {
  if (!BG_PLAY) return;
  const cs = curSong();
  if (!cs) return;
  try {
    AndroidBridge.startBgPlay(cs.title || '', cs.artist || '', !au.paused);
    bgActive = true;
  } catch (e) {}
}

function updateBg() {
  if (!BG_PLAY || !bgActive) return;
  const cs = curSong();
  if (!cs) return;
  try { AndroidBridge.updateBgPlay(cs.title || '', cs.artist || '', !au.paused); } catch (e) {}
}

function stopBg() {
  if (!bgActive) return;
  bgActive = false;
  try { AndroidBridge.stopBgPlay(); } catch (e) {}
}

/* 通知栏操作 */
/* 从别的应用「打开方式」传进来的音视频 */
function playExternal(r, isVid) {
  if (isVid) {
    showVideo();
    setTimeout(function () {
      const v = { path: r.path, title: (r.name || '').replace(/\.[^.]+$/, '') };
      playVideo(v);
    }, 350);
  } else {
    showScreen('audio');
    load();
    setTimeout(function () {
      const i = view.findIndex(function (x) { return x.path === r.path; });
      try { AndroidBridge.logError('音频播放: view=' + view.length + ' idx=' + i + ' path=' + r.path.slice(-30)); } catch (e) {}
      if (i >= 0) { playIndex(i); }
      else {
        // 找不到就按标题再找一次
        const t = (r.name || '').replace(/\.[^.]+$/, '');
        const j = view.findIndex(function (x) { return x.title === t; });
        if (j >= 0) playIndex(j);
        else toast2('已加入列表，请手动点击播放');
      }
    }, 600);
  }
}

window.onExternalMedia = function (json) {
  let r = {};
  try { r = JSON.parse(json || '{}'); } catch (e) {}
  try { AndroidBridge.logError('外部文件: ' + JSON.stringify(r)); } catch (e) {}
  if (!r.path) { toast2('这个文件打不开'); return; }
  const baseName2 = function (p) { return decodeURI(String(p || '').split('/').pop()); };
  const addOrUpdate = function (type) {
    // ① 路径完全相同
    let ex = songs.find(function (x) { return x.path === r.path; });
    // ② 同文件名（去掉时间戳前缀）也认为同一个
    if (!ex) {
      const nb = baseName2(r.path).replace(/^\d+_/, '');     // 去掉旧版时间戳前缀
      ex = songs.find(function (x) {
        const ob = baseName2(x.path).replace(/^\d+_/, '');
        return ob === nb || (x.title && r.name && x.title === (r.name || '').replace(/\.[^.]+$/, ''));
      });
    }
    if (ex) {
      ex.type = type;
      // 清掉可能残留的时间戳前缀
      if (/^\d+_/.test(baseName2(ex.path))) ex.title = (r.name || ex.title || '').replace(/\.[^.]+$/, '');
    } else {
      songs.push({
        id: r.path, title: (r.name || '').replace(/\.[^.]+$/, ''),
        artist: '', album: '', dur: 0, path: r.path, type: type
      });
    }
    // 顺手清理历史遗留的重复项（同标题同类型只保留第一个）
    const seen = {};
    songs = songs.filter(function (x) {
      const key = (x.title || '') + '|' + (x.type || '') + '|' + baseName2(x.path).replace(/^\d+_/, '');
      if (seen[key]) return false;
      seen[key] = 1;
      return true;
    });
    savePL();
  };

  const isVid = VID_EXT.test(r.path);
  const isAud = AUD_EXT.test(r.path);
  if (isVid) { addOrUpdate('video'); playExternal(r, true); return; }
  if (isAud) { addOrUpdate('audio'); playExternal(r, false); return; }

  // ① 先用系统 MediaMetadataRetriever 判断（对怪扩展名更准）
  let kind = 0;
  try { kind = AndroidBridge.mediaKind(r.path) || 0; } catch (e) { kind = 0; }
  try { AndroidBridge.logError('系统判断 kind=' + kind + ' (' + r.name + ')'); } catch (e) {}
  if (kind === 2) { addOrUpdate('video'); playExternal(r, true); return; }
  if (kind === 1) { addOrUpdate('audio'); playExternal(r, false); return; }

  // ② 系统也认不出 → 用 ffprobe
  toast2('正在识别文件类型…');
  probeMedia(r.path, function (info) {
    const type = info.video ? 'video' : 'audio';
    try { AndroidBridge.logError('ffprobe 结果: ' + JSON.stringify(info) + ' => ' + type); } catch (e) {}
    addOrUpdate(type);
    playExternal(r, type === 'video');
  });
};
/* 离开应用：后台播放没开就停止 */
window.onAppBackground = function () {
  try {
    const cs = curSong();
    if (cs && au.currentTime > 1) {
      const d = (isFinite(au.duration) && au.duration > 0) ? au.duration : (cs.dur ? cs.dur / 1000 : 0);
      if (d > 0) memSave(cs.path, au.currentTime, d);
    }
    if (BG_PLAY) return;                    // 开了后台播放 → 继续
    if (!au.paused) { au.pause(); }
    const v = document.getElementById('vid');
    if (v && !v.paused) v.pause();
    stopBg();
    toast2('已停止播放（后台播放未开启）');
  } catch (e) {}
};

/* 兜底：不依赖原生回调，用 visibility 判断是否离开 */
const BG_GUARD = { timer: 0, hidden: false };

function bgGuardTick() {
  try {
    let hidden = document.hidden || document.visibilityState === 'hidden';
    // 计时器兜底：如果两次 tick 间隔明显变长，说明被系统节流（多半在后台）
    const now = Date.now();
    if (BG_GUARD.lastTick && (now - BG_GUARD.lastTick) > 1500) hidden = true;
    BG_GUARD.lastTick = now;
    const v = document.getElementById('vid');
    const atPlaying = au && au.currentTime > 0 && !au.paused;
    if (hidden && !BG_GUARD.hidden) {
      BG_GUARD.hidden = true;
      if (!BG_PLAY) {
        const cs = curSong();
        if (cs && au && au.currentTime > 0) {
          const d = (isFinite(au.duration) && au.duration > 0) ? au.duration : (cs.dur ? cs.dur / 1000 : 0);
          if (d > 0) memSave(cs.path, au.currentTime, d);
        }
        if (!au.paused) au.pause();
        if (v && !v.paused) v.pause();
        stopBg();
        toast2('已停止播放（后台播放未开启）');
      }
    } else if (!hidden && BG_GUARD.hidden) {
      BG_GUARD.hidden = false;
    }
  } catch (e) {}
}

function startBgGuard() {
  if (BG_GUARD.timer) return;
  BG_GUARD.timer = setInterval(bgGuardTick, 500);
  document.addEventListener('visibilitychange', bgGuardTick);
}

window.onPlayAction = function (what) {
  if (what === 'toggle') { if (au.paused) au.play().catch(function(){}); else au.pause(); }
  else if (what === 'next') next(1);
  else if (what === 'prev') next(-1);
  else if (what === 'stop') { au.pause(); stopBg(); }
};

try {
  if (typeof AndroidBridge !== 'undefined' && AndroidBridge.getOutDir) {
    const od = AndroidBridge.getOutDir();
    if (od) OUT_DIR = od;
  }
} catch (e) {}
(function () {
  const el = document.getElementById('outPath');
  if (el) el.textContent = OUT_DIR.endsWith('/') ? OUT_DIR : (OUT_DIR + '/');
})();

document.querySelectorAll('[data-for="video"]').forEach(function (el) { el.style.display = 'none'; });
showScreen('home');


/* ================= 外部导入缓存清理 ================= */
function cleanIncomingCache(manual) {
  try {
    if (typeof AndroidBridge === 'undefined' || !AndroidBridge.cleanIncoming) return;
    const used = songs.map(function (x) { return x.path; });
    const r = AndroidBridge.cleanIncoming(JSON.stringify(used));
    try { AndroidBridge.logError('清理缓存结果: ' + r + ' (在用 ' + used.length + ')'); } catch (e) {}
    if (manual) {
      const parts = String(r || '').split(' ');
      const removed = parseInt(parts[2], 10) || 0;
      toast2(removed > 0 ? ('已清理 ' + removed + ' 个缓存文件') : '没有多余缓存');
    }
  } catch (e) {
    try { AndroidBridge.logError('清理缓存出错: ' + e.message); } catch (x) {}
  }
}

/* 启动后清理一次 */
setTimeout(function () { cleanIncomingCache(false); }, 1500);

/* 主页入口已移除，改到设置面板 */


/* ================= 运行日志 ================= */
function openLog() {
  const p = document.getElementById('logPanel');
  if (p) p.classList.add('show');
  renderLog();
}

function renderLog() {
  const b = document.getElementById('logBody');
  if (!b) return;
  let t = '';
  try { t = AndroidBridge.readLog(400); } catch (e) { t = '读取失败：' + e.message; }
  b.textContent = t || '（暂无日志）';
  b.scrollTop = b.scrollHeight;
}

(function () {
  const btn = document.getElementById('btnLog');
  if (btn) btn.addEventListener('click', function () { closeSettings(); openLog(); });
  const x = document.getElementById('logClose');
  if (x) x.addEventListener('click', function () { document.getElementById('logPanel').classList.remove('show'); });
  const r = document.getElementById('logRefresh');
  if (r) r.addEventListener('click', renderLog);
  const cl = document.getElementById('logClear');
  if (cl) cl.addEventListener('click', function () {
    try { AndroidBridge.clearLog(); } catch (e) {}
    renderLog();
    toast2('日志已清空');
  });
  const cp = document.getElementById('logCopy');
  if (cp) cp.addEventListener('click', function () {
    const b = document.getElementById('logBody');
    const t = b ? b.textContent : '';
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast2('已复制');
    } catch (e) { toast2('复制失败'); }
  });
})();


/* ================= 批量操作 ================= */
function renderBatchCount() {
  const n = Object.keys(SEL).length;
  const c = document.getElementById('bCount');
  if (c) c.textContent = '已选 ' + n + ' 项';
  const b = document.getElementById('btnSel');
  if (b) b.textContent = SEL_MODE ? '完成' : '选择';
}

function toggleSelMode() {
  SEL_MODE = !SEL_MODE;
  if (!SEL_MODE) { Object.keys(SEL).forEach(function (k) { delete SEL[k]; }); }
  const bar = document.getElementById('batchBar');
  if (bar) bar.classList.toggle('show', SEL_MODE);
  render();
  renderBatchCount();
}

function selList() { return Object.keys(SEL); }

function batchSelectAll() {
  const all = view.map(function (x) { return x.path; });
  const allSel = all.every(function (p) { return SEL[p]; });
  Object.keys(SEL).forEach(function (k) { delete SEL[k]; });
  if (!allSel) all.forEach(function (p) { SEL[p] = 1; });
  render();
  renderBatchCount();
}

async function batchDelete() {
  const list = selList();
  if (!list.length) { toast2('先选择要删除的项目'); return; }
  const mask = document.createElement('div');
  mask.className = 'dialog-mask';
  mask.innerHTML = '<div class="dialog"><h4>删除 ' + list.length + ' 项？</h4>' +
    '<p>只从播放列表移除，不会删除手机里的文件。</p>' +
    '<div class="dialog-acts"><button data-a="0">取消</button>' +
    '<button data-a="1" class="danger">删除</button></div></div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (ev) {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === '1') {
      const cur = curSong();
      const wasPlaying = cur && list.indexOf(cur.path) >= 0;
      songs = songs.filter(function (x) { return list.indexOf(x.path) < 0; });
      if (wasPlaying) { try { au.pause(); au.removeAttribute('src'); au.load(); } catch (e) {} cur = -1; }
      const vEl = document.getElementById('vid');
      if (vEl) {
        let c2 = '';
        try { c2 = decodeURI(vEl.currentSrc || '').replace('file://', ''); } catch (e) {}
        if (list.indexOf(c2) >= 0) {
          try { vEl.pause(); vEl.removeAttribute('src'); vEl.load(); } catch (e) {}
          const wr = document.querySelector('.vwrap'); if (wr) wr.style.height = '0px';
        }
      }
      savePL();
      Object.keys(SEL).forEach(function (k) { delete SEL[k]; });
      render();
      renderBatchCount();
      toast2('已删除 ' + list.length + ' 项');
    }
    mask.remove();
  });
}

function moveSelected(selList, isType, dir) {
  if (!selList.length) { toast2('先选择要移动的项目'); return; }
  // 取出同类型的下标
  const typeIdx = [];
  songs.forEach(function (x, i) { if (isType(x)) typeIdx.push(i); });
  const seq = typeIdx.map(function (i) { return songs[i]; });
  const selSet = {};
  selList.forEach(function (p) { selSet[p] = 1; });

  const selPos = [];
  seq.forEach(function (x, i) { if (selSet[x.path]) selPos.push(i); });
  if (!selPos.length) return;

  // 边界
  if (dir < 0 && selPos[0] === 0) { toast2('已经在最前了'); return; }
  if (dir > 0 && selPos[selPos.length - 1] === seq.length - 1) { toast2('已经在最后了'); return; }

  // 相邻交换（不选中项之间交换）
  if (dir > 0) {
    for (let k = selPos.length - 1; k >= 0; k--) {
      const i = selPos[k];
      if (i + 1 < seq.length && !selSet[seq[i + 1].path]) {
        const t = seq[i]; seq[i] = seq[i + 1]; seq[i + 1] = t;
      }
    }
  } else {
    for (let k = 0; k < selPos.length; k++) {
      const i = selPos[k];
      if (i - 1 >= 0 && !selSet[seq[i - 1].path]) {
        const t = seq[i]; seq[i] = seq[i - 1]; seq[i - 1] = t;
      }
    }
  }

  // 写回
  for (let k = 0; k < typeIdx.length; k++) songs[typeIdx[k]] = seq[k];
  savePL();
  try {
    AndroidBridge.logError('移动 dir=' + dir + ' => ' +
      seq.map(function (x) { return (x.title || '').slice(0, 6); }).join('|'));
  } catch (e) {}
}

function isAudioItem(x) {
  if (x.type) return x.type === 'audio';
  return AUD_EXT.test(x.path);
}

function isVideoItem(x) {
  if (x.type) return x.type === 'video';
  return VID_EXT.test(x.path);
}

function batchMove(dir) {
  moveSelected(selList(), isAudioItem, dir);
  render();
  renderBatchCount();
  toast2('已' + (dir < 0 ? '上移' : '下移'));
}

(function () {
  const b1 = document.getElementById('btnSel');
  if (b1) b1.addEventListener('click', toggleSelMode);
  const b2 = document.getElementById('bCancel');
  if (b2) b2.addEventListener('click', toggleSelMode);
  const b3 = document.getElementById('bAll');
  if (b3) b3.addEventListener('click', batchSelectAll);
  const b4 = document.getElementById('bDel');
  if (b4) b4.addEventListener('click', batchDelete);
  const b5 = document.getElementById('bMoveUp');
  if (b5) b5.addEventListener('click', function () { batchMove(-1); });
  const b6 = document.getElementById('bMoveDown');
  if (b6) b6.addEventListener('click', function () { batchMove(1); });
})();


/* ================= 视频批量操作 ================= */
function renderVBatchCount() {
  const n = Object.keys(VSEL).length;
  const c = document.getElementById('vbCount');
  if (c) c.textContent = '已选 ' + n + ' 项';
  const b = document.getElementById('vSel');
  if (b) b.textContent = VSEL_MODE ? '完成' : '选择';
}

function toggleVSelMode() {
  VSEL_MODE = !VSEL_MODE;
  if (!VSEL_MODE) { Object.keys(VSEL).forEach(function (k) { delete VSEL[k]; }); }
  const bar = document.getElementById('vBatchBar');
  if (bar) bar.classList.toggle('show', VSEL_MODE);
  renderVideoList();
  renderVBatchCount();
}

function vSelList() { return Object.keys(VSEL); }

function vBatchAll() {
  const vids = songs.filter(function (x) {
    if (x.type) return x.type === 'video';
    return VID_EXT.test(x.path);
  });
  const all = vids.map(function (x) { return x.path; });
  const allSel = all.length && all.every(function (p) { return VSEL[p]; });
  Object.keys(VSEL).forEach(function (k) { delete VSEL[k]; });
  if (!allSel) all.forEach(function (p) { VSEL[p] = 1; });
  renderVideoList();
  renderVBatchCount();
}

function vBatchDelete() {
  const list = vSelList();
  if (!list.length) { toast2('先选择要删除的项目'); return; }
  const mask = document.createElement('div');
  mask.className = 'dialog-mask';
  mask.innerHTML = '<div class="dialog"><h4>删除 ' + list.length + ' 个视频？</h4>' +
    '<p>只从播放列表移除，不会删除手机里的文件。</p>' +
    '<div class="dialog-acts"><button data-a="0">取消</button>' +
    '<button data-a="1" class="danger">删除</button></div></div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (ev) {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === '1') {
      const vEl = document.getElementById('vid');
      let cur2 = '';
      try { cur2 = decodeURI(vEl.currentSrc || '').replace('file://', ''); } catch (e) {}
      if (vEl && list.indexOf(cur2) >= 0) {
        try { vEl.pause(); vEl.removeAttribute('src'); vEl.load(); } catch (e) {}
        const wr = document.querySelector('.vwrap'); if (wr) wr.style.height = '0px';
      }
      songs = songs.filter(function (x) { return list.indexOf(x.path) < 0; });
      savePL();
      Object.keys(VSEL).forEach(function (k) { delete VSEL[k]; });
      renderVideoList();
      renderVBatchCount();
      toast2('已删除 ' + list.length + ' 个');
    }
    mask.remove();
  });
}

function vBatchMove(dir) {
  moveSelected(vSelList(), isVideoItem, dir);
  renderVideoList();
  renderVBatchCount();
  toast2('已' + (dir < 0 ? '上移' : '下移'));
}

(function () {
  const b1 = document.getElementById('vSel');
  if (b1) b1.addEventListener('click', toggleVSelMode);
  const b2 = document.getElementById('vbCancel');
  if (b2) b2.addEventListener('click', toggleVSelMode);
  const b3 = document.getElementById('vbAll');
  if (b3) b3.addEventListener('click', vBatchAll);
  const b4 = document.getElementById('vbDel');
  if (b4) b4.addEventListener('click', vBatchDelete);
  const b5 = document.getElementById('vbUp');
  if (b5) b5.addEventListener('click', function () { vBatchMove(-1); });
  const b6 = document.getElementById('vbDown');
  if (b6) b6.addEventListener('click', function () { vBatchMove(1); });
})();
