export class AdminApiError extends Error {
  constructor(message, status = 0, code = null) { super(message); this.status = status; this.code = code; }
}
/** Cookie credentials and CSRF stay in this client; no browser storage or analytics SDK. */
export function createAdminClient({ fetchImpl = fetch } = {}) {
  let csrf = null;
  async function request(path, { data, signal, key } = {}) {
    if (!(path.startsWith('/api/admin/console/') || path === '/api/auth/logout')) throw new Error('Unsupported staff endpoint.');
    const timeout = new AbortController(), expired = setTimeout(() => timeout.abort(), 15000);
    try {
      const response = await fetchImpl(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
        headers: { Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const body = await response.json();
      if (!response.ok) throw new AdminApiError(body.error?.message ?? 'Unable to load the dashboard.', response.status, body.error?.code);
      return body;
    } finally { clearTimeout(expired); }
  }
  async function evidenceExport(path,{data,signal,key}={}) {
    if(path!=='/api/admin/console/investigations/export')throw new Error('Unsupported evidence export.');
    const timeout=new AbortController(),expired=setTimeout(()=>timeout.abort(),45_000);
    try {
      const response=await fetchImpl(path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        signal:signal?AbortSignal.any([signal,timeout.signal]):timeout.signal,
        headers:{Accept:'application/zip','Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},
        body:JSON.stringify(data)});
      if(!response.ok){let body;try{body=await response.json();}catch{}throw new AdminApiError(body?.error?.message??'Evidence export refused.',response.status,body?.error?.code);}
      const hash=response.headers.get('X-Evidence-SHA256'),id=response.headers.get('X-Evidence-Export-ID');
      const contentType=response.headers.get('Content-Type')??'';
      const disposition=response.headers.get('Content-Disposition')??'';
      const filename=disposition.match(/filename="(taxi-ai-evidence-[a-z0-9-]+\.zip)"/i)?.[1];
      if(!/^application\/zip(?:;|$)/i.test(contentType)||!filename||!hash||!/^[a-f0-9]{64}$/.test(hash)||!id||!/^[a-f0-9-]{36}$/.test(id))
        throw new AdminApiError('The server did not provide valid evidence archive headers.');
      if(Number(response.headers.get('Content-Length')??0)>15*1024*1024)throw new AdminApiError('This evidence package exceeds the secure download limit.');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(!bytes.length||bytes.length>15*1024*1024)throw new AdminApiError('The evidence package size is invalid.');
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
      if(digest!==hash)throw new AdminApiError('The archive checksum does not match the server receipt. Do not disclose this file.');
      return {bytes,sha256:hash,filename,exportId:id};
    }finally{clearTimeout(expired);}
  }
  return Object.freeze({
    request, evidenceExport,
    session: (signal) => request('/api/admin/console/session', { signal }),
    setCsrf(value) { csrf = value; },
    login: (data, signal) => request('/api/admin/console/login', { data, signal }),
    logout: () => request('/api/auth/logout', { data: {} }),
    reset() { csrf = null; },
  });
}
