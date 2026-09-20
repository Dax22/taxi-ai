import { el, table, count, money, shortDay } from './ui.mjs';
import { RIDE_STATUS_LABELS } from '/shared/trip-lifecycle.mjs';

let serial = 0;
function svgNode(tag, attributes = {}, text = null) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== null) node.textContent = String(text); return node;
}
function canvas(title, height) {
  const id = `chart-title-${++serial}`, svg = svgNode('svg', { viewBox: `0 0 660 ${height}`, class: 'chart', role: 'img', 'aria-labelledby': id });
  svg.append(svgNode('title', { id }, title)); return svg;
}
/** Exact values stay in the accessible table; integer ratios determine geometry. */
export function trend(days, financial = false) {
  const wrap = el('div'), legend = el('div', null, 'legend');
  const series = financial ? [['completedFareKobo', 'Completed fares'], ['simulatedPaidKobo', 'Paid · simulated']]
    : [['requests', 'Requests'], ['completed', 'Completed']];
  series.forEach(([, label], index) => { const item = el('span'); item.append(el('i', null, `swatch${index ? ' yellow' : ''}`), document.createTextNode(label)); legend.append(item); });
  const svg = canvas(financial ? 'Completed fares and simulated payments by request date' : 'Requests and completed trips by request date', 256);
  const values = days.flatMap((day) => series.map(([key]) => BigInt(day[key]))), maximum = values.reduce((a, b) => a > b ? a : b, 1n);
  const x = (index) => 60 + (days.length === 1 ? 280 : index * 570 / Math.max(1, days.length - 1));
  const y = (value) => 210 - Number(BigInt(value) * 10000n / maximum) / 10000 * 182;
  for (let step = 0; step <= 4; step++) {
    const amount = maximum * BigInt(step) / 4n, top = 210 - step * 45.5;
    svg.append(svgNode('line', { x1: 60, x2: 630, y1: top, y2: top, class: 'chart-grid' }));
    const label = financial ? (amount / 100n).toLocaleString('en-NG', { notation: 'compact', maximumFractionDigits: 1 }) : amount.toString();
    svg.append(svgNode('text', { x: 49, y: top + 4, 'text-anchor': 'end', class: 'chart-label' }, label));
  }
  series.forEach(([key, label], index) => {
    svg.append(svgNode('polyline', { points: days.map((day, i) => `${x(i)},${y(day[key])}`).join(' '), class: index ? 'chart-secondary' : 'chart-primary' }));
    days.forEach((day, i) => {
      const dot = svgNode('circle', { cx: x(i), cy: y(day[key]), r: days.length > 60 ? 1.5 : 3.5, class: `chart-dot${index ? ' secondary' : ''}` });
      dot.append(svgNode('title', {}, `${day.date} · ${label}: ${financial ? money(day[key]) : count(day[key])}`)); svg.append(dot);
    });
  });
  const ticks = new Set([0, ...Array.from({ length: 5 }, (_, i) => Math.round(i * Math.max(0, days.length - 1) / 4)), days.length - 1]);
  for (const index of ticks) if (days[index]) svg.append(svgNode('text', { x: x(index), y: 241, 'text-anchor': 'middle', class: 'chart-label' }, shortDay(days[index].date)));
  const details = el('details', null, 'chart-details'); details.append(el('summary', 'View daily values'));
  details.append(table(['Request date', ...series.map(([, label]) => label)], days.map((day) => [day.date, ...series.map(([key]) => financial ? money(day[key]) : count(day[key]))])));
  const frame = el('div', null, 'chart-frame', { tabindex: '0', role: 'region', 'aria-label': 'Daily trend chart; scroll horizontally on small screens or open daily values below' });
  frame.append(svg); wrap.append(legend, frame, details); return wrap;
}
export function statuses(rows) {
  const shown = rows.filter((row) => row.count > 0), list = el('div', null, 'status-list');
  if (!shown.length) return el('p', 'Status distribution will appear when a journey is requested.', 'definition-note');
  const max = Math.max(...shown.map((row) => row.count));
  shown.forEach((row) => {
    const item = el('div'), title = el('div', null, 'status-title');
    title.append(el('span', RIDE_STATUS_LABELS[row.status] ?? row.status), el('strong', count(row.count)));
    const bar = svgNode('svg', { viewBox: '0 0 600 10', 'aria-hidden': 'true', class: 'status-bar' });
    bar.append(svgNode('rect', { x: 0, y: 0, width: 600, height: 10, rx: 5, class: 'chart-track' }),
      svgNode('rect', { x: 0, y: 0, width: row.count / max * 600, height: 10, rx: 5, class: 'chart-bar' }));
    item.append(title, bar); list.append(item);
  }); return list;
}
