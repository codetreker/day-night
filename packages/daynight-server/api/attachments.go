package api

import "time"

type Attachment struct {
	Path        string    `json:"path"`
	ContentType string    `json:"contentType"`
	SizeBytes   int64     `json:"sizeBytes"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type AttachmentPage struct {
	Items      []Attachment `json:"items"`
	NextCursor *string      `json:"nextCursor"`
}
