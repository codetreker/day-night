package server

import (
	"context"
	"net/http"

	"github.com/codetreker/daynight/packages/daynight-server/api"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
)

type taskAction func(context.Context, core.Principal, string, string, int64) (core.Task, error)

func (h *taskHandler) lifecycle(name string, action taskAction) AuthenticatedHandler {
	return func(w http.ResponseWriter, request *http.Request, principal core.Principal) {
		w.Header().Set("Cache-Control", "no-store")
		projectID, id, logger, err := h.resource(request, principal)
		if err != nil {
			writeError(w, request, logger, "task", name, err)
			return
		}
		if request.URL.RawQuery != "" {
			writeError(w, request, logger, "task", name, invalidInput("task lifecycle does not accept query parameters"))
			return
		}
		fields, err := decodeObject(w, request, "version")
		if err != nil {
			writeError(w, request, logger, "task", name, err)
			return
		}
		input := api.TaskTransitionRequest{}
		input.Version, err = versionInput(fields)
		if err != nil {
			writeError(w, request, logger, "task", name, err)
			return
		}
		task, err := action(request.Context(), principal, projectID, id, input.Version)
		if err != nil {
			writeError(w, request, logger, "task", name, err)
			return
		}
		logger.InfoContext(request.Context(), "task state changed", "type", "resource", "component", "task", "phase", name, "request_id", RequestID(request.Context()))
		writeJSON(w, request, logger, http.StatusOK, taskResponse(task))
	}
}
