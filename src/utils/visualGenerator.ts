import { VisualStyle, AspectRatio } from '../types';

/**
 * Creates high-resolution procedural canvas artwork for AI storyboards
 * ensuring rich instant previews and zero broken image states.
 */
export function generateProceduralArtwork(
  title: string,
  style: VisualStyle,
  aspectRatio: AspectRatio,
  index: number = 0
): string {
  const canvas = document.createElement('canvas');
  let width = 1280;
  let height = 720;

  if (aspectRatio === '9:16') {
    width = 720;
    height = 1280;
  } else if (aspectRatio === '1:1') {
    width = 1080;
    height = 1080;
  } else if (aspectRatio === '4:5') {
    width = 864;
    height = 1080;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Draw style-specific artistic background
  drawArtisticScene(ctx, width, height, style, title, index);

  return canvas.toDataURL('image/jpeg', 0.88);
}

function drawArtisticScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  style: VisualStyle,
  title: string,
  seed: number
) {
  // Base background gradient
  const grad = ctx.createLinearGradient(0, 0, w, h);
  
  if (style === 'cyberpunk') {
    grad.addColorStop(0, '#0d0221');
    grad.addColorStop(0.5, '#19002e');
    grad.addColorStop(1, '#050510');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Neon grid and skyline
    drawCyberpunkCity(ctx, w, h, seed);
  } else if (style === 'anime') {
    grad.addColorStop(0, '#1e3a8a');
    grad.addColorStop(0.4, '#38bdf8');
    grad.addColorStop(0.7, '#bae6fd');
    grad.addColorStop(1, '#fef08a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    drawAnimeCloudsAndSun(ctx, w, h, seed);
  } else if (style === 'chinese-ink') {
    grad.addColorStop(0, '#1c1917');
    grad.addColorStop(0.5, '#292524');
    grad.addColorStop(1, '#0c0a09');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    drawInkMountains(ctx, w, h, seed);
  } else if (style === '3d-render') {
    grad.addColorStop(0, '#064e3b');
    grad.addColorStop(0.5, '#022c22');
    grad.addColorStop(1, '#041f1a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    draw3DShapes(ctx, w, h, seed);
  } else if (style === 'vintage-film') {
    grad.addColorStop(0, '#451a03');
    grad.addColorStop(0.5, '#291002');
    grad.addColorStop(1, '#180700');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    drawVintageScenery(ctx, w, h, seed);
  } else {
    // Cinematic & Photorealistic (Deep Space & Dramatic Atmospheric)
    grad.addColorStop(0, '#090a10');
    grad.addColorStop(0.4, '#121424');
    grad.addColorStop(0.8, '#1e1b4b');
    grad.addColorStop(1, '#050508');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    drawCinematicNebula(ctx, w, h, seed);
  }

  // Add subtle cinematic vignette
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.8);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // Subtle film grain
  drawFilmGrain(ctx, w, h);
}

function drawCyberpunkCity(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  // Glowing grid lines
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.25)';
  ctx.lineWidth = 1.5;
  const horizon = h * 0.68;

  for (let i = 0; i <= w; i += 50) {
    ctx.beginPath();
    ctx.moveTo(i, horizon);
    ctx.lineTo(w / 2 + (i - w / 2) * 3, h);
    ctx.stroke();
  }
  for (let y = horizon; y < h; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Skyscrapers silhouettes with neon windows
  const buildingCount = 14;
  const bWidth = w / buildingCount;
  for (let i = 0; i < buildingCount; i++) {
    const bHeight = 120 + Math.sin(i * 1.5 + seed) * 180 + 100;
    const bx = i * bWidth;
    const by = horizon - bHeight;

    ctx.fillStyle = '#0b0914';
    ctx.fillRect(bx, by, bWidth - 4, bHeight + 40);

    // Neon edge highlight
    ctx.strokeStyle = i % 2 === 0 ? '#ec4899' : '#06b6d4';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bWidth - 4, bHeight + 40);

    // Glowing windows
    ctx.fillStyle = i % 2 === 0 ? 'rgba(6, 182, 212, 0.7)' : 'rgba(236, 72, 153, 0.7)';
    for (let wy = by + 20; wy < horizon - 20; wy += 28) {
      for (let wx = bx + 8; wx < bx + bWidth - 12; wx += 16) {
        if ((wx + wy + seed * 10) % 3 === 0) {
          ctx.fillRect(wx, wy, 6, 10);
        }
      }
    }
  }

  // Giant glowing moon/sun
  const moonGrad = ctx.createRadialGradient(w * 0.7, h * 0.25, 10, w * 0.7, h * 0.25, 140);
  moonGrad.addColorStop(0, 'rgba(244, 63, 94, 0.9)');
  moonGrad.addColorStop(0.5, 'rgba(236, 72, 153, 0.5)');
  moonGrad.addColorStop(1, 'rgba(236, 72, 153, 0)');
  ctx.fillStyle = moonGrad;
  ctx.beginPath();
  ctx.arc(w * 0.7, h * 0.25, 140, 0, Math.PI * 2);
  ctx.fill();
}

function drawAnimeCloudsAndSun(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  // Radiant sun with volumetric rays
  const sunX = w * 0.65;
  const sunY = h * 0.3;

  ctx.save();
  ctx.globalAlpha = 0.25;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 10) {
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.moveTo(sunX, sunY);
    ctx.arc(sunX, sunY, w * 0.9, angle, angle + 0.12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Dreamy volumetric clouds
  const cloudColors = ['#ffffff', '#fdf2f8', '#e0f2fe', '#bae6fd'];
  for (let c = 0; c < 5; c++) {
    const cx = (w * 0.2 * c + seed * 50) % w;
    const cy = h * 0.45 + (c % 3) * 60;
    const r = 90 + (c % 4) * 40;

    ctx.fillStyle = cloudColors[c % cloudColors.length];
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.7, cy - r * 0.2, r * 0.8, 0, Math.PI * 2);
    ctx.arc(cx - r * 0.6, cy + r * 0.1, r * 0.7, 0, Math.PI * 2);
    ctx.arc(cx + r * 1.3, cy + r * 0.3, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ocean / green meadow horizon at bottom
  const meadow = ctx.createLinearGradient(0, h * 0.75, 0, h);
  meadow.addColorStop(0, '#10b981');
  meadow.addColorStop(1, '#064e3b');
  ctx.fillStyle = meadow;
  ctx.fillRect(0, h * 0.75, w, h * 0.25);
}

function drawInkMountains(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  // Misty layers of traditional Chinese mountains
  const layers = [
    { y: h * 0.4, color: 'rgba(50, 45, 40, 0.4)', amp: 90 },
    { y: h * 0.55, color: 'rgba(30, 25, 22, 0.65)', amp: 120 },
    { y: h * 0.72, color: 'rgba(15, 12, 10, 0.9)', amp: 150 }
  ];

  layers.forEach((layer, idx) => {
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, layer.y);

    for (let x = 0; x <= w; x += 30) {
      const peak = Math.sin(x * 0.006 + idx * 2 + seed) * layer.amp + 
                   Math.cos(x * 0.015) * (layer.amp * 0.4);
      ctx.lineTo(x, layer.y + peak);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  });

  // Red seal / golden moon
  ctx.fillStyle = 'rgba(212, 175, 55, 0.85)';
  ctx.beginPath();
  ctx.arc(w * 0.8, h * 0.22, 45, 0, Math.PI * 2);
  ctx.fill();

  // Red stamp seal at corner
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(w * 0.1, h * 0.15, 34, 52);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px serif';
  ctx.fillText('墨', w * 0.1 + 8, h * 0.15 + 24);
  ctx.fillText('意', w * 0.1 + 8, h * 0.15 + 44);
}

function draw3DShapes(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  // Glossy 3D isometric floating spheres and glass rings
  const sphereX = w * 0.5;
  const sphereY = h * 0.45;
  const radius = Math.min(w, h) * 0.22;

  const sphereGrad = ctx.createRadialGradient(
    sphereX - radius * 0.35, sphereY - radius * 0.35, radius * 0.1,
    sphereX, sphereY, radius
  );
  sphereGrad.addColorStop(0, '#6ee7b7');
  sphereGrad.addColorStop(0.4, '#10b981');
  sphereGrad.addColorStop(0.8, '#047857');
  sphereGrad.addColorStop(1, '#064e3b');

  ctx.fillStyle = sphereGrad;
  ctx.beginPath();
  ctx.arc(sphereX, sphereY, radius, 0, Math.PI * 2);
  ctx.fill();

  // Glass ring orbiting sphere
  ctx.save();
  ctx.translate(sphereX, sphereY);
  ctx.rotate(-0.4);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.6, radius * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawVintageScenery(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  // Golden hour desert highway / retro horizon
  const horizon = h * 0.58;
  const sunset = ctx.createRadialGradient(w * 0.5, horizon, 10, w * 0.5, horizon, w * 0.7);
  sunset.addColorStop(0, '#f97316');
  sunset.addColorStop(0.3, '#ea580c');
  sunset.addColorStop(0.7, '#7c2d12');
  sunset.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sunset;
  ctx.fillRect(0, 0, w, horizon);

  // Highway converging
  ctx.fillStyle = '#1c1917';
  ctx.beginPath();
  ctx.moveTo(w * 0.48, horizon);
  ctx.lineTo(w * 0.52, horizon);
  ctx.lineTo(w * 0.85, h);
  ctx.lineTo(w * 0.15, h);
  ctx.closePath();
  ctx.fill();

  // Yellow dashed road line
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 4;
  ctx.setLineDash([20, 15]);
  ctx.beginPath();
  ctx.moveTo(w * 0.5, horizon);
  ctx.lineTo(w * 0.5, h);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCinematicNebula(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  // Deep space swirling cosmic dust and stars
  for (let i = 0; i < 120; i++) {
    const sx = (Math.sin(i * 99 + seed) * 0.5 + 0.5) * w;
    const sy = (Math.cos(i * 33 + seed) * 0.5 + 0.5) * h;
    const sRadius = (i % 5 === 0) ? 2.5 : 1.2;
    ctx.fillStyle = i % 3 === 0 ? '#93c5fd' : '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, sy, sRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Glowing nebula cloud
  const nebGrad = ctx.createRadialGradient(w * 0.4, h * 0.45, 20, w * 0.4, h * 0.45, w * 0.4);
  nebGrad.addColorStop(0, 'rgba(147, 51, 234, 0.4)');
  nebGrad.addColorStop(0.4, 'rgba(59, 130, 246, 0.25)');
  nebGrad.addColorStop(0.8, 'rgba(6, 182, 212, 0.1)');
  nebGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = nebGrad;
  ctx.beginPath();
  ctx.arc(w * 0.4, h * 0.45, w * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawFilmGrain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const grainCount = (w * h) / 120;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  for (let i = 0; i < grainCount; i++) {
    const gx = Math.random() * w;
    const gy = Math.random() * h;
    ctx.fillRect(gx, gy, 1.5, 1.5);
  }
}
