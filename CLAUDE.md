\- Phase 1のchrome.storage.localスキーマは絶対に変更しない

\- UUIDはローカル生成のものをそのままサーバーDBのPKに使う

\- ReplyFlowのbackend構成（Node.js + Express + JWT）を踏襲する

\- 課金はLemon Squeezy（License API + Webhook）

\- DBはPostgreSQL

\- メール送信はResend

\- 新機能はAgencyプランのみ。FreeとProの既存動作を壊さない

