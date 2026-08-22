package app

import "testing"

func TestScheduleStatusIdentityMatchesSharedTypeScriptContract(t *testing.T) {
	update := ScheduleStatusUpdate{
		ScheduleID: "schedule-1",
		ContactID:  "contact-1",
		MessageID:  "message-1",
		Status:     "sent",
	}
	const expected = "schedule_status_v1_dea6624093765d011e9b1664d01a35238b14f28896c8a9a5dd6ec38d3781ca24"
	if got := ensureScheduleStatusEventID(&update); got != expected {
		t.Fatalf("Go identity diverged from shared TypeScript contract: %q", got)
	}
}

func TestScheduleStatusIdentityDoesNotDependOnAttemptID(t *testing.T) {
	firstAttempt := ScheduleStatusUpdate{
		AttemptID:  "attempt-1",
		ScheduleID: "schedule-1",
		ContactID:  "contact-1",
		MessageID:  "message-1",
		Status:     "sent",
	}
	secondAttempt := firstAttempt
	secondAttempt.AttemptID = "attempt-2"

	const expected = "schedule_status_v1_dea6624093765d011e9b1664d01a35238b14f28896c8a9a5dd6ec38d3781ca24"
	if got := ensureScheduleStatusEventID(&firstAttempt); got != expected {
		t.Fatalf("Go identity diverged from shared TypeScript contract: %q", got)
	}
	if got := ensureScheduleStatusEventID(&secondAttempt); got != expected {
		t.Fatalf("attempt_id changed the physical status identity: %q", got)
	}
}
