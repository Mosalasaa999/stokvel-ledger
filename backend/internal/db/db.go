package db

import (
    "context"
    "database/sql"
    "time"

    _ "github.com/lib/pq"
)

func ConnectAndMigrate(connStr string) (*sql.DB, error) {
    conn, err := sql.Open("postgres", connStr)
    if err != nil {
        return nil, err
    }
    conn.SetMaxOpenConns(5)
    conn.SetMaxIdleConns(2)
    conn.SetConnMaxLifetime(5 * time.Minute)

    ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
    defer cancel()
    if err := conn.PingContext(ctx); err != nil {
        return nil, err
    }

    schema := `
CREATE TABLE IF NOT EXISTS groups (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug               TEXT UNIQUE NOT NULL,
    name               TEXT NOT NULL,
    archetype          TEXT NOT NULL CHECK (archetype IN ('SAVINGS_DEC', 'ROSCA', 'BURIAL', 'INVESTMENT')),
    contribution_cents BIGINT NOT NULL CHECK (contribution_cents > 0),
    due_day_of_month   SMALLINT NOT NULL CHECK (due_day_of_month BETWEEN 1 AND 28),
    grace_days         SMALLINT NOT NULL DEFAULT 3,
    late_fine_cents    BIGINT NOT NULL DEFAULT 0,
    cycle_year         SMALLINT NOT NULL,
    treasurer_pin_hash TEXT NOT NULL,
    eu_popia_consent   BOOLEAN NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id            UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    display_name        TEXT NOT NULL,
    msisdn_norm         TEXT NOT NULL,
    pin_hash            TEXT NOT NULL,
    failed_pin_attempts SMALLINT NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    rotation_slot       SMALLINT,
    successor_name      TEXT,
    successor_msisdn    TEXT,
    proxy_aliases       TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE (group_id, msisdn_norm)
);
CREATE TABLE IF NOT EXISTS import_batches (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id          UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    bank_code         TEXT NOT NULL,
    file_sha256       CHAR(64) NOT NULL,
    tx_inserted_count INT NOT NULL DEFAULT 0,
    tx_skipped_count  INT NOT NULL DEFAULT 0,
    status            TEXT NOT NULL CHECK (status IN ('COMMITTED', 'ROLLED_BACK')),
    created_by_member UUID REFERENCES members(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bank_transactions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id          UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    batch_id          UUID REFERENCES import_batches(id),
    tx_hash           CHAR(64) NOT NULL,
    tx_date           DATE NOT NULL,
    direction         TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
    amount_cents      BIGINT NOT NULL CHECK (amount_cents > 0),
    balance_cents     BIGINT,
    category          TEXT NOT NULL CHECK (category IN ('CONTRIBUTION', 'BANK_FEE', 'INTEREST', 'PAYOUT', 'SELF_TRANSFER', 'UNCLASSIFIED')),
    raw_description   TEXT NOT NULL,
    extracted_msisdn  TEXT,
    payer_proxy_label TEXT,
    matched_member_id UUID REFERENCES members(id),
    source_tag        TEXT NOT NULL CHECK (source_tag IN ('BANK VERIFIED', 'MANUAL OVERRIDE')),
    is_voided         BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (group_id, tx_hash)
);
CREATE TABLE IF NOT EXISTS member_obligations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    period_month    DATE NOT NULL,
    obligation_type TEXT NOT NULL CHECK (obligation_type IN ('PRINCIPAL', 'LATE_FINE')),
    expected_cents  BIGINT NOT NULL CHECK (expected_cents > 0),
    settled_cents   BIGINT NOT NULL DEFAULT 0 CHECK (settled_cents >= 0 AND settled_cents <= expected_cents),
    UNIQUE (member_id, period_month, obligation_type)
);
CREATE TABLE IF NOT EXISTS allocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    transaction_id  UUID NOT NULL REFERENCES bank_transactions(id),
    obligation_id   UUID NOT NULL REFERENCES member_obligations(id),
    allocated_cents BIGINT NOT NULL CHECK (allocated_cents > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
    id              BIGSERIAL PRIMARY KEY,
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    actor_member_id UUID REFERENCES members(id),
    event_type      TEXT NOT NULL,
    source_tag      TEXT NOT NULL CHECK (source_tag IN ('BANK VERIFIED', 'MANUAL OVERRIDE', 'SYSTEM')),
    reason_note     TEXT,
    payload_json    JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_group_date ON bank_transactions(group_id, tx_date DESC);
CREATE INDEX IF NOT EXISTS idx_obligations_fifo ON member_obligations(member_id, period_month ASC, obligation_type ASC);
`
    if _, err := conn.ExecContext(ctx, schema); err != nil {
        return nil, err
    }
    return conn, nil
}
