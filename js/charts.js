// Petits multiples de séries temporelles (un indicateur = un graphique, un seul axe Y).
// Curseur synchronisé avec la vidéo, info-bulle au survol, clic = positionnement.

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function fmt(v, unit) {
  if (Number.isNaN(v) || v === undefined) return '—';
  const digits = unit === '°' || unit === '°/s' ? 0 : 2;
  return `${v.toFixed(digits)} ${unit}`;
}

export class ChartPanel {
  constructor(container, { onSeek }) {
    this.container = container;
    this.onSeek = onSeek;
    this.charts = [];
    this.cursor = 0;
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'chart-tooltip';
    this.tooltip.hidden = true;
    document.body.appendChild(this.tooltip);
    new ResizeObserver(() => this.redraw()).observe(container);
  }

  /**
   * @param times Float64Array des temps (s)
   * @param defs [{label, unit, series:[{name, color, data}]}]
   */
  setData(times, defs) {
    this.times = times;
    this.container.innerHTML = '';
    this.charts = defs.map((def) => {
      const wrap = document.createElement('figure');
      wrap.className = 'chart';
      const head = document.createElement('figcaption');
      head.innerHTML = `<span class="chart-title">${def.label}</span><span class="chart-unit">${def.unit}</span>`;
      const canvas = document.createElement('canvas');
      wrap.append(head, canvas);
      this.container.appendChild(wrap);
      const chart = { def, canvas, hover: null };
      canvas.addEventListener('pointermove', (e) => this.#hover(chart, e));
      canvas.addEventListener('pointerleave', () => { chart.hover = null; this.tooltip.hidden = true; this.#draw(chart); });
      canvas.addEventListener('click', (e) => {
        const i = this.#indexAt(chart, e);
        if (i !== null) this.onSeek?.(this.times[i]);
      });
      return chart;
    });
    this.redraw();
  }

  setCursor(i) {
    this.cursor = i;
    this.redraw();
  }

  redraw() {
    for (const c of this.charts) this.#draw(c);
  }

  #layout(chart) {
    const { canvas } = chart;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return { dpr, w, h, left: 40, right: 8, top: 6, bottom: 18 };
  }

  #indexAt(chart, e) {
    if (!this.times?.length) return null;
    const L = this.#layout(chart);
    const rect = chart.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t0 = this.times[0], t1 = this.times[this.times.length - 1];
    const t = t0 + (x - L.left) / (L.w - L.left - L.right) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < this.times.length; i++) if (Math.abs(this.times[i] - t) < Math.abs(this.times[best] - t)) best = i;
    return best;
  }

  #hover(chart, e) {
    const i = this.#indexAt(chart, e);
    chart.hover = i;
    this.#draw(chart);
    if (i === null) return;
    const { def } = chart;
    const rows = def.series.map((s) => `<div class="tt-row"><span class="tt-swatch" style="background:${s.color}"></span><span>${s.name}</span><b>${fmt(s.data[i], def.unit)}</b></div>`).join('');
    this.tooltip.innerHTML = `<div class="tt-head">t = ${this.times[i].toFixed(2)} s</div>${rows}`;
    this.tooltip.hidden = false;
    const tw = this.tooltip.offsetWidth;
    const x = e.clientX + 14 + tw > window.innerWidth ? e.clientX - 14 - tw : e.clientX + 14;
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${e.clientY + 12}px`;
  }

  #draw(chart) {
    const { canvas, def } = chart;
    const L = this.#layout(chart);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);
    if (!this.times?.length || L.w < 50) return;

    let min = Infinity, max = -Infinity;
    for (const s of def.series) for (const v of s.data) if (!Number.isNaN(v)) { min = Math.min(min, v); max = Math.max(max, v); }
    if (min === Infinity) { min = 0; max = 1; }
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    min -= pad; max += pad;

    const t0 = this.times[0], t1 = this.times[this.times.length - 1] || t0 + 1;
    const X = (t) => L.left + (t - t0) / (t1 - t0 || 1) * (L.w - L.left - L.right);
    const Y = (v) => L.top + (1 - (v - min) / (max - min)) * (L.h - L.top - L.bottom);

    const grid = css('--grid'), muted = css('--text-muted');
    ctx.font = '10px system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.strokeStyle = grid;
    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of niceTicks(min, max)) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L.left, y); ctx.lineTo(L.w - L.right, y); ctx.stroke();
      ctx.fillText(String(+v.toFixed(2)), L.left - 5, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of niceTicks(t0, t1, 6)) ctx.fillText(`${t}s`, X(t), L.h - L.bottom + 4);

    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (const s of def.series) {
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < s.data.length; i++) {
        const v = s.data[i];
        if (Number.isNaN(v)) { pen = false; continue; }
        const x = X(this.times[i]), y = Y(v);
        if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
    }

    const drawCursor = (i, color, dash) => {
      const x = Math.round(X(this.times[i])) + 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, L.h - L.bottom); ctx.stroke();
      ctx.setLineDash([]);
      for (const s of def.series) {
        const v = s.data[i];
        if (Number.isNaN(v)) continue;
        ctx.fillStyle = css('--surface');
        ctx.beginPath(); ctx.arc(x, Y(v), 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(x, Y(v), 3.5, 0, Math.PI * 2); ctx.fill();
      }
    };
    if (this.cursor != null && this.cursor < this.times.length) drawCursor(this.cursor, css('--text-primary'), []);
    if (chart.hover != null) drawCursor(chart.hover, muted, [3, 3]);
  }
}
