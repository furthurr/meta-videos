/**
 * test/helpers/probe-media.mjs
 * Inspeccion de los .mp4 descargados usando ffprobe/ffmpeg del sistema.
 *
 *   ffprobe(file)      -> { width, height, duration, codec, hasVideo }
 *   sampleTone(file,t) -> { r, g, b }  (1 pixel promedio del frame en t s)
 *   classifyTone(rgb)  -> "green" | "blue" | "white" | "red" | "other(...)"
 *   probeVideo(file,t) -> { ...ffprobe, rgb, tone }
 *
 * La heuristica de tono es deliberadamente tolerante: el output de meta.ai NO
 * es color solido, asi que se usa solo como senal informativa (no como assert
 * duro). Ver real-colors.spec.mjs.
 */
import { execFileSync } from "node:child_process";

// Permite forzar binarios via env; si "ffprobe"/"ffmpeg" no estan en PATH,
// se reintenta con la ruta tipica de Homebrew en macOS.
const FFPROBE = process.env.MV_FFPROBE || "ffprobe";
const FFMPEG = process.env.MV_FFMPEG || "ffmpeg";
const FFPROBE_ALT = "/opt/homebrew/bin/ffprobe";
const FFMPEG_ALT = "/opt/homebrew/bin/ffmpeg";

function runBuffer(primary, alt, args, opts = {}) {
  try {
    return execFileSync(primary, args, { maxBuffer: 16 * 1024 * 1024, ...opts });
  } catch (e) {
    if (e && e.code === "ENOENT" && alt) {
      return execFileSync(alt, args, { maxBuffer: 16 * 1024 * 1024, ...opts });
    }
    throw e;
  }
}

export function ffprobe(file) {
  const args = [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,codec_name,duration",
    "-show_entries", "format=duration",
    "-of", "json",
    file,
  ];
  const out = runBuffer(FFPROBE, FFPROBE_ALT, args, { encoding: "utf8" });
  let j = {};
  try { j = JSON.parse(out); } catch (e) { j = {}; }
  const s = (j.streams && j.streams[0]) || {};
  const durRaw = s.duration || (j.format && j.format.duration) || "0";
  const duration = parseFloat(durRaw);
  return {
    width: s.width || 0,
    height: s.height || 0,
    codec: s.codec_name || null,
    duration: Number.isFinite(duration) ? duration : 0,
    hasVideo: !!s.codec_name,
  };
}

export function sampleTone(file, atSec = 1) {
  const args = [
    "-v", "error",
    "-ss", String(atSec),
    "-i", file,
    "-frames:v", "1",
    "-vf", "scale=1:1",          // promedia todo el frame a 1x1
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "-",
  ];
  const buf = runBuffer(FFMPEG, FFMPEG_ALT, args); // Buffer (sin encoding)
  if (!buf || buf.length < 3) return null;
  return { r: buf[0], g: buf[1], b: buf[2] };
}

export function classifyTone(rgb) {
  if (!rgb) return "unknown";
  const { r, g, b } = rgb;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  // Blanco: los 3 canales altos y parecidos.
  if (mn > 165 && (mx - mn) < 60) return "white";
  // Verde / azul / rojo dominante (margen tolerante de 18).
  if (g >= r && g >= b && (g - r) > 18 && (g - b) > 18) return "green";
  if (b >= r && b >= g && (b - r) > 18 && (b - g) > 18) return "blue";
  if (r >= g && r >= b && (r - g) > 18 && (r - b) > 18) return "red";
  return `other(${r},${g},${b})`;
}

export function probeVideo(file, atSec = 1) {
  const meta = ffprobe(file);
  // Muestrea hacia la mitad del clip (mas representativo que el primer frame).
  const t = meta.duration > 0 ? Math.min(atSec, meta.duration / 2) : atSec;
  let rgb = null;
  let tone = "unknown";
  try {
    rgb = sampleTone(file, t);
    tone = classifyTone(rgb);
  } catch (e) {
    tone = "tone-error:" + ((e && e.message) || e);
  }
  return { ...meta, rgb, tone };
}
