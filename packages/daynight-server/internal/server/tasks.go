package server

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/codetreker/daynight/packages/daynight-server/api"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/service"
)

type taskHandler struct {
	tasks  *service.Tasks
	logger *slog.Logger
}

func taskRoutes(mux *http.ServeMux, tasks *service.Tasks, logger *slog.Logger) {
	handler := &taskHandler{tasks: tasks, logger: logger}
	mux.HandleFunc("POST /api/v1/projects/{projectId}/tasks", handler.create)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/tasks", handler.list)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/tasks/{taskId}", handler.get)
	mux.HandleFunc("PATCH /api/v1/projects/{projectId}/tasks/{taskId}", handler.update)
	mux.HandleFunc("/api/v1/projects/{projectId}/tasks", methodNotAllowed(logger, "GET, HEAD, POST"))
	mux.HandleFunc("/api/v1/projects/{projectId}/tasks/{taskId}", methodNotAllowed(logger, "GET, HEAD, PATCH"))
}

func taskResponse(task core.Task) api.Task {
	return api.Task{ID: task.ID, ProjectID: task.ProjectID, Title: task.Title, Description: task.Description,
		Status: string(task.Status), Version: task.Version, CreatedAt: task.CreatedAt.UTC(), UpdatedAt: task.UpdatedAt.UTC(),
		DependsOn: append([]string{}, task.DependsOn...), BlockedBy: append([]string{}, task.BlockedBy...), Ready: task.Ready}
}

func (h *taskHandler) resource(request *http.Request) (string, string, *slog.Logger, error) {
	projectID, err := service.CanonicalID(request.PathValue("projectId"))
	if err != nil {
		return "", "", h.logger, err
	}
	logger := h.logger.With("project_id", projectID)
	id := request.PathValue("taskId")
	if id != "" {
		id, err = service.CanonicalID(id)
		if err != nil {
			return "", "", logger, err
		}
		logger = logger.With("task_id", id)
	}
	return projectID, id, logger, nil
}

func createTaskInput(fields map[string]json.RawMessage) (api.CreateTaskRequest, error) {
	input := api.CreateTaskRequest{DependsOn: []string{}}
	var err error
	input.Title, err = requiredString(fields, "title")
	if err != nil {
		return api.CreateTaskRequest{}, err
	}
	description, err := optionalString(fields, "description")
	if err != nil {
		return api.CreateTaskRequest{}, err
	}
	if description != nil {
		input.Description = *description
	}
	dependencies, err := optionalStrings(fields, "dependsOn")
	if err != nil {
		return api.CreateTaskRequest{}, err
	}
	if dependencies != nil {
		input.DependsOn = *dependencies
	}
	return input, nil
}

func updateTaskInput(fields map[string]json.RawMessage) (api.UpdateTaskRequest, error) {
	var input api.UpdateTaskRequest
	if err := json.Unmarshal(fields["version"], &input.Version); err != nil || input.Version < 1 {
		return api.UpdateTaskRequest{}, invalidInput("version is required and must be a positive 64-bit integer")
	}
	var err error
	input.Title, err = optionalString(fields, "title")
	if err != nil {
		return api.UpdateTaskRequest{}, err
	}
	input.Description, err = optionalString(fields, "description")
	if err != nil {
		return api.UpdateTaskRequest{}, err
	}
	input.Status, err = optionalString(fields, "status")
	if err != nil {
		return api.UpdateTaskRequest{}, err
	}
	input.DependsOn, err = optionalStrings(fields, "dependsOn")
	if err != nil {
		return api.UpdateTaskRequest{}, err
	}
	if input.Title == nil && input.Description == nil && input.Status == nil && input.DependsOn == nil {
		return api.UpdateTaskRequest{}, invalidInput("at least one task field must be provided")
	}
	return input, nil
}

func taskListRequest(request *http.Request) (service.TaskListRequest, error) {
	values, err := queryValues(request, "limit", "cursor", "status", "ready")
	if err != nil {
		return service.TaskListRequest{}, err
	}
	page, err := pageValues(values)
	if err != nil {
		return service.TaskListRequest{}, err
	}
	result := service.TaskListRequest{PageRequest: page}
	if value, exists := values["status"]; exists {
		status := core.TaskStatus(value[0])
		result.Status = &status
	}
	if value, exists := values["ready"]; exists {
		if value[0] != "true" && value[0] != "false" {
			return service.TaskListRequest{}, invalidInput("ready must be true or false")
		}
		ready := value[0] == "true"
		result.Ready = &ready
	}
	return result, nil
}

func (h *taskHandler) create(w http.ResponseWriter, request *http.Request) {
	projectID, _, logger, err := h.resource(request)
	if err != nil {
		writeError(w, request, logger, "task", "create", err)
		return
	}
	fields, err := decodeObject(w, request, "title", "description", "dependsOn")
	if err != nil {
		writeError(w, request, logger, "task", "create", err)
		return
	}
	input, err := createTaskInput(fields)
	if err != nil {
		writeError(w, request, logger, "task", "create", err)
		return
	}
	task, err := h.tasks.Create(request.Context(), projectID, service.CreateTask{
		Title: input.Title, Description: input.Description, DependsOn: input.DependsOn,
	})
	if err != nil {
		writeError(w, request, logger, "task", "create", err)
		return
	}
	logger = logger.With("task_id", task.ID)
	logger.InfoContext(request.Context(), "task created", "type", "resource", "component", "task", "phase", "create", "request_id", RequestID(request.Context()))
	writeCreated(w, request, logger, "/api/v1/projects/"+projectID+"/tasks/"+task.ID, taskResponse(task))
}

func (h *taskHandler) list(w http.ResponseWriter, request *http.Request) {
	projectID, _, logger, err := h.resource(request)
	if err != nil {
		writeError(w, request, logger, "task", "list", err)
		return
	}
	input, err := taskListRequest(request)
	if err != nil {
		writeError(w, request, logger, "task", "list", err)
		return
	}
	page, err := h.tasks.List(request.Context(), projectID, input)
	if err != nil {
		writeError(w, request, logger, "task", "list", err)
		return
	}
	response := api.TaskPage{Items: make([]api.Task, 0, len(page.Items)), NextCursor: page.NextCursor}
	for _, task := range page.Items {
		response.Items = append(response.Items, taskResponse(task))
	}
	writeJSON(w, request, logger, http.StatusOK, response)
}

func (h *taskHandler) get(w http.ResponseWriter, request *http.Request) {
	projectID, id, logger, err := h.resource(request)
	if err != nil {
		writeError(w, request, logger, "task", "get", err)
		return
	}
	task, err := h.tasks.Get(request.Context(), projectID, id)
	if err != nil {
		writeError(w, request, logger, "task", "get", err)
		return
	}
	logger.InfoContext(request.Context(), "task read", "type", "resource", "component", "task", "phase", "get", "request_id", RequestID(request.Context()))
	writeJSON(w, request, logger, http.StatusOK, taskResponse(task))
}

func (h *taskHandler) update(w http.ResponseWriter, request *http.Request) {
	projectID, id, logger, err := h.resource(request)
	if err != nil {
		writeError(w, request, logger, "task", "update", err)
		return
	}
	fields, err := decodeObject(w, request, "version", "title", "description", "status", "dependsOn")
	if err != nil {
		writeError(w, request, logger, "task", "update", err)
		return
	}
	input, err := updateTaskInput(fields)
	if err != nil {
		writeError(w, request, logger, "task", "update", err)
		return
	}
	values := service.UpdateTask{Version: input.Version, Title: input.Title, Description: input.Description, DependsOn: input.DependsOn}
	if input.Status != nil {
		status := core.TaskStatus(*input.Status)
		values.Status = &status
	}
	task, err := h.tasks.Update(request.Context(), projectID, id, values)
	if err != nil {
		writeError(w, request, logger, "task", "update", err)
		return
	}
	logger.InfoContext(request.Context(), "task updated", "type", "resource", "component", "task", "phase", "update", "request_id", RequestID(request.Context()))
	writeJSON(w, request, logger, http.StatusOK, taskResponse(task))
}
