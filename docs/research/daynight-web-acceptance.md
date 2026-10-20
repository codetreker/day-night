# Web Acceptance Evidence

The [requirements](../spec/daynight-web.md) own W1–W12, the
[architecture](../design/daynight-web.md) owns mechanisms, and the
[task document](../design/daynight-web-tasks.md) records delivery status.
This report owns observed validation and its practical limits.

## Local validation

W-T5 passed package typechecking, production build, 293 functional tests and 24
Node tool tests (13 coverage-checker and 11 asset-publication filesystem cases)
with Node 24 and pnpm 10.34.5. The raw V8 report contains
648 covered statements out of 654 across all 18 product TypeScript/TSX files
(about 99.08%). Exact integer comparison confirms coverage strictly above 90%.
The browser entry, request hooks, canvas and drawer are included; no product
filename exclusions supply that result.

Typechecking retains exact optional properties and checks dependency declarations.
The pinned XYFlow system patch changes only two declaration lines. Static tests
confirm custom-node data/literals and base assignment, and reject explicit
undefined source/target positions. Test-only DOM measurement shims support
React Flow component tests; actual geometry is verified separately in Chromium.

The shared build publishes validated real UI assets into the Go embed directory.
Publication tests cover index references, nonregular output, complete replacement,
rollback, failure propagation and the command entry. The Go full gate passed
307 tests (108 top-level), nine checker cases and raw 1153/1155 statements
(about 99.83%). Its product exclusions remain empty. Existing CLI typechecking,
build, 965 tests with ten platform skips, two installed acceptance suites and
actual Bash 4.2/modern Bash/zsh completion acceptance passed against the integrated
source. These are local worktree observations, not hosted current-head receipts.

## Real API browser check

The W-T4 local production bundle was served by Vite preview with an API proxy to an
actual built Go service and isolated PostgreSQL 18.6. The service used an owned
ephemeral loopback port and named test volume. Projects and the workflow tasks
were created through existing HTTP APIs. Chromium 151.0.7922.34 verified:

- Project list → project page, six exact statistics and root-main progress.
- Left-to-right node positions, arrow paths, shared descendants and explicit
  external prerequisites, with only one root expanded.
- Mouse, Enter and Space node activation; relation navigation in the drawer.
- Portal/background inertness, dynamic Tab cycling, Escape and focus restoration.
- An API prerequisite completion that changed a dependent task's readiness
  without changing its own timestamp or version. Live detail showed staleness;
  manual graph refresh updated counts and dependencies together.
- Zoom, fit, deep-link reload, empty projects and 320/390/768px page geometry.
- A controlled interrupted refresh that retained the earlier snapshot and
  recovered on retry. This interruption was injected by the browser harness;
  it is not evidence of a database outage test.

No page exceptions or browser-originated write requests occurred. The
[project screenshot](assets/daynight-web-project.png) and
[detail screenshot](assets/daynight-web-detail.png) use generated test data.

## Capacity probe

A separate owned PostgreSQL fixture contained a valid 1,000-node chain seeded
directly for a rendering probe. The real graph API and production browser page
rendered 1,000 nodes and 999 edges in about 1.24 seconds from navigation in one
local run, with the selected root visible at the initial readable zoom and no
page exception. Direct SQL seeding here does not validate task creation policy.

This is a single local geometry/timing observation, not the required five-run
Linux CI performance verdict, not a 5,000-edge capacity result, and not a
guarantee across machines or graph shapes. W-T6 owns those fixed-dataset gates.

## Embedded HTTP and deployment checks

W-T5 built the shared production Dockerfile from repository sources without host
`node_modules` or prebuilt assets. The Node 24/pnpm 10.34.5 stage consumes the
locked declaration patch, the Go 1.27.2 stage embeds real assets, and the final
nonroot runtime contains only the executable. The localhost and dev-ci effective
Compose configurations were compared for build inputs, stream forwarding,
shared network namespace, database privacy and persistent storage. The normal
localhost stack was neither started nor modified by these tests.

The actual dev-ci HTTP smoke was run again after integration with the current
mainline. It verified root HTML, hashed assets/cache/HEAD, project deep-link,
API and complete task graph, built/running image identity, and data retention
after recreating all three services. The run receipt reported passed cleanup.
Two concurrent real dev-ci runs used distinct loopback ports, database volumes
and test data. Cleanup of one left the second healthy with its own data; both
finally confirmed cleanup. These observations validate the Docker production
path and isolation but do not exercise every browser interaction.

Twelve Bash cases with controlled Docker commands passed success, invalid
identities, build/partial-startup failure, wrong image identity, callback failure,
cleanup failure, recovery, cancellation and remaining callback descendants. The
runner owns the process group after its leader exits. Recovery preserves the
original manifest and records a separate result, and requires the original
runner/callback group to be stopped first. Controlled orchestration cases do not
prove the corresponding real Docker failure paths.

Local run manifests, image/port/resource identities and concurrent-isolation
receipts are temporary evidence under `.tmp/`; they are not stable source or CI
artifacts. W-T6 must produce and archive matching clean source/image identities,
real-browser results, actual failure/cleanup results and performance measurements.

## Required delivery evidence

Local worktree checks do not establish a clean hosted source identity. The
required web job publishes raw `coverage-final.json` and `summary.json`; its
source manifest and exact counters must be checked against the corresponding run.
Go retains its independent raw-profile gate and native CLI validation remains
required by the aggregate check.

Embedded Go UI, localhost integration and the isolated dev-ci environment are
implemented. W-T6 must run the actual production binary and container
gateway with PostgreSQL, collect clean source/image identity, verify W1–W12,
exercise real failure and cleanup paths, and record each required performance
measurement. The W-T4 Vite preview/proxy observations and W-T5 HTTP smoke results
above do not claim that complete browser/performance verdict.
