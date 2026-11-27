package ledger

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/Mosalasaa999/stokvel-ledger/internal/security"
	"github.com/lib/pq"
)

func (s *Server) HandleLookupByCode(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	clean := strings.ReplaceAll(code, "-", "")
	var slug, name, shortCode string
	err := s.DB.QueryRow(`
		SELECT slug, name, COALESCE(short_code, slug)
		FROM groups
		WHERE UPPER(REPLACE(COALESCE(short_code,''), '-', '')) = $1 OR LOWER(slug) = LOWER($2)
		LIMIT 1`, clean, code,
	).Scan(&slug, &name, &shortCode)
	if err != nil {
		writeErr(w, http.StatusNotFound, "Group code not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"slug": slug, "name": name, "short_code": shortCode})
}

func (s *Server) HandleAddMember(w http.ResponseWriter, r *http.Request) {
	claims, err := s.authenticate(r, "TREASURER")
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	var req struct {
		DisplayName     string   `json:"display_name"`
		MSISDN          string   `json:"msisdn"`
		PIN             string   `json:"pin"`
		RotationSlot    *int     `json:"rotation_slot"`
		SuccessorName   string   `json:"successor_name"`
		SuccessorMSISDN string   `json:"successor_msisdn"`
		ProxyAliases    []string `json:"proxy_aliases"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	msisdn := security.NormalizeMSISDN(req.MSISDN)
	if req.DisplayName == "" || msisdn == "" {
		writeErr(w, http.StatusBadRequest, "name and phone required")
		return
	}
	if len(req.PIN) < 4 {
		req.PIN = "0000"
	}
	mHash, err := security.HashPIN(req.PIN)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "pin hash error")
		return
	}
	var year int
	var contrib int64
	_ = s.DB.QueryRow(`SELECT cycle_year, contribution_cents FROM groups WHERE id=$1`, claims.GroupID).Scan(&year, &contrib)

	tx, err := s.DB.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx failed")
		return
	}
	defer tx.Rollback()
	var memberID string
	err = tx.QueryRow(`INSERT INTO members (group_id, display_name, msisdn_norm, pin_hash, rotation_slot, successor_name, successor_msisdn, proxy_aliases) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		claims.GroupID, req.DisplayName, msisdn, mHash, req.RotationSlot, req.SuccessorName, security.NormalizeMSISDN(req.SuccessorMSISDN), pq.Array(req.ProxyAliases)).Scan(&memberID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = seedCycleObligations(tx, claims.GroupID, memberID, year, contrib)
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"member_id": memberID})
}

func (s *Server) HandleUpdateHelpers(w http.ResponseWriter, r *http.Request) {
	claims, err := s.authenticate(r, "TREASURER")
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	memberID := r.PathValue("memberId")
	var req struct {
		SuccessorName   string   `json:"successor_name"`
		SuccessorMSISDN string   `json:"successor_msisdn"`
		ProxyAliases    []string `json:"proxy_aliases"`
		ResetPIN        string   `json:"reset_pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	_, err = s.DB.Exec(`UPDATE members SET successor_name=$1, successor_msisdn=$2, proxy_aliases=$3 WHERE id=$4 AND group_id=$5`,
		req.SuccessorName, security.NormalizeMSISDN(req.SuccessorMSISDN), pq.Array(req.ProxyAliases), memberID, claims.GroupID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(req.ResetPIN) >= 4 {
		if h, err := security.HashPIN(req.ResetPIN); err == nil {
			_, _ = s.DB.Exec(`UPDATE members SET pin_hash=$1, failed_pin_attempts=0, locked_until=NULL WHERE id=$2 AND group_id=$3`, h, memberID, claims.GroupID)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "UPDATED"})
}

func (s *Server) HandleGetLedger(w http.ResponseWriter, r *http.Request) {
	claims, err := s.authenticate(r, "")
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	var g struct {
		ID                string `json:"id"`
		Slug              string `json:"slug"`
		ShortCode         string `json:"short_code"`
		Name              string `json:"name"`
		Archetype         string `json:"archetype"`
		ContributionCents int64  `json:"contribution_cents"`
		DueDayOfMonth     int    `json:"due_day_of_month"`
		LateFineCents     int64  `json:"late_fine_cents"`
		CycleYear         int    `json:"cycle_year"`
	}
	if err := s.DB.QueryRow(`SELECT id, slug, COALESCE(short_code, slug), name, archetype, contribution_cents, due_day_of_month, late_fine_cents, cycle_year FROM groups WHERE id=$1`, claims.GroupID).
		Scan(&g.ID, &g.Slug, &g.ShortCode, &g.Name, &g.Archetype, &g.ContributionCents, &g.DueDayOfMonth, &g.LateFineCents, &g.CycleYear); err != nil {
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

	var batches []map[string]any
	bRows, _ := s.DB.Query(`SELECT id, bank_code, tx_inserted_count, tx_skipped_count, status, to_char(created_at,'YYYY-MM-DD HH24:MI') FROM import_batches WHERE group_id=$1 ORDER BY created_at DESC LIMIT 10`, claims.GroupID)
	if bRows != nil {
		for bRows.Next() {
			var id, bankCode, status, createdAt string
			var ins, skp int
			if bRows.Scan(&id, &bankCode, &ins, &skp, &status, &createdAt) == nil {
				batches = append(batches, map[string]any{"id": id, "bank_code": bankCode, "tx_inserted_count": ins, "tx_skipped_count": skp, "status": status, "created_at": createdAt})
			}
		}
		bRows.Close()
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"role":         claims.Role,
		"member_id":    claims.MemberID,
		"group":        g,
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