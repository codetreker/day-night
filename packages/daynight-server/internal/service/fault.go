package service

type Fault struct {
	Code       string
	Message    string
	Cause      error
	TaskIDs    []string
	GraphLimit *GraphLimitDetails
}

type GraphLimitDetails struct {
	NodeCount int64
	EdgeCount int64
	MaxNodes  int64
	MaxEdges  int64
}

func (f *Fault) Error() string { return f.Message }
func (f *Fault) Unwrap() error { return f.Cause }

func invalidInput(message string) error {
	return &Fault{Code: "invalid_input", Message: message}
}
