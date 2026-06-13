// Phase 2-4: 拡張機能 ↔ バックエンド クラウド同期サービス。
// Agency プランのユーザーのみ有効。JWT を chrome.storage.local に保持する。

const BACKEND_URL = 'https://api.accesslens.cc';

const SK = {
  jwt: 'al_backend_jwt',
  syncSince: 'al_sync_since',
  clients: 'al_clients',
  projects: 'al_projects',
};

// --- JWT ストレージ ---

async function getJwt() {
  const data = await chrome.storage.local.get(SK.jwt);
  return data[SK.jwt] ?? null;
}

async function setJwt(token) {
  await chrome.storage.local.set({ [SK.jwt]: token });
}

async function clearJwt() {
  await chrome.storage.local.remove(SK.jwt);
}

// --- 同期タイムスタンプ ---

async function getSyncSince() {
  const data = await chrome.storage.local.get(SK.syncSince);
  return data[SK.syncSince] ?? 0;
}

async function setSyncSince(ts) {
  await chrome.storage.local.set({ [SK.syncSince]: ts });
}

// --- ストレージ操作（同期専用。store.js は経由しない） ---

async function getRawCollection(key) {
  const data = await chrome.storage.local.get(key);
  return data[key] ?? [];
}

async function markCollectionSynced(key, ids) {
  const records = await getRawCollection(key);
  let changed = false;
  for (const r of records) {
    if (ids.includes(r.id) && r.syncStatus === 'pending') {
      r.syncStatus = 'synced';
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ [key]: records });
}

async function applyServerRecords(key, serverRecords) {
  if (!serverRecords.length) return;
  const local = await getRawCollection(key);
  const map = new Map(local.map((r) => [r.id, r]));

  for (const remote of serverRecords) {
    const existing = map.get(remote.id);
    // last-write-wins: サーバー側の updatedAt が新しければ上書き
    if (!existing || (remote.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      map.set(remote.id, { ...remote, syncStatus: 'synced' });
    }
  }

  await chrome.storage.local.set({ [key]: Array.from(map.values()) });
}

// --- 公開 API ---

/**
 * ライセンスキーでバックエンドにログインし JWT を保存する。
 * ライセンスアクティベーション後に options.js から呼び出す。
 */
export async function loginToBackend(licenseKey) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
    });
    if (!res.ok) return false;
    const { token } = await res.json();
    await setJwt(token);
    return true;
  } catch {
    return false;
  }
}

/** JWT を削除する（ライセンス解除時に呼び出す） */
export async function logoutFromBackend() {
  await clearJwt();
  await chrome.storage.local.remove(SK.syncSince);
}

/**
 * 全コレクションを同期する。
 * - pending レコードをサーバーに送信
 * - サーバーの新着変更をローカルに反映
 * - オフライン時は pending のまま保持（エラーを握り潰す）
 */
export async function syncAll() {
  const jwt = await getJwt();
  if (!jwt) return;

  const since = await getSyncSince();
  const pendingClients = (await getRawCollection(SK.clients)).filter((r) => r.syncStatus === 'pending');
  const pendingProjects = (await getRawCollection(SK.projects)).filter((r) => r.syncStatus === 'pending');

  let serverResponse;
  try {
    const res = await fetch(`${BACKEND_URL}/api/sync`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ clients: pendingClients, projects: pendingProjects, since }),
    });

    if (res.status === 401) {
      // JWTが期限切れ — 削除してライセンスキーで再ログインが必要
      await clearJwt();
      return;
    }
    if (!res.ok) return;

    serverResponse = await res.json();
  } catch {
    // オフライン or ネットワークエラー: pending のまま保持し次回に再試行
    return;
  }

  // サーバー変更をローカルに適用
  await applyServerRecords(SK.clients, serverResponse.clients ?? []);
  await applyServerRecords(SK.projects, serverResponse.projects ?? []);

  // 送信済みレコードを synced にマーク
  await markCollectionSynced(SK.clients, pendingClients.map((r) => r.id));
  await markCollectionSynced(SK.projects, pendingProjects.map((r) => r.id));

  await setSyncSince(Date.now());
}
