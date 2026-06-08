// forward-compatible schema: 全レコードがPhase2のクラウド同期に備えた形を持つ。
// syncStatus は Phase1では常に 'local'。Phase2で 'synced' | 'pending' に拡張される。
// updatedAt は last-write-wins 同期の基準、deletedAt は論理削除の同期伝播に使う。

function createBaseRecord(payload) {
  return {
    id: crypto.randomUUID(),
    syncStatus: 'local',
    updatedAt: Date.now(),
    deletedAt: null,
    ...payload
  };
}

function createClient({ name }) {
  return createBaseRecord({
    recordType: 'client',
    name
  });
}

function createProject({ clientId, name, url }) {
  return createBaseRecord({
    recordType: 'project',
    clientId,
    name,
    url
  });
}

function createScan({ projectId, url, summary, violations, passes, incomplete }) {
  return createBaseRecord({
    recordType: 'scan',
    projectId,
    url,
    scannedAt: Date.now(),
    summary,
    violations,
    passes,
    incomplete
  });
}

function touch(record) {
  record.updatedAt = Date.now();
  return record;
}

function softDelete(record) {
  record.deletedAt = Date.now();
  record.updatedAt = Date.now();
  return record;
}

export { createBaseRecord, createClient, createProject, createScan, touch, softDelete };
