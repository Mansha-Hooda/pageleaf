export type Pt = { x: number; y: number };

export function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function dot(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Signed area × 2; useful for emptiness checks. */
export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) * 0.5;
}

/**
 * Sutherland–Hodgman clip against the half-plane
 * dot(p - origin, normal) >= 0 when keepPositive, else <= 0.
 */
export function clipHalfPlane(
  poly: Pt[],
  origin: Pt,
  normal: Pt,
  keepPositive: boolean,
): Pt[] {
  if (poly.length === 0) return [];
  const out: Pt[] = [];
  const eps = 1e-6;
  const side = (p: Pt) => dot(sub(p, origin), normal);
  const inside = (s: number) => (keepPositive ? s >= -eps : s <= eps);

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    const aIn = inside(sa);
    const bIn = inside(sb);
    if (aIn && bIn) {
      out.push(b);
    } else if (aIn && !bIn) {
      out.push(intersect(a, b, sa, sb));
    } else if (!aIn && bIn) {
      out.push(intersect(a, b, sa, sb));
      out.push(b);
    }
  }
  return out;
}

function intersect(a: Pt, b: Pt, sa: number, sb: number): Pt {
  const denom = sa - sb;
  const t = Math.abs(denom) < 1e-8 ? 0 : sa / denom;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function reflectPoint(p: Pt, origin: Pt, normal: Pt): Pt {
  const d = dot(sub(p, origin), normal);
  return { x: p.x - 2 * d * normal.x, y: p.y - 2 * d * normal.y };
}

/** Canvas affine matrix that reflects page space across the crease. */
export function reflectionMatrix(origin: Pt, normal: Pt): [number, number, number, number, number, number] {
  const nx = normal.x;
  const ny = normal.y;
  const nd = dot(origin, normal);
  const a = 1 - 2 * nx * nx;
  const c = -2 * nx * ny;
  const b = -2 * nx * ny;
  const d = 1 - 2 * ny * ny;
  const e = 2 * nd * nx;
  const f = 2 * nd * ny;
  return [a, b, c, d, e, f];
}

export function pageRect(w: number, h: number): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

/** Perpendicular bisector between the grabbed point and where it has moved. */
export function curlCrease(corner: Pt, target: Pt): { origin: Pt; normal: Pt; tangent: Pt } | null {
  const dx = corner.x - target.x;
  const dy = corner.y - target.y;
  const l = Math.hypot(dx, dy);
  if (l < 0.75) return null;
  const normal = { x: dx / l, y: dy / l };
  return {
    origin: { x: (corner.x + target.x) / 2, y: (corner.y + target.y) / 2 },
    normal,
    tangent: { x: -normal.y, y: normal.x },
  };
}

export function splitByCrease(
  w: number,
  h: number,
  origin: Pt,
  normal: Pt,
): { front: Pt[]; peel: Pt[] } {
  const rect = pageRect(w, h);
  return {
    front: clipHalfPlane(rect, origin, normal, false),
    peel: clipHalfPlane(rect, origin, normal, true),
  };
}

/** Where the infinite line through `origin` in `direction` crosses the page rectangle. */
export function lineSegmentInRect(w: number, h: number, origin: Pt, direction: Pt): [Pt, Pt] | null {
  const hits: Pt[] = [];
  const consider = (p: Pt) => {
    if (p.x >= -1 && p.x <= w + 1 && p.y >= -1 && p.y <= h + 1) hits.push(p);
  };
  if (Math.abs(direction.x) > 1e-6) {
    for (const xEdge of [0, w]) {
      const t = (xEdge - origin.x) / direction.x;
      consider({ x: xEdge, y: origin.y + direction.y * t });
    }
  }
  if (Math.abs(direction.y) > 1e-6) {
    for (const yEdge of [0, h]) {
      const t = (yEdge - origin.y) / direction.y;
      consider({ x: origin.x + direction.x * t, y: yEdge });
    }
  }
  const unique: Pt[] = [];
  for (const p of hits) {
    if (!unique.some((u) => Math.hypot(u.x - p.x, u.y - p.y) < 0.75)) unique.push(p);
  }
  if (unique.length < 2) return null;
  return [unique[0], unique[1]];
}
