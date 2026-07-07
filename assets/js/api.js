/* Helper fetch JSON dengan CSRF. */
const api = {
  async request(method, url, body) {
    const opts = {
      method,
      headers: { 'X-CSRF-Token': window.CSRF || '' },
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* bukan JSON */ }
    if (!res.ok || !data || data.ok === false) {
      throw new Error((data && data.error) || 'Terjadi kesalahan pada server (' + res.status + ').');
    }
    return data;
  },
  get:  (url)       => api.request('GET', url),
  post: (url, body) => api.request('POST', url, body),
  put:  (url, body) => api.request('PUT', url, body),
  del:  (url)       => api.request('DELETE', url),

  async upload(url, formData) {
    formData.append('csrf', window.CSRF || '');
    const res = await fetch(url, { method: 'POST', body: formData, headers: { 'X-CSRF-Token': window.CSRF || '' } });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok === false) {
      throw new Error((data && data.error) || 'Unggahan gagal (' + res.status + ').');
    }
    return data;
  },
};
