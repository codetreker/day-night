package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestTransactRollbackSurvivesCancellation(t *testing.T) {
	pool := emptyPool(t)
	if _, err := pool.Exec(context.Background(), "CREATE TABLE rollback_marker (id int)"); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	err = transact(ctx, tx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "INSERT INTO rollback_marker VALUES (1)"); err != nil {
			return err
		}
		cancel()
		return context.Canceled
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation cause lost: %v", err)
	}
	var count int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM rollback_marker").Scan(&count); err != nil || count != 0 {
		t.Fatalf("canceled write persisted: %d, %v", count, err)
	}
	assertMigrationPoolReusable(t, pool)
}

func TestTransactPreservesOperationAndCleanupFailures(t *testing.T) {
	pool := emptyPool(t)
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	primary, cleanup := errors.New("operation failed"), errors.New("rollback failed")
	wrapped := &rollbackFailureTx{Tx: tx, failure: cleanup}
	err = transact(context.Background(), wrapped, func(pgx.Tx) error { return primary })
	if !errors.Is(err, primary) || !errors.Is(err, cleanup) {
		t.Fatalf("transaction failure chain: %v", err)
	}
	if !wrapped.bounded {
		t.Fatal("rollback did not use a fresh bounded context")
	}
	assertMigrationPoolReusable(t, pool)
}

func TestTransactRollbackOnPanic(t *testing.T) {
	pool := emptyPool(t)
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	func() {
		defer func() {
			if recovered := recover(); recovered != "operation panic" {
				t.Fatalf("panic propagation: %v", recovered)
			}
		}()
		_ = transact(context.Background(), tx, func(pgx.Tx) error { panic("operation panic") })
	}()
	assertMigrationPoolReusable(t, pool)
}

func TestTransactDoesNotSuppressJoinedClosedRollbackFailure(t *testing.T) {
	pool := emptyPool(t)
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	cleanup := errors.New("rollback diagnostic failed")
	err = transact(context.Background(), &rollbackFailureTx{Tx: tx, failure: cleanup}, func(pgx.Tx) error { return nil })
	if !errors.Is(err, cleanup) || !errors.Is(err, pgx.ErrTxClosed) {
		t.Fatalf("joined closed-transaction error was suppressed: %v", err)
	}
	assertMigrationPoolReusable(t, pool)
}

type rollbackFailureTx struct {
	pgx.Tx
	failure error
	bounded bool
}

func (tx *rollbackFailureTx) Rollback(ctx context.Context) error {
	deadline, present := ctx.Deadline()
	tx.bounded = ctx.Err() == nil && present && time.Until(deadline) > 0 && time.Until(deadline) <= cleanupTimeout
	return errors.Join(tx.Tx.Rollback(ctx), tx.failure)
}
