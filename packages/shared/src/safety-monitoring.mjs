/** Experimental foreground signals, not a crash diagnosis or a scream classifier. */
export const SAFETY_COUNTDOWN_MS = 30_000;
export const SAFETY_SIGNAL_LABELS = Object.freeze({ impact: 'Possible crash', distress: 'Possible loud distress', manual: 'Panic alert' });
export const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
export function signalQualifies(s) {
  if (!s || !finite(s.capturedAt, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (s.kind === 'manual') return true;
  if (s.kind === 'impact') return finite(s.peakG, 4, 30) && finite(s.speedBefore, 5, 80)
    && finite(s.speedAfter, 0, 2) && finite(s.windowMs, 500, 10_000);
  return s.kind === 'distress' && finite(s.levelDb, -12, 0) && finite(s.durationMs, 2500, 10_000);
}
export function createSignalDetector(emit) {
  let speed = null, impact = null, loudSince = null, lastAudio = null, cooldown = 0;
  const send = (s) => { if (s.capturedAt < cooldown || !signalQualifies(s)) return; cooldown = s.capturedAt + 120_000; emit(s); };
  return {
    speed(value, at) {
      if (!finite(value, 0, 80)) { speed = null; return; }
      if (impact && at - impact.at >= 500 && at - impact.at <= 10_000 && value <= 2) {
        send({ kind: 'impact', peakG: impact.g, speedBefore: impact.speed, speedAfter: value, windowMs: at - impact.at, capturedAt: at }); impact = null;
      }
      speed = { value, at };
    },
    motion(g, at) {
      if (finite(g, 4, 30) && speed?.value >= 5 && at >= speed.at && at - speed.at <= 5000 && (!impact || at - impact.at > 10_000))
        impact = { g, at, speed: speed.value };
    },
    audio(db, at) {
      if (lastAudio === null || at - lastAudio > 500 || at < lastAudio) loudSince = null;
      lastAudio = at;
      if (!finite(db, -12, 0)) { loudSince = null; return; }
      loudSince ??= at;
      if (at - loudSince >= 2500) { send({ kind: 'distress', levelDb: db, durationMs: Math.min(10_000, at - loudSince), capturedAt: at }); loudSince = at; }
    },
  };
}
export function pointDistance(a, b) {
  const rad = Math.PI / 180, x = (a.lng - b.lng) * rad * Math.cos((a.lat + b.lat) / 2 * rad), y = (a.lat - b.lat) * rad;
  return Math.hypot(x, y) * 6371000;
}
/** Warnings use observed points, never label an unchecked route safe. */
export function nearbyZones(zones, points, now) {
  return zones.filter(z => z.expiresAt > now && points.some(p => p && finite(p.lat, -90, 90) && finite(p.lng, -180, 180)
    && pointDistance(z, p) <= z.radiusM + (finite(p.accuracy, 0, 200) ? p.accuracy : 0)));
}
export function routeWarnings(zones, coordinates, now) {
  if (!Array.isArray(coordinates)) return [];
  return zones.filter(z => z.expiresAt > now && coordinates.some((b,i)=>{
    const a=coordinates[i-1];if(!a||![...a,...b].every(Number.isFinite))return false;
    const scale=Math.PI/180*6371000,cos=Math.cos(z.lat*Math.PI/180);
    const ax=(a[0]-z.lng)*scale*cos,ay=(a[1]-z.lat)*scale,bx=(b[0]-z.lng)*scale*cos,by=(b[1]-z.lat)*scale;
    const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(ax+t*dx,ay+t*dy)<=z.radiusM;
  }));
}
