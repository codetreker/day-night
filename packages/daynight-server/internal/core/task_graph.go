package core

import "time"

type GraphTask struct {
	ID             string
	TitlePreview   string
	TitleTruncated bool
	Status         TaskStatus
	DependsOn      []string
	BlockedBy      []string
	Ready          bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
	StartedAt      *time.Time
	CompletedAt    *time.Time
}

type TaskGraphSummary struct {
	Total      int64
	Proposed   int64
	Todo       int64
	InProgress int64
	Done       int64
	Ready      int64
	Blocked    int64
}

type TaskGraph struct {
	Project    Project
	ObservedAt time.Time
	Summary    TaskGraphSummary
	Tasks      []GraphTask
}
