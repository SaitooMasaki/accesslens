const BACKEND_URL = 'https://api.accesslens.cc';

async function getJwt() {
  const data = await chrome.storage.local.get('al_backend_jwt');
  return data['al_backend_jwt'] ?? null;
}

export async function fetchSites() {
  const jwt = await getJwt();
  if (!jwt) throw new Error('Not authenticated');
  const res = await fetch(`${BACKEND_URL}/api/sites`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch sites (${res.status})`);
  return res.json();
}

export async function createSite({ url, label, scan_interval }) {
  const jwt = await getJwt();
  const res = await fetch(`${BACKEND_URL}/api/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ url, label: label || undefined, scan_interval }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.errors?.[0]?.msg ?? err.error ?? 'Failed to create site');
  }
  return res.json();
}

export async function updateSite(id, { label, scan_interval }) {
  const jwt = await getJwt();
  const res = await fetch(`${BACKEND_URL}/api/sites/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ label, scan_interval }),
  });
  if (!res.ok) throw new Error('Failed to update site');
  return res.json();
}

export async function deleteSite(id) {
  const jwt = await getJwt();
  const res = await fetch(`${BACKEND_URL}/api/sites/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok && res.status !== 404) throw new Error('Failed to delete site');
}
