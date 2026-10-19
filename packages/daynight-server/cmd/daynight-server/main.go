package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
	"github.com/codetreker/daynight/packages/daynight-server/internal/server"
	"github.com/codetreker/daynight/packages/daynight-server/internal/service"
)

var exit = os.Exit

func main() {
	exit(run(context.Background(), os.Getenv, os.Stderr))
}

func run(ctx context.Context, getenv func(string) string, output io.Writer) int {
	logger := slog.New(slog.NewJSONHandler(output, nil))
	config, err := server.LoadConfig(getenv)
	if err != nil {
		server.LogFailure(logger, ctx, "configuration", "load", err)
		return 1
	}
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	runtime, err := server.Start(ctx, config, logger, func(database *store.Store) http.Handler {
		return server.New(service.NewProjects(database), logger)
	})
	if err != nil {
		server.LogFailure(logger, ctx, "server", "startup", err)
		return 1
	}
	if err := runtime.Run(ctx); err != nil {
		server.LogFailure(logger, ctx, "server", "shutdown", err)
		return 1
	}
	return 0
}
