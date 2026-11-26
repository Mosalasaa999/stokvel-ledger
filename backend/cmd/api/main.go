package main

import (
    "log"
    "net/http"
    "os"
    "time"

    "github.com/Mosalasaa999/stokvel-ledger/internal/db"
    "github.com/Mosalasaa999/stokvel-ledger/internal/ledger"
    "github.com/Mosalasaa999/stokvel-ledger/internal/security"
)

func withCORS(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Access-Control-Allow-Origin", "*")
        w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if r.Method == http.MethodOptions {
            w.WriteHeader(http.StatusNoContent)
            return
        }
        next.ServeHTTP(w, r)
    })
}

func main() {
    dbURL := os.Getenv("DATABASE_URL")
    if dbURL == "" {
        log.Fatal("DATABASE_URL environment variable is required")
    }
    conn, err := db.ConnectAndMigrate(dbURL)
    if err != nil {
        log.Fatalf("database init failed: %v", err)
    }
    defer conn.Close()

    srv := &ledger.Server{DB: conn, Limiter: security.NewIPRateLimiter()}
    mux := http.NewServeMux()
    mux.HandleFunc("GET /healthz", srv.HandleHealthz)
    mux.HandleFunc("POST /v1/groups", srv.HandleCreateGroup)
    mux.HandleFunc("POST /v1/groups/{slug}/auth", srv.HandleAuth)
    mux.HandleFunc("GET /v1/groups/{slug}/ledger", srv.HandleGetLedger)
    mux.HandleFunc("POST /v1/groups/{slug}/import", srv.HandleImportStatement)
    mux.HandleFunc("POST /v1/groups/{slug}/batches/{batchId}/rollback", srv.HandleRollbackBatch)
    mux.HandleFunc("POST /v1/groups/{slug}/transactions/{txId}/assign", srv.HandleAssignTx)
    mux.HandleFunc("POST /v1/groups/{slug}/advances", srv.HandleManualAdvance)
    mux.HandleFunc("POST /v1/groups/{slug}/rollover", srv.HandleRollover2027)

    port := os.Getenv("PORT")
    if port == "" {
        port = "8080"
    }
    httpServer := &http.Server{
        Addr: ":" + port, Handler: withCORS(mux),
        ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
    }
    log.Printf("[BOOT] StokvelLedger Go 1.22 API listening on :%s", port)
    log.Fatal(httpServer.ListenAndServe())
}
