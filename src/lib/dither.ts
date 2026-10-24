// Dithers images at build time with sharp and returns them as data URIs, so nothing extra has
// to be saved in the repo. Results are cached per image + settings for the length of the build.

import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type DitherMode = 'fs' | 'atkinson' | 'bayer' | 'color';

export type DitherOptions = {
  /** fs: grainy and photographic. atkinson: higher contrast, shadows go pure black.
   *  bayer: retro crosshatch grid. color: palette pulled from the photo. */
  mode?: DitherMode;
  /** Size of each dither dot in pixels. */
  pixel?: number;
  /** Palette size for `color` mode. */
  colors?: number;
  /** Output width in pixels (height keeps the aspect ratio). Defaults to the source width. */
  width?: number;
  /** Dark and light colours for the 1-bit modes (fs, atkinson, bayer). */
  ink?: string;
  paper?: string;
  /** Input black and white points for the 1-bit modes, like Levels in an image editor.
   *  Lowering the white point pushes mid-tones toward `paper`. */
  levels?: [black: number, white: number];
};

export type Dithered = {
  src: string;
  width: number;
  height: number;
  /** Hex colours used, for `color` mode. */
  palette?: string[];
};

type Kernel = [dx: number, dy: number, weight: number][];
type RGB = [number, number, number];

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function toGray(rgb: Uint8Array, w: number, h: number, [black, white]: [number, number]) {
  const gray = new Float32Array(w * h);
  const scale = 255 / Math.max(1, white - black);
  for (let i = 0; i < w * h; i++) {
    const lum = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    gray[i] = clamp((lum - black) * scale);
  }
  return gray;
}

const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function bitsToRgb(bits: Uint8Array, w: number, h: number, ink: RGB, paper: RGB) {
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) out.set(bits[i] ? paper : ink, i * 3);
  return out;
}

// ---------- 1-bit ----------

// Push the quantization error onto neighbours. The scan is serpentine so the grain doesn't streak.
function errorDiffuse(gray: Float32Array, w: number, h: number, kernel: Kernel) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const i = y * w + x;
      const val = gray[i] < 128 ? 0 : 255;
      const err = gray[i] - val;
      out[i] = val;
      for (const [dx, dy, wt] of kernel) {
        const nx = x + (ltr ? dx : -dx);
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny < h) gray[ny * w + nx] += err * wt;
      }
    }
  }
  return out;
}

const FLOYD_STEINBERG: Kernel = [
  [1, 0, 7 / 16],
  [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16],
];

// Only 6/8 of the error is passed on, which crushes the shadows to black and blows out highlights.
const ATKINSON: Kernel = [
  [1, 0, 1 / 8], [2, 0, 1 / 8],
  [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8],
  [0, 2, 1 / 8],
];

const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

function bayer(gray: Float32Array, w: number, h: number) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const threshold = ((BAYER_8[y & 7][x & 7] + 0.5) / 64) * 255;
      out[y * w + x] = gray[y * w + x] < threshold ? 0 : 255;
    }
  }
  return out;
}

// ---------- color ----------

/** Median cut: split the box with the widest colour range at its median until there are `n`. */
function medianCutPalette(rgb: Uint8Array, n: number): RGB[] {
  const total = rgb.length / 3;
  const step = Math.max(1, Math.floor(total / 60000));
  const pixels: RGB[] = [];
  for (let i = 0; i < total; i += step) pixels.push([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);

  const widest = (box: RGB[]) => {
    const lo = [255, 255, 255], hi = [0, 0, 0];
    for (const p of box) {
      for (let c = 0; c < 3; c++) {
        if (p[c] < lo[c]) lo[c] = p[c];
        if (p[c] > hi[c]) hi[c] = p[c];
      }
    }
    const r = hi.map((v, c) => v - lo[c]);
    const channel = r.indexOf(Math.max(...r));
    return { channel, size: r[channel] };
  };

  const boxes = [pixels];
  while (boxes.length < n) {
    let best = -1, bestSize = 0, bestChannel = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const { channel, size } = widest(box);
      if (size > bestSize) { best = i; bestSize = size; bestChannel = channel; }
    });
    if (best === -1) break;
    const box = boxes[best].sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes.map((box) => {
    const sum = [0, 0, 0];
    for (const p of box) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
    return sum.map((s) => Math.round(s / box.length)) as RGB;
  });
}

function nearest(palette: RGB[], r: number, g: number, b: number) {
  let best = palette[0], bestD = Infinity;
  for (const p of palette) {
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function colorDither(rgb: Uint8Array, w: number, h: number, palette: RGB[]) {
  const buf = Float32Array.from(rgb);
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const i = (y * w + x) * 3;
      const r = clamp(buf[i]), g = clamp(buf[i + 1]), b = clamp(buf[i + 2]);
      const p = nearest(palette, r, g, b);
      out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
      const err = [r - p[0], g - p[1], b - p[2]];
      for (const [dx, dy, wt] of FLOYD_STEINBERG) {
        const nx = x + (ltr ? dx : -dx);
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 3;
        buf[j] += err[0] * wt; buf[j + 1] += err[1] * wt; buf[j + 2] += err[2] * wt;
      }
    }
  }
  return out;
}

// ---------- loading ----------

/** Accepts a remote URL or a path inside `public/` (with or without the site's base). */
async function load(src: string): Promise<Buffer> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const rel = base && src.startsWith(base + '/') ? src.slice(base.length) : src;
  return readFile(path.join(process.cwd(), 'public', rel));
}

type Resolved = Required<Omit<DitherOptions, 'width'>> & Pick<DitherOptions, 'width'>;

const cache = new Map<string, Promise<Dithered>>();

/** Dither an image and return it as a PNG data URI. */
export function dither(src: string, options: DitherOptions = {}) {
  const opts: Resolved = {
    mode: 'fs', pixel: 2, colors: 10, ink: '#000000', paper: '#ffffff', levels: [0, 255],
    // options left as undefined (e.g. unset component props) keep their defaults
    ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)),
  };
  opts.pixel = Math.max(1, Math.round(opts.pixel));
  const key = JSON.stringify([src, opts]);
  let cached = cache.get(key);
  if (!cached) {
    cached = render(src, opts);
    cache.set(key, cached);
  }
  return cached;
}

async function render(
  src: string,
  { mode, pixel, colors, width, ink, paper, levels }: Resolved,
): Promise<Dithered> {
  const input = sharp(await load(src)).rotate(); // respect EXIF orientation
  const meta = await input.metadata();
  const srcW = meta.autoOrient?.width ?? meta.width;
  const srcH = meta.autoOrient?.height ?? meta.height;
  const outW = width ?? srcW;
  const w = Math.max(1, Math.round(outW / pixel));
  const h = Math.max(1, Math.round((outW * srcH) / srcW / pixel));

  const data = new Uint8Array(
    await input
      .flatten({ background: '#ffffff' })
      .resize(w, h, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer(),
  );

  let out: Buffer;
  let palette: RGB[] | undefined;
  if (mode === 'color') {
    palette = medianCutPalette(data, colors);
    out = colorDither(data, w, h, palette);
  } else {
    const gray = toGray(data, w, h, levels);
    const bits =
      mode === 'atkinson' ? errorDiffuse(gray, w, h, ATKINSON)
      : mode === 'bayer' ? bayer(gray, w, h)
      : errorDiffuse(gray, w, h, FLOYD_STEINBERG);
    out = bitsToRgb(bits, w, h, hexToRgb(ink), hexToRgb(paper));
  }

  // The result has at most `colors` distinct colours, so an indexed PNG stores it losslessly.
  const png = await sharp(out, { raw: { width: w, height: h, channels: 3 } })
    .resize(w * pixel, h * pixel, { kernel: 'nearest' })
    .png({ palette: true, colours: palette ? Math.max(2, palette.length) : 2, dither: 0, compressionLevel: 9 })
    .toBuffer();

  return {
    src: `data:image/png;base64,${png.toString('base64')}`,
    width: w * pixel,
    height: h * pixel,
    palette: palette?.map((p) => '#' + p.map((v) => v.toString(16).padStart(2, '0')).join('')),
  };
}
