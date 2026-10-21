package store

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/001_projects.sql
var projectsSQL string

//go:embed migrations/002_tasks.sql
var tasksSQL string

//go:embed migrations/003_task_properties.sql
var taskPropertiesSQL string

type migration struct {
	version int64
	sql     string
}

var schemaMigrations = []migration{{version: 1, sql: projectsSQL}, {version: 2, sql: tasksSQL}, {version: 3, sql: taskPropertiesSQL}}

const migrationLock int64 = 0x4441594e49474854

func migrate(ctx context.Context, pool *pgxpool.Pool, migrations []migration) (err error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, releaseMigrationConnection(conn)) }()
	if _, err = conn.Exec(ctx, "SELECT pg_advisory_lock($1)", migrationLock); err != nil {
		return err
	}
	if _, err = conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version bigint PRIMARY KEY,
		checksum text NOT NULL CHECK (length(checksum) = 64),
		applied_at timestamptz NOT NULL DEFAULT statement_timestamp()
	)`); err != nil {
		return err
	}
	applied, err := appliedMigrations(ctx, conn, migrations)
	if err != nil {
		return err
	}
	for _, next := range migrations[applied:] {
		tx, beginErr := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
		if beginErr != nil {
			return beginErr
		}
		if err = transact(ctx, tx, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, next.sql); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", next.version, checksum(next.sql))
			return err
		}); err != nil {
			return err
		}
	}
	return nil
}

func appliedMigrations(ctx context.Context, conn *pgxpool.Conn, migrations []migration) (int, error) {
	rows, err := conn.Query(ctx, "SELECT version, checksum FROM schema_migrations ORDER BY version")
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	applied := 0
	for rows.Next() {
		var version int64
		var savedChecksum string
		if err := rows.Scan(&version, &savedChecksum); err != nil {
			return 0, err
		}
		if applied >= len(migrations) || version != migrations[applied].version {
			return 0, fmt.Errorf("migration version %d is not an ordered prefix", version)
		}
		if savedChecksum != checksum(migrations[applied].sql) {
			return 0, fmt.Errorf("migration version %d checksum mismatch", version)
		}
		applied++
	}
	return applied, rows.Err()
}

func checksum(sql string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(sql))) }

func releaseMigrationConnection(conn *pgxpool.Conn) (err error) {
	defer conn.Release()
	ctx, cancel := context.WithTimeout(context.Background(), cleanupTimeout)
	defer cancel()
	var unlocked bool
	if err = conn.QueryRow(ctx, "SELECT pg_advisory_unlock($1)", migrationLock).Scan(&unlocked); err == nil {
		return nil
	}
	// A failed unlock leaves ownership uncertain; ending the physical session prevents a pooled lock leak.
	closeCtx, closeCancel := context.WithTimeout(context.Background(), cleanupTimeout)
	defer closeCancel()
	return errors.Join(err, conn.Conn().Close(closeCtx))
}
