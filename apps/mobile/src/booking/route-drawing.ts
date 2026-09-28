/** Equal Mercator scale on both axes keeps route proportions on phones and tablets. */
export function routeDrawing(coordinates: [number, number][]) {
  const points = coordinates.map(([lng, lat]) => ({ x: lng * Math.PI / 180, y: -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) }));
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(296 / Math.max(maxX - minX, 1e-9), 156 / Math.max(maxY - minY, 1e-9));
  const result = points.map((p) => ({ x: 180 + (p.x - (minX + maxX) / 2) * scale, y: 110 + (p.y - (minY + maxY) / 2) * scale }));
  return { line: result.map((p) => `${p.x},${p.y}`).join(' '), start: result[0], end: result[result.length - 1] };
}
