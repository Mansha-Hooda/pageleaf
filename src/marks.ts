import { clamp } from './geometry';

export type NormPoint = { x: number; y: number; p: number };

export type StrokeMark = {
  id: string;
  bookId: string;
  page: number;
  kind: 'ink' | 'highlight';
  color: string;
  width: number;
  points: NormPoint[];
  note: string;
};

export type BookmarkMark = {
  id: string;
  bookId: string;
  page: number;
  kind: 'bookmark';
  name: string;
  color: string;
};

export type Mark = StrokeMark | BookmarkMark;

export const PEN_COLORS = ['#1c1916', '#1d4e89', '#8f2d2d'];
export const MARKER_COLORS = ['#e2b940', '#7fbe78', '#e59aba'];
export const RIBBON_COLORS = ['#8d2f3a', '#1f6b4a', '#1e3f6e', '#a97820', '#6b3a6e'];

export function drawMarks(
  ctx: CanvasRenderingContext2D,
  marks: StrokeMark[],
  pageW: number,
  pageH: number,
) {
  const highlights = marks.filter((mark) => mark.kind === 'highlight');
  const ink = marks.filter((mark) => mark.kind === 'ink');
  for (const mark of highlights) stroke(ctx, mark, pageW, pageH, true);
  for (const mark of ink) stroke(ctx, mark, pageW, pageH, false);
  for (const mark of highlights) {
    if (!mark.note.trim()) continue;
    const rect = noteRect(mark, pageW, pageH);
    if (!rect) continue;
    drawSlip(ctx, rect);
  }
}

function stroke(
  ctx: CanvasRenderingContext2D,
  mark: StrokeMark,
  pageW: number,
  pageH: number,
  highlight: boolean,
) {
  const pts = mark.points;
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = mark.color;
  ctx.fillStyle = mark.color;
  const base = Math.max(highlight ? 10 : 1.2, mark.width * pageW);
  if (highlight) ctx.globalAlpha = 0.42;
  if (pts.length === 1) {
    ctx.globalAlpha = highlight ? 0.42 : 0.92;
    ctx.beginPath();
    ctx.arc(pts[0].x * pageW, pts[0].y * pageH, base * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (highlight) {
    ctx.lineWidth = base;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * pageW, pts[0].y * pageH);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = ((pts[i].x + pts[i + 1].x) / 2) * pageW;
      const my = ((pts[i].y + pts[i + 1].y) / 2) * pageH;
      ctx.quadraticCurveTo(pts[i].x * pageW, pts[i].y * pageH, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x * pageW, last.y * pageH);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.globalAlpha = 0.92;
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = base * (0.45 + pts[i].p * 0.8);
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x * pageW, pts[i - 1].y * pageH);
    ctx.lineTo(pts[i].x * pageW, pts[i].y * pageH);
    ctx.stroke();
  }
  ctx.restore();
}

export type NoteBox = { x: number; y: number; w: number; h: number; lines: string[]; fontSize: number };

export function noteRect(mark: StrokeMark, pageW: number, pageH: number): NoteBox | null {
  const text = mark.note.trim();
  if (!text || !mark.points.length) return null;
  const anchor = mark.points[mark.points.length - 1];
  const fontSize = clamp(pageH * 0.02, 12, 22);
  const maxW = pageW * 0.36;
  const chars = Math.max(10, Math.floor(maxW / (fontSize * 0.52)));
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > chars && line) {
      lines.push(line);
      line = word;
    } else line = next;
    if (lines.length === 5) break;
  }
  if (line && lines.length < 6) lines.push(line);
  const boxW = maxW;
  const boxH = lines.length * fontSize * 1.35 + fontSize * 0.9;
  let x = anchor.x * pageW + fontSize;
  let y = anchor.y * pageH - boxH * 0.3;
  if (x + boxW > pageW - 8) x = anchor.x * pageW - boxW - fontSize;
  x = clamp(x, 8, Math.max(8, pageW - boxW - 8));
  y = clamp(y, 8, Math.max(8, pageH - boxH - 8));
  return { x, y, w: boxW, h: boxH, lines, fontSize };
}

function drawSlip(ctx: CanvasRenderingContext2D, box: NoteBox) {
  ctx.save();
  ctx.shadowColor = 'rgba(40, 24, 10, 0.28)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#f7f1e3';
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 4);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(90, 60, 30, 0.28)';
  ctx.stroke();
  ctx.fillStyle = '#2a2118';
  ctx.font = `${box.fontSize}px Palatino, "Iowan Old Style", Georgia, serif`;
  ctx.textBaseline = 'top';
  box.lines.forEach((line, index) => {
    ctx.fillText(line, box.x + box.fontSize * 0.45, box.y + box.fontSize * 0.4 + index * box.fontSize * 1.35, box.w - box.fontSize);
  });
  ctx.restore();
}

export function strokeAt(
  marks: StrokeMark[],
  pageX: number,
  pageY: number,
  pageW: number,
  pageH: number,
): StrokeMark | null {
  let best: StrokeMark | null = null;
  let bestDist = Infinity;
  for (const mark of marks) {
    const slip = noteRect(mark, pageW, pageH);
    if (
      slip &&
      pageX >= slip.x &&
      pageX <= slip.x + slip.w &&
      pageY >= slip.y &&
      pageY <= slip.y + slip.h
    ) {
      return mark;
    }
    const reach = (mark.kind === 'highlight' ? mark.width * pageW : 8) + 14;
    const dist = distanceToStroke(pageX, pageY, mark.points, pageW, pageH);
    if (dist < reach && dist < bestDist) {
      best = mark;
      bestDist = dist;
    }
  }
  return best;
}

function distanceToStroke(px: number, py: number, pts: NormPoint[], pageW: number, pageH: number) {
  if (!pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(px - pts[0].x * pageW, py - pts[0].y * pageH);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    best = Math.min(
      best,
      distanceToSegment(
        px,
        py,
        pts[i - 1].x * pageW,
        pts[i - 1].y * pageH,
        pts[i].x * pageW,
        pts[i].y * pageH,
      ),
    );
  }
  return best;
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / len, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}
