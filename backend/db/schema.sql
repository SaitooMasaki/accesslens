-- AccessLens バックエンド DB スキーマ
-- CREATE TABLE IF NOT EXISTS で冪等に適用できる

-- ユーザー
CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT UNIQUE NOT NULL,
  plan                  TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'pro' | 'agency'
  lemon_customer_id     TEXT,
  lemon_subscription_id TEXT,
  subscription_status   TEXT,
  email_digest_enabled  BOOLEAN NOT NULL DEFAULT true,  -- Phase 2-3: 週次メール配信フラグ
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 監視サイト
CREATE TABLE IF NOT EXISTS sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id     UUID,                                 -- Phase 1 のクライアント管理との紐付け
  url           TEXT NOT NULL,
  label         TEXT,
  scan_interval TEXT NOT NULL DEFAULT 'weekly',       -- 'daily' | 'weekly'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ                           -- 論理削除（同期プロトコルと対応）
);

-- スキャン履歴
CREATE TABLE IF NOT EXISTS scans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  triggered_by     TEXT NOT NULL DEFAULT 'manual',    -- 'manual' | 'scheduled'
  violations_count INT,
  critical_count   INT,
  serious_count    INT,
  result_json      JSONB,                             -- axe-core 生の結果
  scanned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- クラウド同期レコード（Phase 2-4）
-- 拡張機能の clients / projects をそのまま JSONB で保持する。
-- UUID は拡張機能側で生成したものをそのまま PK に使う（CLAUDE.md 参照）。
CREATE TABLE IF NOT EXISTS sync_records (
  id         UUID NOT NULL,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,           -- 'clients' | 'projects'
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (id, user_id, collection)
);

CREATE INDEX IF NOT EXISTS idx_sync_records_user_col
  ON sync_records(user_id, collection, updated_at DESC);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_sites_user_id    ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_deleted_at ON sites(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scans_site_id    ON scans(site_id);
CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON scans(scanned_at DESC);
