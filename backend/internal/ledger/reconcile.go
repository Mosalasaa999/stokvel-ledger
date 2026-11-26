package ledger

import (
    "database/sql"
    "encoding/json"
    "fmt"
    "net/http"
    "strings"
    "time"

    "github.com/Mosalasaa999/stokvel-ledger/internal/security"
    "github.com/lib/pq"
)

type InboundTx struct {
    TxDate          string `json:"tx_date"`
    Direction       string `json:"direction"`
    AmountCents     int64  `json:"amount_cents"`
    BalanceCents    *int64 `json:"balance_cents"`
    Category        string `json:"category"`
    RawDescription  string `json:"raw_description"`
    ExtractedMSISDN string `json:"extracted_msisdn"`
    OccIndex        int    `json:"occ_index"`
}

func (s *Server) HandleImportStatement(w http.ResponseWriter, r *http.Request) {
    claims, err := s.authenticate(r, "TREASURER")
    if err != nil {
        writeErr(w, http.StatusUnauthorized, err.Error())
        return
    }
    var req struct {
        BankCode     string      `json:"bank_code"`
        FileSHA256   string      `json:"file_sha256"`
        Transactions []InboundTx `json:"transactions"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeErr(w, http.StatusBadRequest, "invalid json")
        return
    }
    tx, err := s.DB.Begin()
    if err != nil {
        writeErr(w, http.StatusInternalServerError, "tx start failed")
        return
    }
    defer tx.Rollback()

    var batchID string
    if err := tx.QueryRow(`INSERT INTO import_batches (group_id, bank_code, file_sha256, status) VALUES ($1,$2,$3,'COMMITTED') RETURNING id`,
        claims.GroupID, req.BankCode, req.FileSHA256).Scan(&batchID); err != nil {
        writeErr(w, http.StatusInternalServerError, "batch create failed")
        return
    }

    type memRec struct {
        ID, DisplayName, MSISDN, SuccessorName, SuccessorMSISDN string
        Aliases                                                 []string
    }
    var members []memRec
    mRows, _ := tx.Query(`SELECT id, display_name, msisdn_norm, COALESCE(successor_name,''), COALESCE(successor_msisdn,''), proxy_aliases FROM members WHERE group_id=$1`, claims.GroupID)
    if mRows != nil {
        for mRows.Next() {
            var m memRec
            if mRows.Scan(&m.ID, &m.DisplayName, &m.MSISDN, &m.SuccessorName, &m.SuccessorMSISDN, pq.Array(&m.Aliases)) == nil {
                members = append(members, m)
            }
        }
        mRows.Close()
    }

    inserted, skipped := 0, 0
    for _, item := range req.Transactions {
        if item.AmountCents <= 0 {
            continue
        }
        balOrOrd := fmt.Sprintf("ord:%d", item.OccIndex)
        if item.BalanceCents != nil {
            balOrOrd = fmt.Sprintf("bal:%d", *item.BalanceCents)
        }
        txHash := security.SHA256Hex(claims.GroupID, item.TxDate, item.Direction, fmt.Sprintf("%d", item.AmountCents), strings.ToUpper(strings.TrimSpace(item.RawDescription)), balOrOrd)

        var matchedID *string
        var proxyLabel string
        cat := item.Category
        if cat == "" {
            cat = "UNCLASSIFIED"
        }
        if item.Direction == "CREDIT" && (cat == "CONTRIBUTION" || cat == "UNCLASSIFIED") {
            descUp := strings.ToUpper(item.RawDescription)
            normPhone := security.NormalizeMSISDN(item.ExtractedMSISDN)
            for _, m := range members {
                if normPhone != "" && normPhone == m.MSISDN {
                    idC := m.ID
                    matchedID = &idC
                    cat = "CONTRIBUTION"
                    break
                }
                if normPhone != "" && m.SuccessorMSISDN != "" && normPhone == m.SuccessorMSISDN {
                    idC := m.ID
                    matchedID = &idC
                    proxyLabel = fmt.Sprintf("Proxy: %s · %s", m.SuccessorName, m.SuccessorMSISDN)
                    cat = "CONTRIBUTION"
                    break
                }
                hit := false
                for _, al := range m.Aliases {
                    if al != "" && strings.Contains(descUp, strings.ToUpper(al)) {
                        idC := m.ID
                        matchedID = &idC
                        proxyLabel = "Proxy: " + al
                        cat = "CONTRIBUTION"
                        hit = true
                        break
                    }
                }
                if hit {
                    break
                }
                if strings.Contains(descUp, strings.ToUpper(m.DisplayName)) {
                    idC := m.ID
                    matchedID = &idC
                    cat = "CONTRIBUTION"
                    break
                }
            }
        }

        var txID string
        err := tx.QueryRow(`
            INSERT INTO bank_transactions (group_id, batch_id, tx_hash, tx_date, direction, amount_cents, balance_cents, category, raw_description, extracted_msisdn, payer_proxy_label, matched_member_id, source_tag)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'BANK VERIFIED')
            ON CONFLICT (group_id, tx_hash) DO NOTHING RETURNING id`,
            claims.GroupID, batchID, txHash, item.TxDate, item.Direction, item.AmountCents, item.BalanceCents, cat, item.RawDescription, item.ExtractedMSISDN, proxyLabel, matchedID,
        ).Scan(&txID)
        if err == sql.ErrNoRows {
            skipped++
            continue
        } else if err != nil {
            writeErr(w, http.StatusInternalServerError, err.Error())
            return
        }
        inserted++
        if matchedID != nil && item.Direction == "CREDIT" && cat == "CONTRIBUTION" {
            if err := allocateFIFO(tx, claims.GroupID, *matchedID, txID, item.AmountCents); err != nil {
                writeErr(w, http.StatusInternalServerError, "fifo error")
                return
            }
        }
    }

    _, _ = tx.Exec(`UPDATE import_batches SET tx_inserted_count=$1, tx_skipped_count=$2 WHERE id=$3`, inserted, skipped, batchID)
    _, _ = tx.Exec(`INSERT INTO audit_events (group_id, event_type, source_tag, reason_note, payload_json) VALUES ($1,'BATCH_IMPORTED','BANK VERIFIED',$2,$3)`,
        claims.GroupID, fmt.Sprintf("Imported %s (%d new, %d skipped)", req.BankCode, inserted, skipped), fmt.Sprintf(`{"batch_id":%q}`, batchID))
    if err := tx.Commit(); err != nil {
        writeErr(w, http.StatusInternalServerError, "commit failed")
        return
    }
    writeJSON(w, http.StatusOK, map[string]any{"batch_id": batchID, "inserted": inserted, "skipped": skipped})
}

func allocateFIFO(tx *sql.Tx, groupID, memberID, txID string, remaining int64) error {
    rows, err := tx.Query(`SELECT id, expected_cents, settled_cents FROM member_obligations WHERE group_id=$1 AND member_id=$2 AND settled_cents < expected_cents ORDER BY period_month ASC, obligation_type ASC FOR UPDATE`, groupID, memberID)
    if err != nil {
        return err
    }
    type ob struct {
        id              string
        exp, set        int64
    }
    var list []ob
    for rows.Next() {
        var o ob
        if rows.Scan(&o.id, &o.exp, &o.set) == nil {
            list = append(list, o)
        }
    }
    rows.Close()
    for _, o := range list {
        if remaining <= 0 {
            break
        }
        apply := o.exp - o.set
        if remaining < apply {
            apply = remaining
        }
        if _, err := tx.Exec(`UPDATE member_obligations SET settled_cents = settled_cents + $1 WHERE id=$2`, apply, o.id); err != nil {
            return err
        }
        if _, err := tx.Exec(`INSERT INTO allocations (group_id, transaction_id, obligation_id, allocated_cents) VALUES ($1,$2,$3,$4)`, groupID, txID, o.id, apply); err != nil {
            return err
        }
        remaining -= apply
    }
    return nil
}

func (s *Server) HandleRollbackBatch(w http.ResponseWriter, r *http.Request) {
    claims, err := s.authenticate(r, "TREASURER")
    if err != nil {
        writeErr(w, http.StatusUnauthorized, err.Error())
        return
    }
    batchID := r.PathValue("batchId")
    tx, err := s.DB.Begin()
    if err != nil {
        writeErr(w, http.StatusInternalServerError, "tx failed")
        return
    }
    defer tx.Rollback()

    var status string
    if err := tx.QueryRow(`SELECT status FROM import_batches WHERE id=$1 AND group_id=$2 FOR UPDATE`, batchID, claims.GroupID).Scan(&status); err != nil || status != "COMMITTED" {
        writeErr(w, http.StatusBadRequest, "batch not found or already rolled back")
        return
    }
    _, _ = tx.Exec(`UPDATE member_obligations mo SET settled_cents = GREATEST(0, mo.settled_cents - sub.tot) FROM (SELECT a.obligation_id, SUM(a.allocated_cents) AS tot FROM allocations a JOIN bank_transactions bt ON bt.id=a.transaction_id WHERE bt.batch_id=$1 AND bt.group_id=$2 GROUP BY a.obligation_id) sub WHERE mo.id=sub.obligation_id`, batchID, claims.GroupID)
    _, _ = tx.Exec(`DELETE FROM allocations WHERE transaction_id IN (SELECT id FROM bank_transactions WHERE batch_id=$1 AND group_id=$2)`, batchID, claims.GroupID)
    _, _ = tx.Exec(`DELETE FROM bank_transactions WHERE batch_id=$1 AND group_id=$2`, batchID, claims.GroupID)
    _, _ = tx.Exec(`UPDATE import_batches SET status='ROLLED_BACK' WHERE id=$1`, batchID)
    _, _ = tx.Exec(`INSERT INTO audit_events (group_id, event_type, source_tag, reason_note, payload_json) VALUES ($1,'BATCH_ROLLED_BACK','MANUAL OVERRIDE','Atomic batch undo',$2)`, claims.GroupID, fmt.Sprintf(`{"batch_id":%q}`, batchID))
    if err := tx.Commit(); err != nil {
        writeErr(w, http.StatusInternalServerError, "rollback failed")
        return
    }
    writeJSON(w, http.StatusOK, map[string]string{"status": "ROLLED_BACK", "batch_id": batchID})
}

func (s *Server) HandleAssignTx(w http.ResponseWriter, r *http.Request) {
    claims, err := s.authenticate(r, "TREASURER")
    if err != nil {
        writeErr(w, http.StatusUnauthorized, err.Error())
        return
    }
    txID := r.PathValue("txId")
    var req struct {
        MemberID     string `json:"member_id"`
        SaveAlias    bool   `json:"save_alias"`
        AliasKeyword string `json:"alias_keyword"`
        ReasonNote   string `json:"reason_note"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.ReasonNote) == "" {
        writeErr(w, http.StatusBadRequest, "member_id and mandatory reason_note required")
        return
    }
    tx, err := s.DB.Begin()
    if err != nil {
        writeErr(w, http.StatusInternalServerError, "tx failed")
        return
    }
    defer tx.Rollback()
    var amountCents int64
    var matched sql.NullString
    if err := tx.QueryRow(`SELECT amount_cents, matched_member_id FROM bank_transactions WHERE id=$1 AND group_id=$2 FOR UPDATE`, txID, claims.GroupID).Scan(&amountCents, &matched); err != nil || matched.Valid {
        writeErr(w, http.StatusBadRequest, "transaction not found or already assigned")
        return
    }
    _, _ = tx.Exec(`UPDATE bank_transactions SET matched_member_id=$1, category='CONTRIBUTION', payer_proxy_label=$2 WHERE id=$3`, req.MemberID, req.AliasKeyword, txID)
    if req.SaveAlias && strings.TrimSpace(req.AliasKeyword) != "" {
        _, _ = tx.Exec(`UPDATE members SET proxy_aliases=array_append(proxy_aliases,$1) WHERE id=$2 AND NOT ($1=ANY(proxy_aliases))`, strings.TrimSpace(req.AliasKeyword), req.MemberID)
    }
    if err := allocateFIFO(tx, claims.GroupID, req.MemberID, txID, amountCents); err != nil {
        writeErr(w, http.StatusInternalServerError, "fifo error")
        return
    }
    _, _ = tx.Exec(`INSERT INTO audit_events (group_id, event_type, source_tag, reason_note, payload_json) VALUES ($1,'TX_MANUALLY_ASSIGNED','MANUAL OVERRIDE',$2,$3)`, claims.GroupID, req.ReasonNote, fmt.Sprintf(`{"tx_id":%q}`, txID))
    if err := tx.Commit(); err != nil {
        writeErr(w, http.StatusInternalServerError, "commit failed")
        return
    }
    writeJSON(w, http.StatusOK, map[string]string{"status": "ASSIGNED"})
}

func (s *Server) HandleManualAdvance(w http.ResponseWriter, r *http.Request) {
    claims, err := s.authenticate(r, "TREASURER")
    if err != nil {
        writeErr(w, http.StatusUnauthorized, err.Error())
        return
    }
    var req struct {
        MemberID      string `json:"member_id"`
        AmountCents   int64  `json:"amount_cents"`
        InterestCents int64  `json:"interest_cents"`
        FeeCents      int64  `json:"fee_cents"`
        ReasonNote    string `json:"reason_note"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeErr(w, http.StatusBadRequest, "invalid json")
        return
    }
    if req.InterestCents > 0 || req.FeeCents > 0 {
        writeErr(w, http.StatusUnprocessableEntity, "Blocked under NCA GN 513 (R0.00 threshold): only 0% principal advances allowed.")
        return
    }
    if req.AmountCents <= 0 || strings.TrimSpace(req.ReasonNote) == "" {
        writeErr(w, http.StatusBadRequest, "positive amount and reason_note required")
        return
    }
    txHash := security.SHA256Hex(claims.GroupID, "ADVANCE", req.MemberID, fmt.Sprintf("%d", time.Now().UnixNano()))
    _, _ = s.DB.Exec(`INSERT INTO bank_transactions (group_id, tx_hash, tx_date, direction, amount_cents, category, raw_description, matched_member_id, source_tag) VALUES ($1,$2,CURRENT_DATE,'DEBIT',$3,'PAYOUT',$4,$5,'MANUAL OVERRIDE')`,
        claims.GroupID, txHash, req.AmountCents, "0% Principal Advance: "+req.ReasonNote, req.MemberID)
    _, _ = s.DB.Exec(`INSERT INTO audit_events (group_id, event_type, source_tag, reason_note, payload_json) VALUES ($1,'ZERO_INTEREST_ADVANCE','MANUAL OVERRIDE',$2,$3)`,
        claims.GroupID, req.ReasonNote, fmt.Sprintf(`{"member_id":%q,"amount_cents":%d}`, req.MemberID, req.AmountCents))
    writeJSON(w, http.StatusCreated, map[string]string{"status": "RECORDED_0_PCT"})
}
