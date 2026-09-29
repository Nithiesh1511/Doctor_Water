import * as THREE from 'three';

/**
 * The Doctor's Water sticker label (after the real 20 L can label): navy panel, cyan wave,
 * DOCTOR'S / water wordmark, H2O cloud and droplet mascot. Drawn procedurally so it needs no
 * external assets, and redrawn once the web fonts have loaded.
 */
export function makeLabelTexture() {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;

  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    // rounded navy sticker
    const r = 26;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 0, w, h, r) : ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.fillStyle = '#0a1f4d';
    ctx.fillRect(0, 0, w, h);

    // cyan wave band through the middle
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#1492d6');
    grad.addColorStop(1, '#35c3f0');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.bezierCurveTo(w * 0.3, h * 0.36, w * 0.6, h * 0.62, w, h * 0.44);
    ctx.lineTo(w, h * 0.8);
    ctx.bezierCurveTo(w * 0.62, h * 0.9, w * 0.3, h * 0.74, 0, h * 0.84);
    ctx.closePath();
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = "700 112px 'Sora', 'Poppins', sans-serif";
    ctx.fillText("DOCTOR'S", 60, h * 0.34);
    ctx.font = "800 190px 'Sora', 'Poppins', sans-serif";
    ctx.fillText('water', 52, h * 0.76);

    ctx.font = "600 30px 'Poppins', sans-serif";
    ctx.fillStyle = '#0a1f4d';
    ctx.fillText('TASTE FOR THIRST', 150, h * 0.88);

    // H2O cloud
    ctx.save();
    ctx.translate(w * 0.66, h * 0.2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(-34, 8, 28, Math.PI * 0.6, Math.PI * 1.6);
    ctx.arc(0, -14, 34, Math.PI * 1.1, Math.PI * 1.95);
    ctx.arc(38, 6, 28, Math.PI * 1.4, Math.PI * 0.4);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = "600 34px 'Poppins', sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText('H₂O', 2, 20);
    ctx.restore();

    // droplet mascot
    ctx.save();
    ctx.translate(w * 0.86, h * 0.22);
    const dg = ctx.createLinearGradient(-40, -60, 40, 50);
    dg.addColorStop(0, '#ffffff');
    dg.addColorStop(1, '#bfe8fb');
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.moveTo(0, -62);
    ctx.bezierCurveTo(30, -20, 44, 0, 44, 20);
    ctx.arc(0, 20, 44, 0, Math.PI);
    ctx.bezierCurveTo(-44, 0, -30, -20, 0, -62);
    ctx.fill();
    ctx.fillStyle = '#0a1f4d';
    ctx.beginPath();
    ctx.arc(-14, 16, 5, 0, Math.PI * 2);
    ctx.arc(14, 16, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0a1f4d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 28, 9, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,120,150,0.55)';
    ctx.beginPath();
    ctx.arc(-24, 30, 6, 0, Math.PI * 2);
    ctx.arc(24, 30, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = "700 30px 'Poppins', sans-serif";
    ctx.fillText('PACKAGED', w * 0.84, h * 0.58);
    ctx.fillText('DRINKING WATER', w * 0.84, h * 0.65);
    ctx.font = "500 22px 'Poppins', sans-serif";
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('RO · UV · OZONISED', w * 0.84, h * 0.72);
    ctx.restore();

    tex.needsUpdate = true;
  };

  draw();
  if (document.fonts?.load) {
    Promise.all([document.fonts.load("800 190px 'Sora'"), document.fonts.load("600 30px 'Poppins'")])
      .then(draw)
      .catch(() => {});
  }
  return tex;
}
