package server

import (
	"log/slog"
	"net/http"

	"github.com/codetreker/daynight/packages/daynight-server/internal/service"
)

func New(projects *service.Projects, tasks *service.Tasks, attachments *service.Attachments, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	projectRoutes(mux, projects, logger)
	taskRoutes(mux, tasks, logger)
	attachmentRoutes(mux, attachments, logger)
	uiRoutes(mux, logger)
	mux.HandleFunc("/", func(w http.ResponseWriter, request *http.Request) {
		writeError(w, request, logger, "server", "route", &service.Fault{Code: "not_found", Message: "resource not found"})
	})
	return attachmentPathGuard(mux, logger)
}
