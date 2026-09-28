// Dessin filaire 2D superposé à la vidéo.

import { BONES, JOINTS, LM, boneSide } from './skeleton.js';

export function drawOverlay(ctx, { persons, colors, showCom = true, minVis = 0.3, raw = null }) {
  const { canvas } = ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const lw = Math.max(2, canvas.width / 400);

  // Détections brutes (non identifiées) en pointillés, pour contrôle.
  if (raw) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = lw * 0.6;
    for (const det of raw) {
      ctx.beginPath();
      for (const [a, b] of BONES) {
        ctx.moveTo(det.img[a * 3], det.img[a * 3 + 1]);
        ctx.lineTo(det.img[b * 3], det.img[b * 3 + 1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  persons.forEach((p, k) => {
    if (!p) return;
    const P = p.img;
    const color = colors[k];
    ctx.lineCap = 'round';
    for (const bone of BONES) {
      const [a, b] = bone;
      const vis = Math.min(P[a * 3 + 2], P[b * 3 + 2]);
      if (vis < minVis) continue;
      ctx.globalAlpha = 0.35 + 0.65 * vis;
      ctx.strokeStyle = color;
      ctx.lineWidth = boneSide(bone) === 'L' ? lw * 1.6 : lw;
      ctx.setLineDash(boneSide(bone) === 'R' ? [lw * 2, lw * 1.5] : []);
      ctx.beginPath();
      ctx.moveTo(P[a * 3], P[a * 3 + 1]);
      ctx.lineTo(P[b * 3], P[b * 3 + 1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const j of JOINTS) {
      const vis = P[j * 3 + 2];
      if (vis < minVis) continue;
      ctx.globalAlpha = 0.35 + 0.65 * vis;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(P[j * 3], P[j * 3 + 1], lw * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (showCom && p.com2d) {
      const [x, y] = p.com2d;
      const footY = Math.max(P[LM.L_HEEL * 3 + 1], P[LM.R_HEEL * 3 + 1], P[LM.L_FOOT * 3 + 1], P[LM.R_FOOT * 3 + 1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw * 0.8;
      ctx.setLineDash([lw * 3, lw * 2]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, footY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(x, y, lw * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (p.label) {
      const top = Math.min(P[LM.NOSE * 3 + 1], P[LM.L_EAR * 3 + 1], P[LM.R_EAR * 3 + 1]);
      ctx.font = `600 ${Math.round(lw * 7)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = lw;
      ctx.strokeText(p.label, P[LM.NOSE * 3], top - lw * 6);
      ctx.fillText(p.label, P[LM.NOSE * 3], top - lw * 6);
    }
  });
}
