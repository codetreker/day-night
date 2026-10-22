package server

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/codetreker/daynight/packages/daynight-server/api"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
)

type taskAction func(context.Context, string, string, int64) (core.Task, error)

func taskVersionInput(fields map[string]json.RawMessage) (int64, error) {
	var version int64
	if err := json.Unmarshal(fields["version"], &version); err != nil || version < 1 {
		return 0, invalidInput("version is required and must be a positive 64-bit integer")
	}
	return version, nil
}

func (h *taskHandler) lifecycle(name string, action taskAction) http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		projectID, id, logger, err := h.resource(request)
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
		input.Version, err = taskVersionInput(fields)
		if err != nil {
			writeError(w, request, logger, "task", name, err)
			return
		}
		task, err := action(request.Context(), projectID, id, input.Version)
		if err != nil {
			writeError(w, request, logger, "task", name, err)
			return
		}
		logger.InfoContext(request.Context(), "task state changed", "type", "resource", "component", "task", "phase", name, "request_id", RequestID(request.Context()))
		writeJSON(w, request, logger, http.StatusOK, taskResponse(task))
	}
}
