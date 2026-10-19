package store

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func databaseURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("DAYNIGHT_TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("DAYNIGHT_TEST_DATABASE_URL is required for PostgreSQL tests")
	}
	return url
}

func TestOpenAndReuse(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for range 2 {
		database, err := Open(ctx, databaseURL(t))
		if err != nil {
			t.Fatal(err)
		}
		var value int
		if err := database.Pool.QueryRow(ctx, "select 42").Scan(&value); err != nil || value != 42 {
			t.Fatalf("query returned %d, %v", value, err)
		}
		database.Close()
	}
}

func TestOpenFailuresPreserveCauseAndRedact(t *testing.T) {
	for _, url := range []string{"postgres://user:top-secret@bad%host/db", "postgres://user:top-secret@127.0.0.1:1/db?connect_timeout=1"} {
		_, err := Open(context.Background(), url)
		var failure *Error
		if !errors.As(err, &failure) || errors.Unwrap(err) == nil {
			t.Fatalf("missing driver cause: %v", err)
		}
		if strings.Contains(err.Error(), "top-secret") || strings.Contains(err.Error(), "user") {
			t.Fatalf("sensitive diagnostic: %s", err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Open(ctx, databaseURL(t))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled connection: %v", err)
	}
}

func TestQueryCancellationReleasesConnection(t *testing.T) {
	database, err := Open(context.Background(), databaseURL(t))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	_, err = database.Pool.Exec(ctx, "select pg_sleep(10)")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline: %v", err)
	}
	if err := database.Pool.Ping(context.Background()); err != nil {
		t.Fatalf("pool unusable after cancellation: %v", err)
	}
}
