package ledger

import (
    "fmt"
    "net/http"

    "github.com/lib/pq"
)

func (s *Server) HandleGetLedger(w http.ResponseWriter, r *http.Request) {
    claims, err := s.authenticate(r, "")
    if err != nil {
        writeErr(w, http.StatusUnauthorized, err.Error())
        return
    }
    var g struct {
        ID                string `json:"id"`
        Slug              string `json:"slug"`
        Name              string `json:"name"`
        Archetype         string `json:"archetype"`
        ContributionCents int64  `json:"contribution_cents"`
        DueDayOfMonth     int    `json:"due_day_of_month"`
        LateFineCents     int64  `json:"late_fine_cents"`
        CycleYear         int    `json:"cycle_year"`
    }
    if err := s.DB.QueryRow(`SELECT id, slug, name, archetype, contribution_cents, due_day_of_month, late_fine_cents, cycle_year FROM groups WHERE id=$1`, claims.GroupID).
        Scan(&g.ID, &g.Slug, &g.Name, &g.Archetype, &g.ContributionCents, &g.DueDayOfMonth, &g.LateFineCents, &g.CycleYear); err != nil {
        writeErr(w, http.StatusNotFound, "group not found")
        return
    }

    var totalCredits, totalFees, totalInterest, totalPayouts int64
    _ = s.DB.QueryRow(`
        SELECT
            COALESCE(SUM(CASE WHEN direction='CREDIT' AND category='CONTRIBUTION' AND NOT is_voided THEN amount_cents ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN direction='DEBIT'  AND category='BANK_FEE'     AND NOT is_voided THEN amount_cents ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN direction='CREDIT' AND category='INTEREST'     AND NOT is_voided THEN amount_cents ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN direction='DEBIT'  AND category='PAYOUT'       AND NOT is_voided THEN amount_cents ELSE 0 END), 0)
        FROM bank_transactions WHERE group_id=$1`, claims.GroupID).
        Scan(&totalCredits, &totalFees, &totalInterest, &totalPayouts)

    type memberSummary struct {
        ID              string   `json:"id"`
        DisplayName     string   `json:"display_name"`
        MSISDNNorm      string   `json:"msisdn_norm"`
        RotationSlot    *int     `json:"rotation_slot"`
        SuccessorName   string   `json:"successor_name"`
        SuccessorMSISDN string   `json:"successor_msisdn"`
        ProxyAliases    []string `json:"proxy_aliases"`
        ExpectedCents   int64    `json:"expected_cents"`
        SettledCents    int64    `json:"settled_cents"`
    }
    var members []memberSummary
    mRows, _ := s.DB.Query(`
        SELECT m.id, m.display_name, m.msisdn_norm, m.rotation_slot, COALESCE(m.successor_name,''), COALESCE(m.successor_msisdn,''), m.proxy_aliases,
            COALESCE(SUM(o.expected_cents), 0), COALESCE(SUM(o.settled_cents), 0)
        FROM members m LEFT JOIN member_obligations o ON o.member_id=m.id
        WHERE m.group_id=$1 GROUP BY m.id ORDER BY m.rotation_slot NULLS LAST, m.display_name`, claims.GroupID)
    if mRows != nil {
        for mRows.Next() {
            var ms memberSummary
            if mRows.Scan(&ms.ID, &ms.DisplayName, &ms.MSISDNNorm, &ms.RotationSlot, &ms.SuccessorName, &ms.SuccessorMSISDN, pq.Array(&ms.ProxyAliases), &ms.ExpectedCents, &ms.SettledCents) == nil {
                members = append(members, ms)
            }
        }
        mRows.Close()
    }

    type txSummary struct {
        ID              string  `json:"id"`
        TxDate          string  `json:"tx_date"`
        Direction       string  `json:"direction"`
        AmountCents     int64   `json:"amount_cents"`
        Category        string  `json:"category"`
        RawDescription  string  `json:"raw_description"`
        PayerProxyLabel string  `json:"payer_proxy_label"`
        MatchedMemberID *string `json:"matched_member_id"`
        SourceTag       string  `json:"source_tag"`
    }
    var txs []txSummary
    tRows, _ := s.DB.Query(`SELECT id, to_char(tx_date,'YYYY-MM-DD'), direction, amount_cents, category, raw_description, COALESCE(payer_proxy_label,''), matched_member_id, source_tag FROM bank_transactions WHERE group_id=$1 AND NOT is_voided ORDER BY tx_date DESC, created_at DESC LIMIT 100`, claims.GroupID)
    if tRows != nil {
        for tRows.Next() {
            var t txSummary
            if tRows.Scan(&t.ID, &t.TxDate, &t.Direction, &t.AmountCents, &t.Category, &t.RawDescription, &t.PayerProxyLabel, &t.MatchedMemberID, &t.SourceTag) == nil {
                txs = append(txs, t)
            }
        }
        tRows.Close()
    }

    type batchSummary struct {
        ID, BankCode, Status, CreatedAt string
        Inserted, Skipped               int
    }
    var batches []map[string]any
    bRows, _ := s.DB.Query(`SELECT id, bank_code, tx_inserted_count, tx_skipped_count, status, to_char(created_at,'YYYY-MM-DD HH24:MI') FROM import_batches WHERE group_id=$1 ORDER BY created_at DESC LIMIT 10`, claims.GroupID)
    if bRows != nil {
        for bRows.Next() {
            var b batchSummary
            if bRows.Scan(&b.ID, &b.BankCode, &b.Inserted, &b.Skipped, &b.Status, &b.CreatedAt) == nil {
                batches = append(batches, map[string]any{"id": b.ID, "bank_code": b.BankCode, "tx_inserted_count": b.Inserted, "tx_skipped_count": b.Skipped, "status": b.Status, "created_at": b.CreatedAt})
            }
        }
        bRows.Close()
    }

    writeJSON(w, http.StatusOK, map[string]any{
        "role":  claims.Role,
        "group": g,
        "cash_tie": map[string]int64{
            "member_credits_cents":   totalCredits,
            "bank_fees_cents":        totalFees,
            "bank_interest_cents":    totalInterest,
            "verified_payouts_cents": totalPayouts,
            "expected_balance_cents": totalCredits - totalFees + totalInterest - totalPayouts,
        },
        "members":      members,
        "transactions": txs,
        "batches":      batches,
    })
}

func (s *Server) HandleRollover2027(w http.ResponseWriter, r *http.Request) {
    claims, err := s.authenticate(r, "TREASURER")
    if err != nil {
        writeErr(w, http.StatusUnauthorized, err.Error())
        return
    }
    var contrib int64
    var nextYear int
    _ = s.DB.QueryRow(`SELECT contribution_cents, cycle_year + 1 FROM groups WHERE id=$1`, claims.GroupID).Scan(&contrib, &nextYear)
    tx, err := s.DB.Begin()
    if err != nil {
        writeErr(w, http.StatusInternalServerError, "tx failed")
        return
    }
    defer tx.Rollback()
    _, _ = tx.Exec(`UPDATE groups SET cycle_year=$1 WHERE id=$2`, nextYear, claims.GroupID)
    mRows, _ := tx.Query(`SELECT id FROM members WHERE group_id=$1`, claims.GroupID)
    var ids []string
    if mRows != nil {
        for mRows.Next() {
            var id string
            if mRows.Scan(&id) == nil {
                ids = append(ids, id)
            }
        }
        mRows.Close()
    }
    for _, mid := range ids {
        _ = seedCycleObligations(tx, claims.GroupID, mid, nextYear, contrib)
    }
    _, _ = tx.Exec(`INSERT INTO audit_events (group_id, event_type, source_tag, reason_note, payload_json) VALUES ($1,'CYCLE_ROLLOVER','SYSTEM','One-click cycle rollover',$2)`, claims.GroupID, fmt.Sprintf(`{"cycle_year":%d}`, nextYear))
    if err := tx.Commit(); err != nil {
        writeErr(w, http.StatusInternalServerError, "rollover failed")
        return
    }
    writeJSON(w, http.StatusOK, map[string]any{"status": "ROLLED_OVER", "cycle_year": nextYear})
}
