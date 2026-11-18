/**
 * Procedural Canvas2D Supermarket Textures (SHORT-01 Phase G)
 * Classification: NEW IMPLEMENTATION CODE
 * Deterministic seeded procedural textures matching engine/paint.js conventions.
 */
import * as THREE from './lib/three.module.js';
import { rng, tex } from './paint.js';

const cv = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
};

export function linoleumTiles(seed = 101) {
  const [c, g] = cv(512, 512);
  const r = rng(seed);
  const cells = 4;
  const sz = 512 / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const alt = (x + y) % 2 === 0;
      g.fillStyle = alt ? '#e9eef0' : '#cfe0e3';
      g.fillRect(x * sz, y * sz, sz, sz);
      // Subtle floor wax sheen & scuffs
      g.fillStyle = alt ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.22)';
      g.fillRect(x * sz + 8, y * sz + 8, sz - 24, 10);
      for (let k = 0; k < 5; k++) {
        g.fillStyle = `rgba(90,105,112,${0.08 + r() * 0.1})`;
        g.beginPath();
        g.ellipse(x * sz + r() * sz, y * sz + r() * sz, 3 + r() * 9, 1.5 + r() * 3, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(110,126,132,0.55)';
      g.lineWidth = 3;
      g.strokeRect(x * sz + 1.5, y * sz + 1.5, sz - 3, sz - 3);
    }
  }
  return c;
}

export function shelfMetal(seed = 102) {
  const [c, g] = cv(512, 256);
  const r = rng(seed);
  g.fillStyle = '#d6dce2';
  g.fillRect(0, 0, 512, 256);
  // Dusty bare center patch + price-rail stripe along front edge
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(118,122,126,${0.12 + r() * 0.18})`;
    g.beginPath();
    g.ellipse(r() * 512, 40 + r() * 170, 8 + r() * 26, 4 + r() * 14, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#e0483e';
  g.fillRect(0, 224, 512, 32);
  g.fillStyle = '#fff5d6';
  for (let x = 28; x < 500; x += 96) {
    g.fillRect(x, 229, 44, 22);
  }
  return c;
}

export function aisleSignCanvas() {
  const [c, g] = cv(1024, 384);
  g.fillStyle = '#1f3547';
  g.fillRect(0, 0, 1024, 384);
  g.strokeStyle = '#ffd24c';
  g.lineWidth = 18;
  g.strokeRect(18, 18, 988, 348);

  g.fillStyle = '#ffd24c';
  g.fillRect(36, 36, 204, 312);
  g.fillStyle = '#1f3547';
  g.font = '900 54px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('AISLE', 138, 138);
  g.font = '900 112px Arial Black, Arial, sans-serif';
  g.fillText('4', 138, 250);

  g.fillStyle = '#ffffff';
  g.font = '900 66px Arial Black, Arial, sans-serif';
  g.fillText('ORGANIC BRAINZ', 626, 132);

  g.fillStyle = '#e8453c';
  g.fillRect(310, 206, 632, 114);
  g.fillStyle = '#fff8e8';
  g.font = '900 64px Arial Black, Arial, sans-serif';
  g.fillText('100% SOLD OUT!', 626, 265);
  return c;
}

export function soldOutPlacardCanvas() {
  const [c, g] = cv(512, 320);
  g.fillStyle = '#fff6df';
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = '#241726';
  g.lineWidth = 16;
  g.strokeRect(12, 12, 488, 296);

  g.fillStyle = '#d93832';
  g.fillRect(28, 30, 456, 112);
  g.fillStyle = '#ffffff';
  g.font = '900 72px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SOLD OUT', 256, 88);

  g.fillStyle = '#241726';
  g.font = 'bold 42px Arial, sans-serif';
  g.fillText('NO BRAINS LEFT', 256, 195);
  g.font = 'bold 34px Arial, sans-serif';
  g.fillStyle = '#5e6470';
  g.fillText('TRY TOFU IN AISLE 9', 256, 255);
  return c;
}

export function storeHeaderCanvas() {
  const [c, g] = cv(1024, 256);
  g.fillStyle = '#247ba0';
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#70c1b3';
  g.fillRect(0, 206, 1024, 50);
  g.fillStyle = '#ffffff';
  g.font = '900 96px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('FRESH-MART 24H', 512, 112);
  return c;
}

export function makeClampedTex(canvas) {
  const t = tex(canvas, 1, 1);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
