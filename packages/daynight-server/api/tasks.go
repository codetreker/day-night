package api

import "time"

type CreateTaskRequest struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	DependsOn   []string `json:"dependsOn"`
}

type UpdateTaskRequest struct {
	Version     int64     `json:"version"`
	Title       *string   `json:"title,omitempty"`
	Description *string   `json:"description,omitempty"`
	Status      *string   `json:"status,omitempty"`
	DependsOn   *[]string `json:"dependsOn,omitempty"`
}

type Task struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"projectId"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	Version     int64     `json:"version"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	DependsOn   []string  `json:"dependsOn"`
	BlockedBy   []string  `json:"blockedBy"`
	Ready       bool      `json:"ready"`
}

type TaskPage struct {
	Items      []Task  `json:"items"`
	NextCursor *string `json:"nextCursor"`
}
