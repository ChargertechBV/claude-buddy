// What the pane's two Raster drawings share: packing cells, and colour maths.

/** The terminal's own background, as a Raster colour. */
export const DEFAULT_BG = 0x01000000
export const GREEN = 0x1db954
export const DIM = 0x4a4a4a
/** Lower-eighth blocks: index = eighths filled, 0 a space. */
export const BLOCKS = [0x20, 0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587, 0x2588]

/** A fresh cell buffer: `columns * rows` cells, each a space on the default background. */
export function blankCells(columns: number, rows: number): Uint32Array {
  const words = new Uint32Array(columns * rows * 3)
  for (let i = 0; i < words.length; i += 3) {
    words[i] = 0x20
    words[i + 1] = DEFAULT_BG
    words[i + 2] = DEFAULT_BG
  }
  return words
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64, as RasterProps.cells wants it; the module has no Buffer. */
export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    out += B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | (b >> 4))
    out += i + 1 < bytes.length ? B64.charAt(((b & 15) << 2) | (c >> 6)) : '='
    out += i + 2 < bytes.length ? B64.charAt(c & 63) : '='
  }
  return out
}

/** A cell buffer as the `cells` string of a Raster or a blit. */
export function packCells(words: Uint32Array): string {
  return base64(new Uint8Array(words.buffer))
}

/** Hue 0..360, saturation and value 0..1, to 0xRRGGBB. */
export function hsv(h: number, sat: number, val: number): number {
  const c = val * sat
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = val - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255)))
  return (to(r) << 16) | (to(g) << 8) | to(b)
}

/** The colour scaled by `k`: 0 black, 1 as it was. */
export function dim(rgb: number, k: number): number {
  const c = (sh: number) => Math.round(((rgb >> sh) & 255) * k)
  return (c(16) << 16) | (c(8) << 8) | c(0)
}

/** The colour `t` of the way from `a` to `b`. */
export function lerpRgb(a: number, b: number, t: number): number {
  const c = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t)
  return (c(16) << 16) | (c(8) << 8) | c(0)
}
