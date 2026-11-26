package ledger

import (
    "database/sql"
    "encoding/json"
    "errors"
    "fmt"
    "net/http"
    "regexp"
    "strings"
    "time"

    "github.com/Mosalasaa999/stokvel-ledger/internal/security"
    "github.com/lib/pq"
)

type Server struct {
    DB      *sql.DB
    Limiter *security.IPRateLimiter
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    _ = json.NewEncoder(w).Encode(payload)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
    writeJSON(w, status, map[string]string{"error": msg})
}

var slugCleanRe = regexp.MustCompile(`[^a-z0-9-]+`)

func makeSlug(name string, year int) string {
    base := strings.Trim(slugCleanRe.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-"), "-")
    if base == "" {
        base = "stokvel"
    }
    suffix := security.SHA256Hex(name, fmt.Sprintf("%d", time.Now().UnixNano()))[:6]
    return fmt.Sprintf("%s-%d-%s", base, year, suffix)
}

func (s *Server) HandleHealthz(w http.ResponseWriter, r *http.Request) {
    if err := s.DB.Ping(); err != nil {
        writeErr(w, http.StatusServiceUnavailable, "database waking")
        return
    }
    writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "region": "eu"})
}

type CreateGroupReq struct {
    Name              string `json:"name"`
    Archetype         string `json:"archetype"`
    ContributionCents int64  `json:"contribution_cents"`
    DueDayOfMonth     int    `json:"due_day_of_month"`
    GraceDays         int    `json:"grace_days"`
    LateFineCents     int64  `json:"late_fine_cents"`
    CycleYear         int    `json:"cycle_year"`
    TreasurerPIN      string `json:"treasurer_pin"`
    EUPopiaConsent    bool   `json:"eu_popia_consent"`
    InitialMembers    []struct {
        DisplayName     string   `json:"display_name"`
        MSISDN          string   `json:"msisdn"`
        PIN             string   `json:"pin"`
        RotationSlot    *int     `json:"rotation_slot"`
        SuccessorName   string   `json:"successor_name"`
        SuccessorMSISDN string   `json:"successor_msisdn"`
        ProxyAliases    []string `json:"proxy_aliases"`
    } `json:"initial_members"`
}

func seedCycleObligations(tx *sql.Tx, groupID, memberID string, year int, cents int64) error {
    for month := 1; month <= 12; month++ {
        period := fmt.Sprintf("%04d-%02d-01", year, month)
        if _, err := tx.Exec(`
            INSERT INTO member_obligations (group_id, member_id, period_month, obligation_type, expected_cents)
            VALUES ($1,$2,$3,'PRINCIPAL',$4) ON CONFLICT DO NOTHING`, groupID, memberID, period, cents); err != nil {
            return err
        }
    }
    return nil
}

func (s *Server) HandleCreateGroup(w http.ResponseWriter, r *http.Request) {
    var req CreateGroupReq
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeErr(w, http.StatusBadRequest, "invalid json")
        return
    }
    if !req.EUPopiaConsent {
        writeErr(w, http.StatusBadRequest, "POPIA Section 72 EU-hosting consent required")
        return
    }
    if len(req.TreasurerPIN) < 4 || len(req.TreasurerPIN) > 6 || req.ContributionCents <= 0 || req.DueDayOfMonth < 1 || req.DueDayOfMonth > 28 {
        writeErr(w, http.StatusBadRequest, "invalid PIN, contribution, or due day")
        return
    }
    if req.CycleYear == 0 {
        req.CycleYear = time.Now().Year()
    }
    tHash, err := security.HashPIN(req.TreasurerPIN)
    if err != nil {
        writeErr(w, http.StatusInternalServerError, "pin hash failed")
        return
    }
    slug := makeSlug(req.Name, req.CycleYear)

    tx, err := s.DB.Begin()
    if err != nil {
        writeErr(w, http.StatusInternalServerError, "db error")
        return
    }
    defer tx.Rollback()

    var groupID string
    err = tx.QueryRow(`
        INSERT INTO groups (slug, name, archetype, contribution_cents, due_day_of_month, grace_days, late_fine_cents, cycle_year, treasurer_pin_hash, eu_popia_consent)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        slug, req.Name, req.Archetype, req.ContributionCents, req.DueDayOfMonth, req.GraceDays, req.LateFineCents, req.CycleYear, tHash, req.EUPopiaConsent,
    ).Scan(&groupID)
    if err != nil {
        writeErr(w, http.StatusBadRequest, err.Error())
        return
    }

    for _, m := range req.InitialMembers {
        msisdn := security.NormalizeMSISDN(m.MSISDN)
        if msisdn == "" {
            continue
        }
        mpin := m.PIN
        if len(mpin) < 4 {
            mpin = "0000"
        }
        mHash, err := security.HashPIN(mpin)
        if err != nil {
            writeErr(w, http.StatusInternalServerError, "member pin hash failed")
            return
        }
        var memberID string
        err = tx.QueryRow(`
            INSERT INTO members (group_id, display_name, msisdn_norm, pin_hash, rotation_slot, successor_name, successor_msisdn, proxy_aliases)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            groupID, m.DisplayName, msisdn, mHash, m.RotationSlot, m.SuccessorName, security.NormalizeMSISDN(m.SuccessorMSISDN), pq.Array(m.ProxyAliases),
        ).Scan(&memberID)
        if err != nil {
            writeErr(w, http.StatusBadRequest, err.Error())
            return
        }
        if err := seedCycleObligations(tx, groupID, memberID, req.CycleYear, req.ContributionCents); err != nil {
            writeErr(w, http.StatusInternalServerError, "seed obligations error")
            return
        }
    }
    _, _ = tx.Exec(`INSERT INTO audit_events (group_id, event_type, source_tag, reason_note, payload_json) VALUES ($1,'GROUP_CREATED','SYSTEM','POPIA EU consent recorded',$2)`,
        groupID, fmt.Sprintf(`{"slug":%q,"cycle_year":%d}`, slug, req.CycleYear))
    if err := tx.Commit(); err != nil {
        writeErr(w, http.StatusInternalServerError, "commit failed")
        return
    }
    tok, _ := security.SignToken(security.TokenClaims{GroupID: groupID, GroupSlug: slug, Role: "TREASURER"})
    writeJSON(w, http.StatusCreated, map[string]any{"group_id": groupID, "slug": slug, "token": tok, "role": "TREASURER"})
}

func (s *Server) HandleAuth(w http.ResponseWriter, r *http.Request) {
    if !s.Limiter.Allow(security.ClientIP(r)) {
        writeErr(w, http.StatusTooManyRequests, "rate limit exceeded: max 5 PIN checks/min")
        return
    }
    slug := r.PathValue("slug")
    var req struct {
        MSISDN string `json:"msisdn"`
        PIN    string `json:"pin"`
        Role   string `json:"role"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeErr(w, http.StatusBadRequest, "invalid json")
        return
    }
    var groupID, tHash string
    if err := s.DB.QueryRow(`SELECT id, treasurer_pin_hash FROM groups WHERE slug = $1`, slug).Scan(&groupID, &tHash); err != nil {
        writeErr(w, http.StatusNotFound, "group not found")
        return
    }
    if strings.ToUpper(req.Role) == "TREASURER" {
        if !security.VerifyPIN(req.PIN, tHash) {
            writeErr(w, http.StatusUnauthorized, "invalid treasurer PIN")
            return
        }
        tok, _ := security.SignToken(security.TokenClaims{GroupID: groupID, GroupSlug: slug, Role: "TREASURER"})
        writeJSON(w, http.StatusOK, map[string]any{"token": tok, "role": "TREASURER", "group_id": groupID})
        return
    }
    msisdn := security.NormalizeMSISDN(req.MSISDN)
    var memberID, mHash string
    var failed int
    var lockedUntil sql.NullTime
    if err := s.DB.QueryRow(`SELECT id, pin_hash, failed_pin_attempts, locked_until FROM members WHERE group_id = $1 AND msisdn_norm = $2`, groupID, msisdn).
        Scan(&memberID, &mHash, &failed, &lockedUntil); err != nil {
        writeErr(w, http.StatusUnauthorized, "member not found")
        return
    }
    if failed >= 10 {
        writeErr(w, http.StatusLocked, "PIN locked after 10 misses; treasurer reset required")
        return
    }
    if lockedUntil.Valid && time.Now().Before(lockedUntil.Time) {
        writeErr(w, http.StatusLocked, "15-minute cooldown active")
        return
    }
    if !security.VerifyPIN(req.PIN, mHash) {
        failed++
        var nextLock any = nil
        if failed >= 5 && failed < 10 {
            nextLock = time.Now().Add(15 * time.Minute)
        }
        _, _ = s.DB.Exec(`UPDATE members SET failed_pin_attempts=$1, locked_until=$2 WHERE id=$3`, failed, nextLock, memberID)
        writeErr(w, http.StatusUnauthorized, "invalid PIN")
        return
    }
    _, _ = s.DB.Exec(`UPDATE members SET failed_pin_attempts=0, locked_until=NULL WHERE id=$1`, memberID)
    tok, _ := security.SignToken(security.TokenClaims{GroupID: groupID, GroupSlug: slug, MemberID: memberID, Role: "MEMBER"})
    writeJSON(w, http.StatusOK, map[string]any{"token": tok, "role": "MEMBER", "member_id": memberID, "group_id": groupID})
}

func (s *Server) authenticate(r *http.Request, requiredRole string) (*security.TokenClaims, error) {
    auth := r.Header.Get("Authorization")
    if !strings.HasPrefix(auth, "Bearer ") {
        return nil, errors.New("missing bearer token")
    }
    claims, err := security.VerifyToken(strings.TrimPrefix(auth, "Bearer "))
    if err != nil {
        return nil, err
    }
    if slug := r.PathValue("slug"); slug != "" && claims.GroupSlug != slug {
        return nil, errors.New("token scope mismatch")
    }
    if requiredRole == "TREASURER" && claims.Role != "TREASURER" {
        return nil, errors.New("treasurer access required")
    }
    return claims, nil
}
