# Agent Note: Task Execution Platform Requirements

Status: implemented

## Problem

Tasks in one repository can require different operating systems. Readiness and
permission for automatic execution do not express that requirement. A bounded
candidate page can also appear empty after local filtering even when a later
compatible task exists. Platform edits must remain consistent with task versions,
manual execution and in-flight browser writes.

## Decision

Tasks and graph nodes expose the required nullable `requiredPlatform` field:
null means unrestricted; `windows`, `linux` and `macos` require that platform.
A nullable database column and migration give existing tasks null while
preserving their other fields, versions and timestamps. Creation accepts an
optional enum or null. PATCH distinguishes omission, an enum value and explicit
null as preserve, set and clear. Strict readers reject missing or invalid values.

Platform edits use the existing member-authorized project transaction and exact
version check. Same-value requests preserve version and update time, while stale
requests still conflict. Actual changes during `in_progress` fail atomically,
including when combined with other edits. Lifecycle and metadata writes preserve
the platform and [automatic-execution permission](../architecture/2026-10-23-task-agent-automation.md)
independently. Ordinary manual claim does not enforce automatic-worker platform
eligibility, and a platform mismatch does not change ready or task statistics.

The shared platform domain owns enum validation and compatibility. List queries
accept `compatiblePlatform` and include unrestricted tasks plus requirements
matching the requested enum. Platform, permission, readiness and status filters
run before ordering, pagination and lookahead, with every condition bound into
cursor scope. CLI list and bounded ready pass `--compatible-platform` through to
the server and validate returned items without filtering away a page locally.
The bundled automatic workflow determines its actual execution runtime from
`process.platform`: win32 maps to windows, darwin to macos and linux to linux,
including WSL. Unknown or unsupported platforms wait rather than infer a value
from task requirements, configuration or an outer host. Ready and fallback list
queries retain both permission=true and compatibility filters. Before claiming,
the latest full task must still be ready, allow automatic execution and have a
null or matching requirement; its exact observed version protects that decision.
An automatically selected task ID is not an explicit manual assignment.
Create/update expose `--required-platform`; update's mutually exclusive
`--clear-required-platform` sends null. Human output shows any for null and the
enum for a restriction, while JSON retains the nullable field.

The Web displays task-specific platform badges and a separate platform select
with an explicit Save platform action. Selection alone sends no request, and
saving Any platform clears the requirement. Platform saves share the existing
task session's write gate, exact-version freshness and unknown-result
reconciliation with permission and approval. Closing details or navigating does
not release a submitted operation or let its late result reach another task.
In-progress controls are locked. The left status group can wrap platform badges
while the automatic-execution control remains right aligned with the first line.
The [Web architecture](../../../../docs/design/daynight-web.md#平台要求与显式保存)
owns component and request behavior.

## Alternatives

**Filtering a bounded candidate page locally.** Earlier incompatible tasks can
consume the complete page and hide later compatible work. Filtering must precede
the server's ordering and page boundary; clients reject a response that violates
its declared filter rather than silently dropping items.

**One nullable PATCH value without field presence.** A nullable pointer alone
cannot distinguish omitted input from explicit null. Keeping field presence
separate makes metadata edits preserve a requirement while clear remains an
intentional operation, without extra endpoints or sentinel strings.

**Coupling platform delivery to worker startup.** Requiring a worker-specific
claim endpoint or agent startup to deliver the task field would reverse the
worker design's prerequisite order. The delivered domain predicate and candidate
query are reusable by the later claim transaction. The bundled workflow already
uses its actual execution platform; daemon-specific environment integration,
exclusive worker claim, resource startup and execution history remain
with the [worker architecture](../../../../docs/design/daynight-worker.md).

## Consequences

A task's saved requirement is explicit across service, CLI and Web, without
inventing a default in readers or inferring an execution environment from the
server. A query platform is a selection argument, not a configuration override
or proof of where a process runs. The bundled automatic workflow binds its
selection to the observed runtime and rechecks eligibility before ordinary
claim. The future worker daemon must likewise use its actual runtime, including
Linux for WSL, and recheck compatibility in its claim transaction before starting
resources.

Platform acceptance covers migration preservation, strict input/resource values,
null/set/omitted behavior, the complete compatibility matrix, filter pagination
and cursor scope, versioned no-ops, in-progress locks and ordinary-claim races.
Browser behavior retains bilingual controls, keyboard access, narrow layouts,
request ownership and visible errors. These checks establish the platform
contract; native worker startup, recovery and historical execution-platform
claims still need their own source-bound runtime evidence.
