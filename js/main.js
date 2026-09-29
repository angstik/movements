import { extractPoses } from './pose.js';
import { assignIdentities, swapFrom } from './tracker.js';
import { reconstruct } from './reconstruct.js';
import { computeMetrics, METRICS, PAIR_METRICS } from './biomech.js';
import { drawOverlay } from './overlay.js';
import { Scene3D } from './scene3d.js';
import { ChartPanel } from './charts.js';
import * as library from './library.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');

const state = {
  fileName: '',
  extraction: null, // {width, height, fps, frames:[{t, detections}]}
  assigned: null,   // [[A|null, B|null]]
  recon: null,
  metrics: null,
  times: null,
  current: 0,
  cancel: false,
  busy: false,
  libraryId: null,      // entrée de bibliothèque de la vidéo courante
  pendingKeep: null,    // fichier à ajouter à la bibliothèque une fois les métadonnées lues
  pendingAnalysis: null, // analyse à restaurer une fois la vidéo chargée
};
const isTouch = matchMedia('(pointer: coarse)').matches;

const DEFAULT_METRICS = ['comY', 'margin', 'comDist', 'bearingBA', 'trunkTilt', 'kneeL', 'kneeR', 'pelvisYawRate'];
let selectedMetrics = new Set(DEFAULT_METRICS);
try {
  const saved = JSON.parse(localStorage.getItem('aiki.metrics') || 'null');
  if (Array.isArray(saved) && saved.length) selectedMetrics = new Set(saved);
} catch { /* stockage indisponible */ }

// ---------- thème ----------
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function colors() { return [cssVar('--series-a'), cssVar('--series-b')]; }
function applyTheme() {
  scene.setColors(colors(), cssVar('--text-primary'));
  scene.setTheme({ grid: cssVar('--grid-3d'), gridMinor: cssVar('--grid-3d-minor') });
  if (state.metrics) buildCharts();
  render();
}
$('themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('aiki.theme', root.dataset.theme); } catch { /* ignore */ }
  applyTheme();
});
try {
  const t = localStorage.getItem('aiki.theme');
  if (t) document.documentElement.dataset.theme = t;
} catch { /* ignore */ }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- vues ----------
const scene = new Scene3D($('view3d'));
const charts = new ChartPanel($('charts'), { onSeek: (t) => { video.currentTime = t; } });

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  scene.setView(b.dataset.view);
  $('follow').checked = scene.follow;
  document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
}));
$('follow').addEventListener('change', (e) => { scene.follow = e.target.checked; });

function setStatus(msg) { $('status').textContent = msg; }
function names() { return [$('nameA').value || 'A', $('nameB').value || 'B']; }

// ---------- chargement vidéo ----------
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|3gp)$/i;

// Certaines galeries mobiles ne renseignent pas le type MIME : on accepte aussi par extension.
function loadVideoFile(file, { libraryId = null, analysis = null } = {}) {
  if (!file || !((file.type || '').startsWith('video/') || VIDEO_EXT.test(file.name || ''))) {
    setStatus('Fichier non vidéo.');
    return;
  }
  state.fileName = file.name || 'video';
  state.libraryId = libraryId;
  state.pendingKeep = libraryId ? null : file;
  state.pendingAnalysis = analysis;
  if (video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
  video.src = URL.createObjectURL(file);
  video.load();
}
for (const id of ['fileInput', 'captureInput']) {
  $(id).addEventListener('change', (e) => {
    loadVideoFile(e.target.files[0]);
    e.target.value = '';
  });
}

// Vidéo par adresse : téléchargée en mémoire (le serveur doit autoriser CORS).
$('urlBtn').addEventListener('click', async () => {
  const url = prompt('Adresse directe d\'un fichier vidéo (.mp4, .webm…) :');
  if (!url) return;
  if (/(^|\.)(youtube\.com|youtu\.be)\//i.test(url.replace(/^https?:\/\//, ''))) {
    setStatus('YouTube ne fournit pas de fichier vidéo lisible par une page web (flux protégé, pas de CORS). '
      + 'Téléchargez la vidéo à part (si vous en avez le droit), puis ouvrez le fichier ici.');
    return;
  }
  try {
    setStatus('Téléchargement de la vidéo…');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'video.mp4');
    loadVideoFile(new File([blob], name, { type: blob.type || 'video/mp4' }));
  } catch (err) {
    setStatus(`Téléchargement impossible (${err.message}). Le serveur doit autoriser l'accès (CORS) ; sinon, téléchargez le fichier puis ouvrez-le.`);
  }
});
const stage = $('stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('dragover');
  loadVideoFile(e.dataTransfer.files[0]);
});

// Certains WebM (MediaRecorder) n'indiquent pas leur durée : on la force en cherchant la fin.
async function ensureDuration() {
  if (Number.isFinite(video.duration)) return;
  await new Promise((resolve) => {
    video.addEventListener('durationchange', function onChange() {
      if (!Number.isFinite(video.duration)) return;
      video.removeEventListener('durationchange', onChange);
      resolve();
    });
    video.currentTime = 1e9;
  });
  video.currentTime = 0;
}

video.addEventListener('loadedmetadata', async () => {
  await ensureDuration();
  $('dropHint').hidden = true;
  stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  $('seek').max = video.duration;
  $('tStart').value = 0;
  $('tEnd').value = video.duration.toFixed(2);
  $('analyzeBtn').disabled = false;
  const sameVideo = state.extraction && state.extraction.width === video.videoWidth && state.extraction.height === video.videoHeight;
  if (!sameVideo) resetAnalysis();
  setStatus(`${state.fileName} — ${video.videoWidth}×${video.videoHeight}, ${video.duration.toFixed(2)} s.${sameVideo ? ' Analyse chargée conservée.' : ''}`);
  if (state.pendingAnalysis) {
    const data = state.pendingAnalysis;
    state.pendingAnalysis = null;
    applyAnalysisData(data);
    setStatus(`${state.fileName} — analyse restaurée depuis la bibliothèque (${data.frames.length} images).`);
  }
  if (state.pendingKeep && $('autoKeep').checked) await keepInLibrary(state.pendingKeep);
  state.pendingKeep = null;
  render();
});

async function keepInLibrary(file) {
  try {
    // Vignette prise à 1 s (la première image est souvent noire).
    const t = Math.min(1, video.duration / 2);
    video.currentTime = t;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    const thumb = library.makeThumbnail(video);
    video.currentTime = 0;
    state.libraryId = await library.addVideo({
      name: state.fileName, blob: file, duration: video.duration,
      width: video.videoWidth, height: video.videoHeight, thumb,
    });
    library.requestPersistence();
  } catch (err) {
    console.warn(err);
    setStatus(`Vidéo non ajoutée à la bibliothèque (${err.name === 'QuotaExceededError' ? 'espace de stockage insuffisant' : err.message}).`);
  }
}
video.addEventListener('error', () => setStatus('Lecture impossible : format ou codec non pris en charge par ce navigateur (essayez H.264/MP4).'));

function resetAnalysis() {
  state.extraction = state.assigned = state.recon = state.metrics = state.times = null;
  $('exportJson').disabled = $('exportCsv').disabled = $('swapBtn').disabled = true;
  $('charts').innerHTML = '';
  $('valuesTable').innerHTML = '';
}

// ---------- transport ----------
function frameIndexAt(t) {
  if (!state.times?.length) return -1;
  const { fps } = state.extraction;
  const i = Math.round((t - state.times[0]) * fps);
  return Math.max(0, Math.min(state.times.length - 1, i));
}
function stepFrame(dir) {
  video.pause();
  const fps = state.extraction?.fps || 30;
  video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + dir / fps));
}
$('playBtn').addEventListener('click', () => (video.paused ? video.play() : video.pause()));
$('prevBtn').addEventListener('click', () => stepFrame(-1));
$('nextBtn').addEventListener('click', () => stepFrame(1));
$('rate').addEventListener('change', (e) => { video.playbackRate = +e.target.value; });
$('seek').addEventListener('input', (e) => { video.currentTime = +e.target.value; });
video.addEventListener('play', () => { $('playBtn').textContent = '⏸'; });
video.addEventListener('pause', () => { $('playBtn').textContent = '▶'; });
video.addEventListener('seeked', () => { if (!state.busy) render(); });
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || !video.src) return;
  if (e.code === 'Space') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
  if (e.code === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
  if (e.code === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
});
['showSkel', 'showCom', 'showRaw'].forEach((id) => $(id).addEventListener('change', render));
$('dimVideo').addEventListener('change', (e) => video.classList.toggle('dim', e.target.checked));

(function tick() {
  if (!video.paused && !state.busy) render();
  requestAnimationFrame(tick);
})();

// ---------- rendu synchronisé ----------
function render() {
  const t = video.currentTime || 0;
  $('seek').value = t;
  $('timeLabel').textContent = `${t.toFixed(2)} / ${(video.duration || 0).toFixed(2)} s`;
  const i = frameIndexAt(t);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (i < 0 || !state.recon) return;
  state.current = i;
  // Hors de la plage analysée : pas d'affichage.
  const inRange = t >= state.times[0] - 0.5 / state.extraction.fps && t <= state.times[state.times.length - 1] + 0.5 / state.extraction.fps;
  const lbl = names();
  const persons = state.recon.frames[i].map((p, k) => {
    if (!p || !inRange) return null;
    const pf = state.metrics.persons[k].perFrame[i];
    return { img: p.img, com2d: pf?.com2d, label: lbl[k] };
  });
  if ($('showSkel').checked) {
    drawOverlay(octx, {
      persons,
      colors: colors(),
      showCom: $('showCom').checked,
      raw: $('showRaw').checked && inRange ? state.extraction.frames[i].detections : null,
    });
  }
  const frame3d = inRange ? state.recon.frames[i] : [null, null];
  const mf = [0, 1].map((k) => state.metrics.persons[k].perFrame[i]);
  const trails = [0, 1].map((k) => {
    const out = [];
    for (let j = Math.max(0, i - 45); j <= i; j++) { const pf = state.metrics.persons[k].perFrame[j]; if (pf) out.push(pf.com); }
    return out;
  });
  scene.update(frame3d, mf, trails);
  charts.setCursor(i);
  updateValuesTable(i);
}

// ---------- extraction ----------
$('setStart').addEventListener('click', () => { $('tStart').value = video.currentTime.toFixed(2); });
$('setEnd').addEventListener('click', () => { $('tEnd').value = video.currentTime.toFixed(2); });
$('cancelBtn').addEventListener('click', () => { state.cancel = true; });

$('analyzeBtn').addEventListener('click', async () => {
  const start = Math.max(0, +$('tStart').value);
  const end = Math.min(video.duration, +$('tEnd').value || video.duration);
  if (!(end > start)) { setStatus('Plage invalide.'); return; }
  state.busy = true;
  state.cancel = false;
  $('analyzeBtn').disabled = true;
  $('cancelBtn').hidden = false;
  $('progress').hidden = false;
  $('progress').value = 0;
  // Empêche la mise en veille de l'écran pendant l'analyse (téléphone).
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* non supporté */ }
  try {
    const extraction = await extractPoses(video, {
      start, end,
      fps: +$('fps').value,
      model: $('model').value,
      minDetection: +$('minDet').value,
      minPresence: +$('minPres').value,
      minTracking: 0.5,
      onProgress: (p, rate) => { $('progress').value = p; setStatus(`Extraction… ${(p * 100).toFixed(0)} % (${rate.toFixed(1)} im/s)`); },
      isCancelled: () => state.cancel,
    }, setStatus);
    if (!extraction.frames.length) { setStatus('Analyse annulée.'); return; }
    state.extraction = extraction;
    state.assigned = assignIdentities(extraction.frames);
    recompute();
    const two = extraction.frames.filter((f) => f.detections.length >= 2).length;
    setStatus(`${extraction.frames.length} images analysées${state.cancel ? ' (interrompu)' : ''} — 2 personnes détectées sur ${(100 * two / extraction.frames.length).toFixed(0)} % des images.`);
    video.currentTime = start;
    persistAnalysis();
  } catch (err) {
    console.error(err);
    setStatus(`Erreur : ${err.message}`);
  } finally {
    state.busy = false;
    $('analyzeBtn').disabled = false;
    $('cancelBtn').hidden = true;
    $('progress').hidden = true;
    wakeLock?.release().catch(() => {});
  }
});

// ---------- post-traitement (instantané) ----------
function recompute() {
  if (!state.assigned) return;
  const { width, height, fps } = state.extraction;
  state.recon = reconstruct(state.assigned, {
    width, height, fps,
    hfov: +$('hfov').value,
    sigma: +$('sigma').value,
    maxGap: +$('maxGap').value,
    ground: $('ground').value,
  });
  state.metrics = computeMetrics(state.recon.frames, fps, { contactTol: +$('contactTol').value });
  state.times = Float64Array.from(state.extraction.frames.map((f) => f.t));
  scene.setCameraPose(state.recon.camera);
  $('groundInfo').textContent = `Sol : ${state.recon.groundInfo}. Traits pleins = côté gauche du pratiquant, clairs = côté droit. Anneau au sol = CoM extrapolé (XCoM).`;
  $('exportJson').disabled = $('exportCsv').disabled = $('swapBtn').disabled = false;
  buildCharts();
  render();
}
['hfov', 'sigma', 'maxGap', 'ground', 'contactTol'].forEach((id) => $(id).addEventListener('change', () => {
  recompute();
  persistAnalysis();
}));

// Enregistre l'analyse courante dans la bibliothèque (regroupe les appels rapprochés).
let persistTimer = 0;
function persistAnalysis() {
  if (!state.libraryId || !state.extraction) return;
  clearTimeout(persistTimer);
  const id = state.libraryId;
  persistTimer = setTimeout(() => {
    library.saveAnalysis(id, serializeAnalysis()).catch((err) => console.warn('Sauvegarde bibliothèque', err));
  }, 800);
}
['nameA', 'nameB'].forEach((id) => $(id).addEventListener('input', () => {
  $('legendA').textContent = names()[0];
  $('legendB').textContent = names()[1];
  if (state.metrics) buildCharts();
  render();
}));
$('swapBtn').addEventListener('click', () => {
  if (!state.assigned) return;
  swapFrom(state.assigned, state.current);
  recompute();
  persistAnalysis();
  setStatus(`Identités A/B inversées à partir de t = ${state.times[state.current].toFixed(2)} s.`);
});

// ---------- graphiques ----------
function metricDefs() {
  return [
    ...METRICS.map((m) => ({ ...m, pair: false })),
    ...PAIR_METRICS.map((m) => ({ ...m, pair: true })),
  ];
}
function buildMetricPicker() {
  const list = $('metricList');
  list.innerHTML = '';
  let group = '';
  for (const m of metricDefs()) {
    if (m.group !== group) {
      group = m.group;
      const h = document.createElement('h3');
      h.textContent = group;
      list.appendChild(h);
    }
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedMetrics.has(m.key);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedMetrics.add(m.key); else selectedMetrics.delete(m.key);
      try { localStorage.setItem('aiki.metrics', JSON.stringify([...selectedMetrics])); } catch { /* ignore */ }
      if (state.metrics) buildCharts();
    });
    label.append(cb, document.createTextNode(`${m.label} (${m.unit})`));
    list.appendChild(label);
  }
}
buildMetricPicker();

function buildCharts() {
  if (!state.metrics) return;
  const [ca, cb] = colors();
  const [na, nb] = names();
  const defs = metricDefs().filter((m) => selectedMetrics.has(m.key)).map((m) => ({
    label: m.label,
    unit: m.unit,
    series: m.pair
      ? [{ name: 'Couple', color: cssVar('--series-pair'), data: state.metrics.pair[m.key] }]
      : [
        { name: na, color: ca, data: state.metrics.persons[0].series[m.key] },
        { name: nb, color: cb, data: state.metrics.persons[1].series[m.key] },
      ],
  }));
  charts.setData(state.times, defs);
  charts.setCursor(state.current);
}

function updateValuesTable(i) {
  const [na, nb] = names();
  const f = (v, unit) => (Number.isNaN(v) ? '—' : v.toFixed(unit.startsWith('°') ? 0 : 2));
  let html = `<tr><th>Indicateur</th><th>Unité</th><th>${na}</th><th>${nb}</th></tr>`;
  for (const m of metricDefs()) {
    if (m.pair) {
      html += `<tr><td>${m.label}</td><td>${m.unit}</td><td class="num" colspan="2">${f(state.metrics.pair[m.key][i], m.unit)}</td></tr>`;
    } else {
      html += `<tr><td>${m.label}</td><td>${m.unit}</td><td class="num">${f(state.metrics.persons[0].series[m.key][i], m.unit)}</td><td class="num">${f(state.metrics.persons[1].series[m.key][i], m.unit)}</td></tr>`;
    }
  }
  $('valuesTable').innerHTML = html;
}

// ---------- export / import ----------
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const round = (arr, d = 4) => Array.from(arr, (v) => +v.toFixed(d));
const baseName = () => (state.fileName || 'analyse').replace(/\.[^.]+$/, '');

function serializeAnalysis() {
  const { width, height, fps, frames } = state.extraction;
  return {
    format: 'aiki-filaire/1',
    video: state.fileName, width, height, fps,
    names: names(),
    settings: Object.fromEntries(['hfov', 'sigma', 'maxGap', 'ground', 'contactTol'].map((id) => [id, $(id).value])),
    // Détections brutes + identités : permet de recharger l'analyse sans ré-extraction.
    frames: frames.map((f, i) => ({
      t: +f.t.toFixed(4),
      persons: state.assigned[i].map((p) => (p ? { img: round(p.img, 2), world: round(p.world, 4) } : null)),
    })),
    // Scène reconstruite (m, Y vertical, sol Y = 0).
    scene: state.recon.frames.map((pp) => pp.map((p) => (p ? round(p.joints, 4) : null))),
    camera: state.recon.camera,
  };
}
$('exportJson').addEventListener('click', () => {
  download(`${baseName()}.aiki.json`, JSON.stringify(serializeAnalysis()), 'application/json');
});

$('exportCsv').addEventListener('click', () => {
  const [na, nb] = names();
  const cols = ['t_s'];
  const getters = [(i) => state.times[i].toFixed(4)];
  for (const m of METRICS) {
    [0, 1].forEach((k) => {
      cols.push(`${k ? nb : na}_${m.key}_${m.unit}`);
      getters.push((i) => { const v = state.metrics.persons[k].series[m.key][i]; return Number.isNaN(v) ? '' : v.toFixed(4); });
    });
  }
  [0, 1].forEach((k) => ['x', 'y', 'z'].forEach((ax, d) => {
    cols.push(`${k ? nb : na}_com_${ax}_m`);
    getters.push((i) => { const v = state.metrics.persons[k].com[d][i]; return Number.isNaN(v) ? '' : v.toFixed(4); });
  }));
  for (const m of PAIR_METRICS) {
    cols.push(`pair_${m.key}_${m.unit}`);
    getters.push((i) => { const v = state.metrics.pair[m.key][i]; return Number.isNaN(v) ? '' : v.toFixed(4); });
  }
  const lines = [cols.join(';')];
  for (let i = 0; i < state.times.length; i++) lines.push(getters.map((g) => g(i)).join(';'));
  download(`${baseName()}.metrics.csv`, lines.join('\n'), 'text/csv');
});

$('jsonInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    applyAnalysisData(data);
    setStatus(`Analyse chargée (${data.frames.length} images). Ouvrez la vidéo « ${data.video} » pour la superposition.`);
  } catch (err) {
    setStatus(`Fichier d'analyse invalide : ${err.message}`);
  }
  e.target.value = '';
});

function applyAnalysisData(data) {
  if (data.format !== 'aiki-filaire/1') throw new Error('format inconnu');
  const toDet = (p) => (p ? { img: Float32Array.from(p.img), world: Float32Array.from(p.world) } : null);
  state.extraction = {
    width: data.width, height: data.height, fps: data.fps,
    frames: data.frames.map((f) => ({ t: f.t, detections: f.persons.filter(Boolean).map(toDet) })),
  };
  state.assigned = data.frames.map((f) => f.persons.map(toDet));
  if (data.names) { $('nameA').value = data.names[0]; $('nameB').value = data.names[1]; }
  for (const [id, v] of Object.entries(data.settings || {})) if ($(id)) $(id).value = v;
  $('legendA').textContent = names()[0];
  $('legendB').textContent = names()[1];
  recompute();
}

// ---------- bibliothèque ----------
const fmtSize = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} Go` : `${(b / 1e6).toFixed(0)} Mo`);
const fmtDate = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

async function renderLibrary() {
  const list = $('libraryList');
  list.innerHTML = '';
  let entries = [];
  try {
    entries = await library.listEntries();
  } catch (err) {
    list.innerHTML = `<li class="library-empty">Bibliothèque indisponible dans ce navigateur (${err.message}).</li>`;
    return;
  }
  const est = await library.storageEstimate();
  $('libraryInfo').textContent = 'Les vidéos et analyses restent dans ce navigateur, sur cet appareil.'
    + (est?.quota ? ` Espace utilisé : ${fmtSize(est.usage)} sur ${fmtSize(est.quota)} disponibles.` : '');
  if (!entries.length) {
    list.innerHTML = '<li class="library-empty">Aucune vidéo. Ouvrez ou filmez une vidéo : elle sera ajoutée ici.</li>';
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    const img = e.thumb ? document.createElement('img') : document.createElement('div');
    if (e.thumb) { img.src = e.thumb; img.alt = ''; } else img.className = 'nothumb';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'lib-name';
    name.textContent = e.name;
    if (e.hasAnalysis) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'analysée';
      name.appendChild(b);
    }
    const meta = document.createElement('div');
    meta.className = 'lib-meta';
    meta.textContent = `${fmtDate(e.date)} · ${e.duration ? e.duration.toFixed(1) : '?'} s · ${e.width}×${e.height} · ${fmtSize(e.size)}`;
    info.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'lib-actions';
    const open = document.createElement('button');
    open.className = 'btn small primary';
    open.textContent = 'Ouvrir';
    open.addEventListener('click', async () => {
      const entry = await library.getEntry(e.id);
      if (!entry) return;
      $('libraryDlg').close();
      resetAnalysis();
      loadVideoFile(new File([entry.blob], entry.name, { type: entry.type || 'video/mp4' }), { libraryId: entry.id, analysis: entry.analysis });
    });
    const del = document.createElement('button');
    del.className = 'btn small';
    del.textContent = 'Supprimer';
    del.addEventListener('click', async () => {
      if (!confirm(`Supprimer « ${e.name} » et son analyse de la bibliothèque ?`)) return;
      await library.deleteEntry(e.id);
      if (state.libraryId === e.id) state.libraryId = null;
      renderLibrary();
    });
    actions.append(open, del);
    li.append(img, info, actions);
    list.appendChild(li);
  }
}
$('libraryBtn').addEventListener('click', () => { renderLibrary(); $('libraryDlg').showModal(); });
$('libraryClose').addEventListener('click', () => $('libraryDlg').close());
$('libraryDlg').addEventListener('click', (e) => { if (e.target === $('libraryDlg')) $('libraryDlg').close(); });
try {
  $('autoKeep').checked = localStorage.getItem('aiki.autoKeep') !== '0';
} catch { /* ignore */ }
$('autoKeep').addEventListener('change', (e) => {
  try { localStorage.setItem('aiki.autoKeep', e.target.checked ? '1' : '0'); } catch { /* ignore */ }
});

// ---------- onglets (mobile) ----------
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.classList.contains(tab.dataset.tab)));
  if (tab.dataset.tab === 'charts-panel') charts.redraw();
}));

// Réglages par défaut plus légers sur téléphone.
if (isTouch) $('model').value = 'lite';

applyTheme();
scene.setView('front');
