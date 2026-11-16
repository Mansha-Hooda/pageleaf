import {
  curlCrease,
  lineSegmentInRect,
  polygonArea,
  reflectPoint,
  reflectionMatrix,
  splitByCrease,
  type Pt,
} from './geometry';

export const PAPER = '#f4efe4';
export const PAPER_BACK = '#efe4d2';
export const BOARD = '#e4d5bc';

export type PageImages = {
  front: CanvasImageSource | null;
  under: CanvasImageSource | null;
  /** Verso printed on the back of this sheet. Null shows bare paper. */
  back: CanvasImageSource | null;
};

let grain: CanvasPattern | null | undefined;

function paperGrain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grain !== undefined) return grain;
  const tile = document.createElement('canvas');
  tile.width = 96;
  tile.height = 96;
  const g = tile.getContext('2d');
  if (!g) {
    grain = null;
    return null;
  }
  const image = g.createImageData(96, 96);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = 228 + Math.random() * 22;
    image.data[i] = n;
    image.data[i + 1] = n - 8;
    image.data[i + 2] = n - 20;
    image.data[i + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  grain = ctx.createPattern(tile, 'repeat');
  return grain;
}

function trace(ctx: CanvasRenderingContext2D, poly: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

function pageClip(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
}

/**
 * Draw the sheet currently in the hand. `corner` is the point on the page that
 * is stuck to the finger; `target` is where that point has moved. At rest,
 * target equals corner. When the page has landed, target is the mirror of
 * corner across the spine, and the flap occupies the facing page exactly.
 */
export function drawCurl(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  images: PageImages,
  corner: Pt,
  target: Pt,
) {
  const crease = curlCrease(corner, target);
  if (!crease) {
    drawRestingPage(ctx, w, h, images.front);
    return;
  }

  const { front, peel } = splitByCrease(w, h, crease.origin, crease.normal);
  const coverage = polygonArea(peel) / Math.max(1, w * h);
  const lift = Math.sin(Math.max(0, Math.min(1, coverage)) * Math.PI);

  ctx.save();
  pageClip(ctx, w, h);
  drawContained(ctx, images.under, w, h, PAPER);

  if (peel.length >= 3 && lift > 0.02) {
    ctx.save();
    trace(ctx, peel);
    ctx.clip();
    const reach = Math.max(w, h) * 0.28;
    const g = ctx.createLinearGradient(
      crease.origin.x,
      crease.origin.y,
      crease.origin.x + crease.normal.x * reach,
      crease.origin.y + crease.normal.y * reach,
    );
    g.addColorStop(0, `rgba(36, 22, 10, ${0.42 * lift})`);
    g.addColorStop(0.18, `rgba(36, 22, 10, ${0.16 * lift})`);
    g.addColorStop(1, 'rgba(36, 22, 10, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w, -h, w * 3, h * 3);
    ctx.restore();
  }

  if (front.length >= 3) {
    ctx.save();
    trace(ctx, front);
    ctx.clip();
    drawContained(ctx, images.front, w, h, PAPER);
    if (lift > 0.02) {
      const g = ctx.createLinearGradient(
        crease.origin.x,
        crease.origin.y,
        crease.origin.x - crease.normal.x * 28,
        crease.origin.y - crease.normal.y * 28,
      );
      g.addColorStop(0, `rgba(40, 24, 10, ${0.32 * lift})`);
      g.addColorStop(1, 'rgba(40, 24, 10, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(-w, -h, w * 3, h * 3);
    }
    ctx.restore();
  }
  ctx.restore();

  if (peel.length < 3) return;
  const flap = peel.map((p) => reflectPoint(p, crease.origin, crease.normal));
  if (flap.length < 3) return;

  if (lift > 0.04) {
    ctx.save();
    ctx.shadowColor = `rgba(20, 12, 6, ${0.45 * lift})`;
    ctx.shadowBlur = 22 + lift * 10;
    ctx.shadowOffsetX = -crease.normal.x * 8;
    ctx.shadowOffsetY = 12 + lift * 6;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
    trace(ctx, flap);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  trace(ctx, flap);
  ctx.clip();
  const [a, b, c, d, e, f] = reflectionMatrix(crease.origin, crease.normal);
  ctx.transform(a, b, c, d, e, f);
  paintBack(ctx, w, h, images);
  if (lift > 0.05) {
    const curl = ctx.createLinearGradient(
      crease.origin.x,
      crease.origin.y,
      crease.origin.x + crease.normal.x * 64,
      crease.origin.y + crease.normal.y * 64,
    );
    curl.addColorStop(0, `rgba(255, 250, 240, ${0.5 * lift})`);
    curl.addColorStop(0.07, `rgba(90, 60, 30, ${0.05 * lift})`);
    curl.addColorStop(0.18, `rgba(40, 24, 10, ${0.32 * lift})`);
    curl.addColorStop(0.5, `rgba(40, 24, 10, ${0.06 * lift})`);
    curl.addColorStop(1, 'rgba(40, 24, 10, 0)');
    ctx.fillStyle = curl;
    ctx.fillRect(-w, -h, w * 3, h * 3);
  }
  ctx.restore();

  const seg = lineSegmentInRect(w, h, crease.origin, crease.tangent);
  if (seg && lift > 0.15) {
    ctx.save();
    ctx.globalAlpha = lift;
    ctx.strokeStyle = 'rgba(255, 250, 242, 0.8)';
    ctx.lineWidth = 1.25;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 244, 220, 0.85)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(seg[0].x, seg[0].y);
    ctx.lineTo(seg[1].x, seg[1].y);
    ctx.stroke();
    ctx.restore();
  }
}

function paintBack(ctx: CanvasRenderingContext2D, w: number, h: number, images: PageImages) {
  const grainFill = paperGrain(ctx);
  ctx.fillStyle = grainFill ?? PAPER_BACK;
  ctx.fillRect(0, 0, w, h);
  if (images.back) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(images.back, 0, 0, w, h);
    ctx.restore();
  } else if (images.front) {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.drawImage(images.front, 0, 0, w, h);
    ctx.restore();
  }
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource | null,
  w: number,
  h: number,
  fallback: string,
) {
  if (!image) {
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  ctx.drawImage(image, 0, 0, w, h);
}

export function drawRestingPage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  image: CanvasImageSource | null,
) {
  ctx.save();
  pageClip(ctx, w, h);
  drawContained(ctx, image, w, h, PAPER);
  ctx.restore();
}

export function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  pageClip(ctx, w, h);
  ctx.fillStyle = BOARD;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(90, 58, 28, 0.18)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.restore();
}

export function drawForeEdge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  side: 'left' | 'right',
  pages: number,
) {
  const strips = Math.max(0, Math.min(12, Math.round(Math.sqrt(Math.max(0, pages)))));
  if (strips <= 0) return;
  for (let i = strips; i >= 1; i--) {
    const tone = 226 - (i % 2) * 12 - i;
    ctx.fillStyle = `rgb(${tone}, ${tone - 8}, ${tone - 20})`;
    const inset = 3 + i * 0.35;
    if (side === 'right') {
      ctx.fillRect(x + w + (i - 1) * 1.2, y + inset, 1.2, h - inset * 2);
    } else {
      ctx.fillRect(x - i * 1.2, y + inset, 1.2, h - inset * 2);
    }
  }
}

export function drawGutter(ctx: CanvasRenderingContext2D, spineX: number, y: number, h: number) {
  const reach = 28;
  const left = ctx.createLinearGradient(spineX, y, spineX - reach, y);
  left.addColorStop(0, 'rgba(30, 18, 8, 0.4)');
  left.addColorStop(0.45, 'rgba(30, 18, 8, 0.08)');
  left.addColorStop(1, 'rgba(30, 18, 8, 0)');
  ctx.fillStyle = left;
  ctx.fillRect(spineX - reach, y, reach, h);

  const right = ctx.createLinearGradient(spineX, y, spineX + reach, y);
  right.addColorStop(0, 'rgba(30, 18, 8, 0.45)');
  right.addColorStop(0.4, 'rgba(30, 18, 8, 0.1)');
  right.addColorStop(1, 'rgba(30, 18, 8, 0)');
  ctx.fillStyle = right;
  ctx.fillRect(spineX, y, reach, h);

  ctx.fillStyle = 'rgba(40, 24, 12, 0.55)';
  ctx.fillRect(spineX - 0.6, y, 1.2, h);
}

export function drawBookShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  bottom: number,
  bookW: number,
) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.filter = 'blur(16px)';
  ctx.beginPath();
  ctx.ellipse(cx, bottom + 12, bookW * 0.36, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
