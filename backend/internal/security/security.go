package security

import (
    "crypto/hmac"
    "crypto/rand"
    "crypto/sha256"
    "crypto/subtle"
    "encoding/base64"
    "encoding/hex"
    "encoding/json"
    "errors"
    "fmt"
    "net"
    "net/http"
    "os"
    "strings"
    "sync"
    "time"

    "golang.org/x/crypto/argon2"
)

var argonSem = make(chan struct{}, 4)

func HashPIN(pin string) (string, error) {
    argonSem <- struct{}{}
    defer func() { <-argonSem }()
    salt := make([]byte, 16)
    if _, err := rand.Read(salt); err != nil {
        return "", err
    }
    hash := argon2.IDKey([]byte(pin), salt, 2, 16*1024, 1, 32)
    return fmt.Sprintf("%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

func VerifyPIN(pin, encoded string) bool {
    parts := strings.Split(encoded, "$")
    if len(parts) != 2 {
        return false
    }
    salt, err1 := base64.RawStdEncoding.DecodeString(parts[0])
    expected, err2 := base64.RawStdEncoding.DecodeString(parts[1])
    if err1 != nil || err2 != nil {
        return false
    }
    argonSem <- struct{}{}
    defer func() { <-argonSem }()
    actual := argon2.IDKey([]byte(pin), salt, 2, 16*1024, 1, uint32(len(expected)))
    return subtle.ConstantTimeCompare(actual, expected) == 1
}

type IPRateLimiter struct {
    mu       sync.Mutex
    requests map[string][]time.Time
}

func NewIPRateLimiter() *IPRateLimiter {
    return &IPRateLimiter{requests: make(map[string][]time.Time)}
}

func ClientIP(r *http.Request) string {
    if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
        return strings.TrimSpace(strings.Split(xff, ",")[0])
    }
    host, _, err := net.SplitHostPort(r.RemoteAddr)
    if err != nil {
        return r.RemoteAddr
    }
    return host
}

func (l *IPRateLimiter) Allow(ip string) bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    now := time.Now()
    cutoff := now.Add(-1 * time.Minute)
    var recent []time.Time
    for _, t := range l.requests[ip] {
        if t.After(cutoff) {
            recent = append(recent, t)
        }
    }
    if len(recent) >= 5 {
        l.requests[ip] = recent
        return false
    }
    l.requests[ip] = append(recent, now)
    return true
}

type TokenClaims struct {
    GroupID   string `json:"gid"`
    GroupSlug string `json:"slug"`
    MemberID  string `json:"mid,omitempty"`
    Role      string `json:"role"`
    Exp       int64  `json:"exp"`
}

func tokenSecret() []byte {
    if s := os.Getenv("AUTH_SECRET"); s != "" {
        return []byte(s)
    }
    return []byte("dev-ephemeral-secret-change-in-render")
}

func SignToken(c TokenClaims) (string, error) {
    c.Exp = time.Now().Add(24 * time.Hour).Unix()
    raw, err := json.Marshal(c)
    if err != nil {
        return "", err
    }
    payload := base64.RawURLEncoding.EncodeToString(raw)
    mac := hmac.New(sha256.New, tokenSecret())
    mac.Write([]byte(payload))
    return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func VerifyToken(tok string) (*TokenClaims, error) {
    parts := strings.Split(tok, ".")
    if len(parts) != 2 {
        return nil, errors.New("malformed token")
    }
    mac := hmac.New(sha256.New, tokenSecret())
    mac.Write([]byte(parts[0]))
    expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
    if subtle.ConstantTimeCompare([]byte(parts[1]), []byte(expectedSig)) != 1 {
        return nil, errors.New("invalid signature")
    }
    raw, err := base64.RawURLEncoding.DecodeString(parts[0])
    if err != nil {
        return nil, err
    }
    var claims TokenClaims
    if err := json.Unmarshal(raw, &claims); err != nil {
        return nil, err
    }
    if time.Now().Unix() > claims.Exp {
        return nil, errors.New("token expired")
    }
    return &claims, nil
}

func NormalizeMSISDN(input string) string {
    var b strings.Builder
    for _, r := range input {
        if r >= '0' && r <= '9' {
            b.WriteRune(r)
        }
    }
    s := b.String()
    if strings.HasPrefix(s, "27") && len(s) == 11 {
        return "0" + s[2:]
    }
    return s
}

func SHA256Hex(parts ...string) string {
    h := sha256.New()
    h.Write([]byte(strings.Join(parts, "|")))
    return hex.EncodeToString(h.Sum(nil))
}
