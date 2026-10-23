package core

import "time"

type TaskStatus string

const (
	TaskProposed   TaskStatus = "proposed"
	TaskTodo       TaskStatus = "todo"
	TaskInProgress TaskStatus = "in_progress"
	TaskDone       TaskStatus = "done"
)

type Task struct {
	ID                string
	ProjectID         string
	Title             string
	Description       string
	Properties        TaskProperties
	Status            TaskStatus
	Version           int64
	CreatedAt         time.Time
	UpdatedAt         time.Time
	StartedAt         *time.Time
	CompletedAt       *time.Time
	DependsOn         []string
	ExternalDependsOn []string
	BlockedBy         []string
	AllowAgents       bool
	Ready             bool
}
