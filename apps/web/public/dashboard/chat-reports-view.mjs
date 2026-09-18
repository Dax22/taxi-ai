import { $, element } from './dom.mjs';

const reasons = { harassment: 'Harassment or abuse', unsafe_request: 'Unsafe request', spam: 'Spam', other: 'Other concern' };

export function renderChatReports(reports, onReview) {
  const list = $('chat-reports-list');
  list.replaceChildren();
  if (!reports.length) list.append(element('p', 'No messages have been reported.', 'empty-state'));
  for (const report of reports) {
    const row = element('article', undefined, 'chat-report-card');
    row.append(element('strong', reasons[report.reason]),
      element('p', `Reported by ${report.reporterName} · Message from ${report.senderName}`, 'small-note'),
      element('blockquote', report.message.body, 'chat-body'),
      element('p', `${new Date(report.createdAt).toLocaleString()} · Request ${report.message.rideId.slice(0, 8).toUpperCase()}`, 'small-note'));
    if (report.status === 'open') {
      const button = element('button', 'Mark reviewed', 'button button-outline button-small');
      button.type = 'button';
      button.addEventListener('click', () => onReview(report.id));
      row.append(button);
    } else row.append(element('span', 'Reviewed', 'status-badge'));
    list.append(row);
  }
}
