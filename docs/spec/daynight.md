# Daynight Requirements

Status: approved product scope; implementation is not yet present.

Daynight is a foreground CLI that stays running, monitors configured GitHub
repositories, and starts a review agent when an eligible pull request needs
review. The daemon role belongs to that CLI process. It maintains repository
copies, worktrees, review sessions, and durable scheduling state. The agent
reviews code and publishes its own review to GitHub.

This document owns the required behavior and acceptance scenarios. Architecture
documents own the mechanisms that satisfy these requirements.

## Requirements

### R1. Package and runtime

The tool is named `daynight`. Its application code belongs in
`packages/daynight/` and is written in TypeScript. It starts as one foreground
CLI and keeps running until stopped, on Linux, macOS, and Windows. The CLI polls,
maintains SQLite state, manages worktrees, and starts Copilot directly as a child
process. All three platforms support the same repository, monitoring, session,
worktree, completion, and recovery behavior. Child invocation, output handling,
and normal exit must be verified on each platform.

### R2. Repository configuration

A configuration file identifies every monitored GitHub repository by its remote
address and local repository path. Each configured repository has independent
initialization and PR state.

### R3. Local repository and authentication

At startup, the daemon ensures that each configured repository has been cloned
at its configured local path. It clones a missing repository. GitHub CLI
authentication is prepared by the environment before the daemon starts.

### R4. Permanent initialization cutoff

On the first initialization of each repository, the daemon records the highest
existing PR number as that repository's `Start PR No`. The cutoff covers
existing PRs in all states, including Draft, Open, Closed, and Merged.

A PR whose number is less than or equal to `Start PR No` is permanently excluded
from review. Later commits, readiness changes, target changes, or reopening do
not make that PR eligible. The cutoff is persisted once and reused after daemon
restart; restarting does not establish a new cutoff.

### R5. Polling and eligibility

The daemon continuously polls configured repositories at intervals. A PR can be
reviewed only when all of these conditions hold:

- Its number exceeds the repository's `Start PR No`.
- It is Open.
- It is not Draft, and is therefore ready for review.

Draft PRs are tracked so that they can become eligible when ready. Review must
not start while the PR is Draft or closed.

### R6. Review triggers

For a PR above the cutoff, the following observed conditions require review
when the eligibility conditions in R5 hold:

- A newly discovered PR is already ready for review.
- The PR's head SHA changes, including after added commits or a force push.
- The PR transitions from Draft to ready for review.
- The PR changes its target branch.

A target branch receiving new commits, by itself, does not trigger review.
Changes that occur while the PR is Draft must not cause a review until the PR
becomes ready.

### R7. Per-PR execution ordering

At most one review agent runs for a given PR at a time. A change requiring
review that is observed during an active review remains pending for a subsequent
review. Pending changes can be combined so that the subsequent review examines
the latest eligible state.

### R8. Persistent agent session

The daemon invokes Copilot CLI as a local review agent. Each reviewed PR has one
persistent CLI session. Every subsequent review and every confirmation or retry
for that PR resumes the same session to preserve review context. The session
identity survives daemon restart.

### R9. Worktree ownership and lifecycle

Each reviewed PR has an isolated Git worktree. The daemon creates it for the
first review and reuses it for subsequent reviews of that PR. The daemon owns
creation, preparation, updating, and cleanup of these worktrees; the review
agent does not perform worktree management.

When a PR is merged or closed without merging, the daemon cleans up its
worktree. The term deprecated PR means a PR closed without merging.

### R10. Review judgment and publication

The agent performs the review and publishes the result directly to GitHub:

- When it finds Critical or Major problems, it publishes inline review comments
  on the relevant code lines. It does not submit `REQUEST_CHANGES`.
- When it finds no Critical or Major problems, it approves the PR.

The daemon does not publish reviews on the agent's behalf and does not parse
JSONL or structured findings to decide what to publish.

### R11. Text completion protocol

After completing both the review and the required GitHub publication, the
agent's last nonempty standard-output line must be exactly:

```text
PR <number> Review Completed
```

`<number>` is the decimal number of the PR being reviewed, such as
`PR 123 Review Completed`. The line stands alone without additional formatting.
The daemon checks this line after the agent process ends. A marker for another
PR, an incomplete marker, or a marker followed by another nonempty line does not
satisfy the protocol. The agent emits the marker only after the required GitHub
operations have succeeded.

### R12. Confirmation and retry

If the agent ends without the required completion marker, the daemon resumes
the same session to request confirmation or retry. The agent first determines
whether its prior attempt already published the required result. If publication
is complete, it confirms completion with the marker; otherwise it completes the
remaining work. Before retrying publication, the agent reconciles prior GitHub
effects and avoids knowingly publishing the same review result again. The
completion marker is the agent's assertion that the required operations
succeeded; GitHub publication and SQLite state changes are not one atomic
operation.

### R13. Durable state and restart

SQLite stores the durable state needed to recover repository monitoring and
review execution. This includes repository initialization cutoffs, observed PR
state, target branch and head SHA, reviewed versions, CLI session identity,
worktree identity, execution state, and confirmation or retry state.

After restart, the daemon recovers pending or interrupted work from this state.
It preserves the permanent exclusions in R4 and the per-PR session continuity
in R8. An interrupted attempt is not treated as completed merely because the
daemon restarted.

### R14. Review version attribution

Each review attempt and completion is associated with the PR version that the
attempt was asked to review. Completing an attempt for one head SHA does not
satisfy a pending review for another head SHA. Likewise, completion does not
erase a pending trigger from a later readiness transition or target-branch
change.

## Acceptance scenarios

| Scenario | Required outcome | Requirements |
|---|---|---|
| The daemon runs on Linux, macOS, or Windows. | The foreground CLI supports the required workflow using direct Copilot children, with command execution, output handling, and normal exit verified. | R1 |
| A configured local repository is missing at startup. | The daemon clones it to the configured path before using it for review. | R2, R3 |
| Repository initialization finds PR numbers through 100, including closed and Draft PRs. | The stored cutoff is 100. No PR numbered 100 or below is ever reviewed, including after later changes. | R4 |
| The daemon restarts after the cutoff was recorded. | It uses the existing cutoff and does not exclude newer PRs by initializing again. | R4, R13 |
| PR 101 appears Open and ready after a cutoff of 100. | The daemon schedules its first review. | R5, R6 |
| PR 101 appears as Draft and receives commits. | It is tracked without starting review; becoming ready requires review. | R5, R6 |
| An eligible PR receives a new head SHA or is force-pushed. | The new version requires review. | R6, R14 |
| An eligible PR changes its target branch. | The target change requires review. | R6 |
| Only the target branch receives a commit. | That change alone does not schedule review. | R6 |
| A PR receives new commits during review. | No second agent runs concurrently for that PR; the latest eligible version remains pending. | R7, R14 |
| A PR requires another review or recovery after an incomplete attempt. | The daemon resumes its existing Copilot CLI session and uses its existing worktree while the PR remains open. | R8, R9, R12 |
| Review identifies a Critical or Major problem. | The agent publishes inline comments and does not submit `REQUEST_CHANGES`. | R10 |
| Review identifies no Critical or Major problem. | The agent approves the PR. | R10 |
| Publication succeeds and the last nonempty output line is `PR 101 Review Completed`. | The daemon recognizes completion of that attempt for PR 101. | R11, R14 |
| The agent exits without the exact final marker. | The daemon does not record protocol completion and resumes the same session for confirmation or retry. | R11, R12 |
| Publication may have succeeded before the process ended without its marker. | The resumed agent reconciles prior GitHub effects before retrying and avoids knowingly duplicating a published result. | R12 |
| A reviewed PR is merged or closed without merging. | The daemon cleans up that PR's worktree. | R9 |
| The daemon restarts with pending or interrupted review work. | The saved cutoff, PR version, session, worktree, and execution state support recovery without falsely declaring completion. | R13, R14 |

## Policy ownership

The requirements above do not prescribe polling intervals, concurrency across
different PRs, retry limits and backoff, process timeouts, or the behavior of an
above-cutoff PR reopened after its worktree was cleaned up. Architecture and
operational documents must identify their selected policies and limitations
without presenting them as additional product requirements.
