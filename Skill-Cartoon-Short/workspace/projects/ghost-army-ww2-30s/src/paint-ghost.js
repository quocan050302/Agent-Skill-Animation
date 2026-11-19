/**
 * Procedural Canvas2D Textures for "The Fake Army That Fooled the Nazis" (30s Ghost Army Demo)
 * Classification: NEW IMPLEMENTATION CODE (QA-TTS-01 Phase 6)
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

export function fieldGrassMud(seed = 401) {
  const [c, g] = cv(512, 512);
  const r = rng(seed);
  g.fillStyle = '#738f59';
  g.fillRect(0, 0, 512, 512);

  // Subtle earthen patches & damp European field variations
  for (let i = 0; i < 160; i++) {
    const isMud = r() > 0.7;
    g.fillStyle = isMud
      ? `rgba(128, 108, 82, ${0.22 + r() * 0.22})`
      : `rgba(94, 124, 72, ${0.22 + r() * 0.25})`;
    g.beginPath();
    g.ellipse(r() * 512, r() * 512, 10 + r() * 38, 6 + r() * 20, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // Subtle tank-track ruts
  g.strokeStyle = 'rgba(84, 70, 52, 0.28)';
  g.lineWidth = 10;
  for (const x of [110, 165, 345, 400]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 512);
    g.stroke();
  }
  // Grass tufts
  g.strokeStyle = 'rgba(150, 180, 112, 0.48)';
  g.lineWidth = 2;
  for (let i = 0; i < 240; i++) {
    const x = r() * 512;
    const y = r() * 512;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 8, y - 6 - r() * 8);
    g.stroke();
  }
  return c;
}

export function rubberTankHull(seed = 402) {
  const [c, g] = cv(512, 512);
  const r = rng(seed);
  g.fillStyle = '#5a6b48';
  g.fillRect(0, 0, 512, 512);

  // Inflatable vulcanized rubber panel seams (subtle comic reveal cue)
  g.strokeStyle = 'rgba(36, 23, 38, 0.42)';
  g.lineWidth = 5;
  for (let y = 96; y < 512; y += 108) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }
  for (let x = 128; x < 512; x += 128) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 512);
    g.stroke();
  }
  // Matte rubber specular sheen bands
  for (let i = 0; i < 55; i++) {
    g.fillStyle = `rgba(145, 165, 118, ${0.07 + r() * 0.08})`;
    g.beginPath();
    g.ellipse(r() * 512, r() * 512, 16 + r() * 44, 6 + r() * 14, r() * 2, 0, Math.PI * 2);
    g.fill();
  }
  // Allied white star stencil
  g.save();
  g.translate(256, 240);
  g.strokeStyle = '#eef3e6';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(0, 0, 74, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#eef3e6';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? 58 : 24;
    const px = Math.cos(ang) * rad;
    const py = Math.sin(ang) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
  g.restore();

  // Comic rubber air-valve patch near bottom corner
  g.fillStyle = '#d9534f';
  g.strokeStyle = '#241726';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(430, 420, 32, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#fffbf0';
  g.font = '900 22px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('AIR', 430, 421);
  return c;
}

export function tankTreadTex() {
  const [c, g] = cv(256, 256);
  g.fillStyle = '#33383d';
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 28) {
    g.fillStyle = '#474e54';
    g.fillRect(x + 4, 10, 18, 236);
    g.strokeStyle = '#241726';
    g.lineWidth = 4;
    g.strokeRect(x + 4, 10, 18, 236);
  }
  return c;
}

export function radioFaceplateCanvas() {
  const [c, g] = cv(512, 320);
  g.fillStyle = '#2c353d';
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = '#241726';
  g.lineWidth = 14;
  g.strokeRect(10, 10, 492, 300);

  // Glowing amber frequency window
  g.fillStyle = '#f6c85f';
  g.fillRect(42, 42, 260, 102);
  g.strokeStyle = '#241726';
  g.lineWidth = 6;
  g.strokeRect(42, 42, 260, 102);
  for (let x = 62; x < 290; x += 18) {
    g.strokeStyle = '#241726';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, 60);
    g.lineTo(x, x % 36 === 0 ? 116 : 94);
    g.stroke();
  }
  // Red tuning needle
  g.strokeStyle = '#d93832';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(192, 48);
  g.lineTo(192, 138);
  g.stroke();

  // Speaker grille on right
  g.fillStyle = '#1b2228';
  g.fillRect(334, 42, 136, 198);
  for (let y = 58; y < 230; y += 16) {
    g.fillStyle = '#49545e';
    g.fillRect(346, y, 112, 6);
  }

  // Rotary knobs & label
  for (const kx of [86, 174, 262]) {
    g.fillStyle = '#52606d';
    g.beginPath();
    g.arc(kx, 212, 32, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#241726';
    g.lineWidth = 5;
    g.stroke();
    g.strokeStyle = '#ffe055';
    g.beginPath();
    g.moveTo(kx, 212);
    g.lineTo(kx + 18, 192);
    g.stroke();
  }

  g.fillStyle = '#fffbf0';
  g.font = '900 28px Arial Black, Arial, sans-serif';
  g.textAlign = 'left';
  g.fillText('SPOOF NET · 23RD HQ', 42, 286);
  return c;
}

export function crateStencilCanvas() {
  const [c, g] = cv(512, 320);
  g.fillStyle = '#9c7c52';
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = '#241726';
  g.lineWidth = 14;
  g.strokeRect(10, 10, 492, 300);

  // Horizontal plank seams
  g.strokeStyle = 'rgba(36, 23, 38, 0.5)';
  g.lineWidth = 5;
  for (const y of [86, 162, 238]) {
    g.beginPath();
    g.moveTo(16, y);
    g.lineTo(496, y);
    g.stroke();
  }
  // Bold military stencil
  g.fillStyle = '#241726';
  g.font = '900 54px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('GHOST ARMY', 256, 118);
  g.font = '900 34px Arial Black, Arial, sans-serif';
  g.fillStyle = '#fff6df';
  g.fillText('23RD HQ · INFLATABLE', 256, 202);
  g.fillStyle = '#d93832';
  g.font = '900 30px Arial Black, Arial, sans-serif';
  g.fillText('HANDLE LIKE A BALLOON', 256, 266);
  return c;
}

export function dirtRoadTex(seed = 409) {
  const [c, g] = cv(512, 512);
  const r = rng(seed);
  g.fillStyle = '#7c6a54';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 120; i++) {
    g.fillStyle = `rgba(98, 82, 62, ${0.22 + r() * 0.25})`;
    g.beginPath();
    g.ellipse(r() * 512, r() * 512, 10 + r() * 34, 4 + r() * 14, r() * 2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(60, 48, 36, 0.35)';
  g.fillRect(110, 0, 48, 512);
  g.fillRect(354, 0, 48, 512);
  return c;
}

export function makeClampedTex(canvas) {
  const t = tex(canvas, 1, 1);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
