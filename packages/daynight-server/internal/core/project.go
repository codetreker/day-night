package core

import "time"

type Project struct {
	ID        string
	Name      string
	RepoURL   string
	CreatedAt time.Time
	UpdatedAt time.Time
}
