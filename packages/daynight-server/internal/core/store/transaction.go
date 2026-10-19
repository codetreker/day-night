package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

const cleanupTimeout = 5 * time.Second

func transact(ctx context.Context, tx pgx.Tx, operation func(pgx.Tx) error) (err error) {
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), cleanupTimeout)
		defer cancel()
		if rollbackErr := tx.Rollback(cleanup); rollbackErr != nil && rollbackErr != pgx.ErrTxClosed {
			err = errors.Join(err, rollbackErr)
		}
	}()
	if err = operation(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
