package core

import "time"

type ProjectSettings struct {
	Version                 int64
	ExecutionWarningMinutes int32
}

type Project struct {
	ID        string
	Name      string
	RepoURL   string
	CreatedAt time.Time
	UpdatedAt time.Time
	Settings  ProjectSettings
}
