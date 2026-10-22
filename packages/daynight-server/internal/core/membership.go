package core

import "time"

type ProjectRole string

const (
	ProjectAdmin      ProjectRole = "admin"
	ProjectMemberRole ProjectRole = "member"
)

type ProjectMember struct {
	ProjectID string
	UserID    string
	Role      ProjectRole
	Version   int64
	Email     *string
	Name      *string
	AvatarURL *string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type ProjectInvitation struct {
	ID         string
	ProjectID  string
	CreatedBy  string
	TokenHash  []byte
	CreatedAt  time.Time
	ExpiresAt  time.Time
	ConsumedBy *string
	ConsumedAt *time.Time
	RevokedAt  *time.Time
}
