// chrome.storage.local の薄いラッパー。
// クライアント > プロジェクト > スキャン履歴 の階層を保持する。
// Phase2でレコードの syncStatus を 'pending'/'synced' に遷移させるフックは
// markPendingSync() として用意してある。

const KEYS = {
  clients: 'al_clients',
  projects: 'al_projects',
  scans: 'al_scans',
  settings: 'al_settings',
  scanCount: 'al_scan_count'
};

async function getAll(key) {
  const data = await chrome.storage.local.get(key);
  return data[key] || [];
}

async function setAll(key, records) {
  await chrome.storage.local.set({ [key]: records });
}

function activeRecords(records) {
  return records.filter((r) => r.deletedAt === null);
}

// --- Clients ---

async function listClients() {
  return activeRecords(await getAll(KEYS.clients));
}

async function saveClient(client, { skipSync = false } = {}) {
  if (!skipSync) markPendingSync(client);
  const clients = await getAll(KEYS.clients);
  const idx = clients.findIndex((c) => c.id === client.id);
  if (idx >= 0) clients[idx] = client;
  else clients.push(client);
  await setAll(KEYS.clients, clients);
  return client;
}

async function deleteClient(clientId) {
  const clients = await getAll(KEYS.clients);
  const client = clients.find((c) => c.id === clientId);
  if (!client) return;
  client.deletedAt = Date.now();
  client.updatedAt = Date.now();
  await setAll(KEYS.clients, clients);
}

// --- Projects ---

async function listProjects(clientId) {
  const projects = activeRecords(await getAll(KEYS.projects));
  return clientId ? projects.filter((p) => p.clientId === clientId) : projects;
}

async function saveProject(project, { skipSync = false } = {}) {
  if (!skipSync) markPendingSync(project);
  const projects = await getAll(KEYS.projects);
  const idx = projects.findIndex((p) => p.id === project.id);
  if (idx >= 0) projects[idx] = project;
  else projects.push(project);
  await setAll(KEYS.projects, projects);
  return project;
}

// --- Scans ---

async function listScans(projectId) {
  const scans = activeRecords(await getAll(KEYS.scans));
  const filtered = projectId ? scans.filter((s) => s.projectId === projectId) : scans;
  return filtered.sort((a, b) => b.scannedAt - a.scannedAt);
}

async function saveScan(scan) {
  const scans = await getAll(KEYS.scans);
  scans.push(scan);
  await setAll(KEYS.scans, scans);
  return scan;
}

// --- Settings (white-label company info, accent color, default WCAG level) ---

async function getSettings() {
  const data = await chrome.storage.local.get(KEYS.settings);
  return (
    data[KEYS.settings] || {
      companyName: '',
      logoDataUrl: '',
      accentColor: '#2563EB',
      defaultWcagLevel: 'AA'
    }
  );
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [KEYS.settings]: settings });
  return settings;
}

// --- Daily scan count (Free plan limit) ---

async function getScanCountToday() {
  const data = await chrome.storage.local.get(KEYS.scanCount);
  const record = data[KEYS.scanCount];
  const today = new Date().toISOString().slice(0, 10);
  if (!record || record.date !== today) return 0;
  return record.count;
}

async function incrementScanCountToday() {
  const today = new Date().toISOString().slice(0, 10);
  const current = await getScanCountToday();
  await chrome.storage.local.set({ [KEYS.scanCount]: { date: today, count: current + 1 } });
  return current + 1;
}

// --- Phase2 sync hook (no-op in Phase1) ---

function markPendingSync(record) {
  // Phase2: record.syncStatus = 'pending' を設定し同期キューに積む。
  // Phase1では呼び出されない。
  record.syncStatus = 'pending';
  return record;
}

export {
  listClients,
  saveClient,
  deleteClient,
  listProjects,
  saveProject,
  listScans,
  saveScan,
  getSettings,
  saveSettings,
  getScanCountToday,
  incrementScanCountToday,
  markPendingSync
};
