// The application's repository SQL deliberately uses a small portable subset.
// This adapter handles that audited subset; schema migrations use native SQL.
// Values are always bound parameters, never interpolated into the query text.
const identityTables = new Set(['audit_events', 'ride_activity', 'driver_application_events',
  'safety_incident_events', 'safety_notification_events', 'account_notifications', 'push_jobs', 'eats_reviews']);

function quotedEnd(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) if (text[i] === quote) {
    if (text[i + 1] === quote) i++;
    else return i + 1;
  }
  throw new TypeError('Unterminated SQL string or identifier.');
}
function closingParen(text, start) {
  let depth = 1;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "'" || text[i] === '"') { i = quotedEnd(text, i) - 1; continue; }
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return i;
  }
  throw new TypeError('Unbalanced SQL expression.');
}
function argsOf(text) {
  const result = []; let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "'" || text[i] === '"') { i = quotedEnd(text, i) - 1; continue; }
    if (text[i] === '(') { i = closingParen(text, i); continue; }
    if (text[i] === ',') { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  result.push(text.slice(start).trim()); return result;
}
function jsonPath(value) {
  if (!/^'\$(?:\.[A-Za-z_][A-Za-z0-9_]*)*'$/.test(value)) throw new TypeError('Unsupported JSON path in repository SQL.');
  return value.slice(2, -1).split('.').filter(Boolean);
}
function extractJson(args, asJson = false) {
  const path = jsonPath(args[1]);
  const access = `((${args[0]})::jsonb ${asJson ? '#>' : '#>>'} '{${path.join(',')}}')`;
  if (asJson) return access;
  if (['amountKobo'].includes(path.at(-1))) return `(${access})::bigint`;
  if (['pickupEnabled', 'deliveryEnabled'].includes(path.at(-1))) {
    return `(CASE ${access} WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE (${access})::bigint END)`;
  }
  return access;
}
function functions(sql) {
  let output = '';
  for (let i = 0; i < sql.length;) {
    if (sql[i] === "'" || sql[i] === '"') { const end = quotedEnd(sql, i); output += sql.slice(i, end); i = end; continue; }
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i));
    if (!match) { output += sql[i++]; continue; }
    const word = match[0], end = i + word.length;
    const offset = /^\s*\(/.exec(sql.slice(end));
    if (!offset || !['json_extract', 'json_type', 'json_each', 'json_object', 'json_valid', 'instr', 'max', 'sum'].includes(word.toLowerCase())) {
      output += word; i = end; continue;
    }
    const open = end + offset[0].length - 1, close = closingParen(sql, open);
    const args = argsOf(sql.slice(open + 1, close)).map(functions);
    switch (word.toLowerCase()) {
      case 'json_extract': output += extractJson(args); break;
      case 'json_type': output += `jsonb_typeof(${extractJson(args, true)})`; break;
      case 'json_valid': output += `((${args[0]})::jsonb IS NOT NULL)`; break;
      case 'json_object': output += `(jsonb_build_object(${args.join(',')})::text)`; break;
      case 'json_each': output += `jsonb_array_elements_text(COALESCE(${args.length > 1 ? extractJson(args, true) : `(${args[0]})::jsonb`},'[]'::jsonb)) AS json_each(value)`; break;
      case 'instr': output += `strpos(${args.join(',')})`; break;
      case 'max': output += `${args.length > 1 ? 'GREATEST' : 'MAX'}(${args.join(',')})`; break;
      case 'sum': output += /^CASE\b/i.test(args[0]) || !/\bIS\b|[<>=]/i.test(args[0])
        ? `SUM(${args[0]})` : `SUM(CASE WHEN ${args[0]} THEN 1 ELSE 0 END)`; break;
    }
    i = close + 1;
  }
  return output;
}

export function compilePostgresQuery(source, args = [], { identity = false } = {}) {
  if (/\b(?:PRAGMA|sqlite_master|AUTOINCREMENT)\b/i.test(source)) throw new TypeError('SQLite administration requires the SQLite database.');
  let sql = functions(source.trim().replace(/;\s*$/, ''));
  const ignore = /^INSERT\s+OR\s+IGNORE\s+/i.test(sql);
  if (ignore) sql = sql.replace(/^INSERT\s+OR\s+IGNORE\s+/i, 'INSERT ');
  const upsertTable = /^INSERT\s+INTO\s+([a-z_]+)\b/i.exec(sql)?.[1];
  if (upsertTable && /ON\s+CONFLICT[\s\S]*DO\s+UPDATE/i.test(sql)) {
    // Both the target and EXCLUDED expose these counters in PostgreSQL.
    sql = sql.replace(/(\b(version|count|attempts|revision)\s*=\s*)\2(\s*\+)/gi,
      (_, assignment, column, plus) => `${assignment}${upsertTable}.${column}${plus}`);
  }
  // A scalar MAX in this existing upsert needs an explicit target qualifier.
  if (/INSERT\s+INTO\s+chat_reads\b/i.test(sql)) sql = sql.replace(/GREATEST\(through_sequence,/i, 'GREATEST(chat_reads.through_sequence,');
  // SQLite compares boolean results with integer cursors; preserve that contract.
  sql = sql.replace(/\(status IN \('delivered','cancelled','rejected'\)\)/g,
    "(CASE WHEN status IN ('delivered','cancelled','rejected') THEN 1 ELSE 0 END)");
  const named = args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && !ArrayBuffer.isView(args[0]);
  const parameters = [], names = new Map(); let positional = 0, text = '';
  for (let i = 0; i < sql.length;) {
    if (sql[i] === "'" || sql[i] === '"') { const end = quotedEnd(sql, i); text += sql.slice(i, end); i = end; continue; }
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i); if (end === -1) { text += sql.slice(i); break; } text += sql.slice(i, end); i = end; continue; }
    if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); if (end === -1) throw new TypeError('Unterminated SQL comment.'); text += sql.slice(i, end + 2); i = end + 2; continue; }
    if (sql[i] === '?') {
      if (named || positional >= args.length) throw new TypeError('Missing positional SQL parameter.');
      parameters.push(args[positional++]); text += `$${parameters.length}`;
      if (/^\s+IS\s+(?:NOT\s+)?NULL\b/i.test(sql.slice(i + 1))) text += '::text';
      i++; continue;
    }
    const name = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(sql.slice(i));
    if (name) {
      if (!named || !Object.hasOwn(args[0], name[1])) throw new TypeError('Missing named SQL parameter.');
      if (!names.has(name[1])) { parameters.push(args[0][name[1]]); names.set(name[1], parameters.length); }
      text += `$${names.get(name[1])}`; i += name[0].length; continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i));
    if (word) {
      const token = word[0];
      text += token === 'rowid' ? '_insert_order' : /^[a-z_]/.test(token) && /[a-z][A-Z]/.test(token) ? `"${token}"` : token;
      i += token.length; continue;
    }
    text += sql[i++];
  }
  if (!named && positional !== args.length) throw new TypeError('Too many positional SQL parameters.');
  if (ignore) text += ' ON CONFLICT DO NOTHING';
  const insertedTable = /^INSERT\s+INTO\s+"?([a-z_]+)"?/i.exec(text)?.[1];
  if (identity && identityTables.has(insertedTable) && !/\bRETURNING\b/i.test(text)) text += ' RETURNING id';
  return { text, values: parameters.map((value) => ArrayBuffer.isView(value) && !Buffer.isBuffer(value)
    ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : value) };
}
