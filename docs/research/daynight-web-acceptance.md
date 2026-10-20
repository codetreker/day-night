# Web Acceptance Evidence

The [requirements](../spec/daynight-web.md) own W1–W12, the
[architecture](../design/daynight-web.md) owns mechanisms, and the
[task document](../design/daynight-web-tasks.md) records delivery status.
This report owns observed validation and its practical limits.

## Delivered source validation

[PR #52](https://github.com/codetreker/daynight/pull/52) merged as
`64b69a3ab864f99f6914b9217dbfbebde60345aa` at 2026-10-20 13:24:32 UTC after
approval of exact head `8b5002863bb342953fa9bb034a6f5bdc655e03cf` and all seven
required checks passed. [PR CI run 39428105688](https://github.com/codetreker/daynight/actions/runs/39428105688)
tested clean GitHub merge `e3e9a23c7cebd0879e7fa6a77f068192420fb449`:
`gitSha = githubSha`, `dirty: false`. Its tree
`4ce8c72fd2b29e2207adbab966e22bc4a655c40d` equals the approved head tree;
the merge parents are main `c19b064b094aae6634ca6d62e943a73d22008262` and that head.
[Mainline run 39430138740](https://github.com/codetreker/daynight/actions/runs/39430138740)
passed all seven checks on the actual merged commit, independently of the PR
merge-ref validation.

Hosted acceptance run `20261020131132-2980f501-ddd3-45b9-98ac-8b24966141f6`
passed all 12 native and eight production-gateway scenarios on the first attempt,
with no skips or retries. It passed all three graphs' five repetitions,
independent 1,001-node/0-edge and 1,000-node/5,001-edge complete 409 refusals,
full canonical-route/paint-piece geometry and phase checks, and the functional
keyboard, narrow-layout and failure/recovery flows. Native, dev-ci and aggregate
cleanup passed; the separate outer recovery passed and preserved the original
receipt. Full graph counts, modal inertness, tracing and the 3,000ms/300ms budgets
were retained.

The browser was bundled Chromium 156.0.8078.4 (revision 1248) on Linux x64,
Node 24.22.0, without an executable override. The native binary SHA-256 is
`03e9bf17bd0cef1ae1835d61aae00b46edac94fdf763c201935b30bbab16a037`;
the running production image is
`sha256:8d494c463ec62e4762bdbf24e6f839c253c75d37fce0531453c3ffbc4333598c`.
The archived [acceptance artifact](https://github.com/codetreker/daynight/actions/runs/39428105688/artifacts/12266069050)
contains raw reports, screenshots, performance, CDP traces, image and cleanup
receipts. The [coverage artifact](https://github.com/codetreker/daynight/actions/runs/39428105688/artifacts/12266848127)
contains raw V8 counters and the exact source manifest: 716/722 statements across
all 19 product files, strictly above 90%, with no product exclusions. The Go gate
passed 307 tests and nine checker cases with raw 1153/1155 statements; all 12
process scenarios, 19 child reaps, 12 schema removals and owned-session cleanup
passed.

| Dataset | Five opening times (ms) | Max layout/render (ms) | Max detail/zoom/pan (ms) |
|---|---|---|---|
| Chain, 1,000/999 | 484.7, 453.9, 455.1, 447.2, 436.0 | 234.1 / 248.9 | 55.5 / 13.3 / 39.0 |
| Merge, 1,000/5,000 | 1320.0, 1143.4, 1259.4, 1156.9, 1143.3 | 933.4 / 421.6 | 95.4 / 64.5 / 48.8 |
| Shared, 1,000/5,000 | 1454.2, 1493.4, 1506.8, 1469.9, 1385.3 | 861.1 / 721.4 | 190.0 / 50.9 / 41.4 |

Display rounding does not affect the raw gate; column maxima may come from
different repetitions. The five hosted shared traces confirm the preceding
close-frame raster maxima of 29.864/29.600/22.004/29.129/28.159ms and commit
waits no greater than 0.262ms. Whole-trace raster maxima stay at or below
32.139ms. This establishes reduced raster work in the actual hosted product,
not merely input scheduled after an unchanged long frame. Earlier failed hosted
revisions and dirty local receipts below remain distinct evidence.

### Direct-main production validation

[Mainline run 39430138740](https://github.com/codetreker/daynight/actions/runs/39430138740)
passed all six verification jobs and the aggregate on direct commit
`64b69a3ab864f99f6914b9217dbfbebde60345aa`, with `gitSha = githubSha`,
`dirty: false` and tree `4ce8c72fd2b29e2207adbab966e22bc4a655c40d` equal to the
approved PR head tree. Acceptance run
`20261020132552-8534b247-af52-4077-b48f-ef7f50f879a9` again passed all 12 native
and eight production-gateway scenarios on their first attempt, without skips,
retries, flaky results or unexpected failures. Both independent 409 limit
refusals and every geometry/phase check passed. The browser remained bundled
Chromium 156.0.8078.4 with `ci: true` and no executable override.

The native binary SHA-256 is
`9e7a84860b009e2586b852b485e5841430bbf00952a489de6f626be256b9b2cd`;
the running production image is
`sha256:2201d4edd2419e8f9ce4b24589b11062684a7dae7588f8e9c384a610b32f6047`.
The [main acceptance artifact](https://github.com/codetreker/daynight/actions/runs/39430138740/artifacts/12267622859)
contains all raw reports, 13 native and eight container PNG attachments,
performance/traces, exact running-image identity and cleanup receipts.
The [main coverage artifact](https://github.com/codetreker/daynight/actions/runs/39430138740/artifacts/12267962742)
again records 716/722 statements across all 19 current product files. The direct-
main Go gate records 1153/1155 statements and the complete 307-test/nine-checker
and process-resource result in the [server report](daynight-server-acceptance.md).

| Dataset | Max open (ms) | Max layout/render (ms) | Max detail/zoom/pan (ms) |
|---|---|---|---|
| Chain, 1,000/999 | 443.9 | 224.9 / 221.3 | 50.2 / 34.2 / 38.4 |
| Merge, 1,000/5,000 | 1114.5 | 810.0 / 312.2 | 85.6 / 58.7 / 51.0 |
| Shared, 1,000/5,000 | 1406.3 | 843.5 / 590.3 | 168.4 / 39.3 / 35.0 |

All fifteen observations satisfy the unchanged budgets. Native, production
container and overall cleanup passed; outer recovery separately passed with the
native process absent and recorded Docker resources removed, preserving the
original evidence. These results close W-T6 and the six-task dashboard delivery;
they do not change the separate project/task CLI acceptance status.

## Recorded local validation

The dashed-paint source passed build/typechecking, 311 functional tests and 36
Node tool tests with Node 24 and pnpm 10.34.5. The tool cases include the earlier
coverage/publication checks, browser-report/performance/process identity checks
and three Dagre differential regressions. The current complete production-browser
run below also passed; its local identity remains distinct from hosted CI. The raw V8 report contains
716 covered statements out of 722 across all 19 product TypeScript/TSX files
(about 99.17%), with 100% function coverage. The new dashes.ts helper is included. Exact integer comparison confirms coverage strictly above 90%.
The browser entry, request hooks, canvas and drawer are included; no product
filename exclusions supply that result.

Typechecking retains exact optional properties and checks dependency declarations.
The pinned XYFlow system patch changes only two declaration lines. Static tests
confirm custom-node data/literals and base assignment, and reject explicit
undefined source/target positions. Test-only DOM measurement shims support
React Flow component tests; actual geometry is verified separately in Chromium.

The shared build publishes validated real UI assets into the Go embed directory.
Publication tests cover index references, nonregular output, complete replacement,
rollback, failure propagation and the command entry. CLI 0.4.4 typechecking,
build and 1,284 tests with ten platform skips passed.

The W-T6 Go full gate passed 307 tests (108 top-level), nine checker cases and
raw 1153/1155 statements (99.8268%), with no product exclusions. Store, service,
server and webui remain at 100%. All 12 process scenarios passed, 19 children
were reaped, 12 schemas were removed, and owned sessions, the test container and
its named volume were cleared. The earlier W-T5 integration also passed its two
installed CLI suites and actual Bash 4.2/modern Bash/zsh completion acceptance;
those historical observations do not establish a new hosted current-head result.

The phase/trace diagnostic helper passed typechecking and five focused tests,
included in the complete functional suite. The complete dashed-paint local run below includes those phase/trace fields.
Earlier pre-diagnostic receipts retain their historical scope; the delivered
source also passed the clean hosted run above.

## Recorded dashed-paint local production result

Run `20261020125755-d98c8daa-5d70-45e3-bba5-786459394568` passed all 12 native
and eight production-gateway scenarios, every fixed graph's five repetitions,
independent node/edge limit refusals and full post-measurement paint-piece
geometry/phase checks. All 1,000 nodes/buttons, complete canonical routes and
native arrows remained present. Modal inertness, tracing and original thresholds
were retained. Original native/container/overall cleanup passed; actual outer
recovery passed separately and preserved the original result.

The local receipt records base `451b914290d64e550eb0ad9b0d3d725356c0ffcc`,
`dirty: true` and no GitHub SHA, with bundled Chromium 156.0.8078.4 (revision
1248, no override). Binary SHA-256 is
`7cc50449d12a68966bb8e5a7931a9ce6ce462a5b8ddf6ead12898cc35ebdedbb`; the running
production image is
`sha256:c669f3ce8e10df646a2ae3daffcff8039e0657352875611b81630b2ea1d49fc8`.
These identities establish the tested local build, not clean hosted delivery.

| Dataset | Five opening times (ms) | Max layout/render (ms) | Max detail/zoom/pan (ms) |
|---|---|---|---|
| Chain, 1,000/999 | 555.9, 527.9, 519.1, 506.1, 484.7 | 278.9 / 280.6 | 61.5 / 50.4 / 13.8 |
| Merge, 1,000/5,000 | 1359.6, 1300.8, 1303.3, 1266.4, 1279.0 | 969.5 / 386.6 | 106.8 / 25.7 / 20.4 |
| Shared, 1,000/5,000 | 1669.2, 1875.1, 1841.5, 1702.2, 1719.3 | 1093.8 / 796.3 | 213.6 / 60.7 / 60.9 |

Values are rounded only for display; raw gates use every unrounded observation.
Columns can have maxima from different repetitions. Cold navigation and network
readings remain separately recorded, not deducted from local feedback.

The five actual product shared traces independently identify the preceding
close frames: maximum raster tasks were 20.348/19.979/20.538/20.094/20.214ms and
close-to-zoom commit waits were at most 0.289ms. Whole-trace raster maxima were
below 37.8ms, so this observation does not depend on simply scheduling zoom after
an unchanged second-long raster. The separate hosted run above verifies the
delivered clean source.

### Durable raster and visual proof

The [dashed-paint evidence](evidence/daynight-web-dashed-paint.json) preserves the
exact pixel report, captured graph/resource and investigation-script hashes,
whole-trace and explicitly scoped close-frame factor statistics, and actual
product trace/source hashes. It distinguishes temporary browser injection from
the final product helper and separates CPU-sampled replay from the formal
acceptance trace configuration. No private paths, connection strings, task bodies
or credentials are stored.

The controlled native-vs-local-coordinate prototype comparison used the same
1328×445 canvas clip. Of 590,960 pixels, 764 changed (0.1293%); 751 had maximum
RGB delta one, thirteen exceeded one, three exceeded four, and the maximum was
seven on a 0–255 scale. Alpha was unchanged; mean absolute RGB channel delta was
0.0006216. Differences were confined to thin route antialiasing. This is a
quantified prototype comparison, not byte-identical output or a replacement for
the final product's independent complete arc/phase/CTM checks.

## Recorded static SVG local result before dashed-paint decomposition

Run `20261020113046-15ee88b2-047d-4ec7-b9be-b15003254463` passed all 12 native
and eight production-container scenarios with the static SVG edge renderer.
It used Linux x64, Node 24.19.0, pnpm 10.34.5, Playwright 1.64.1 and bundled
Chromium 156.0.8078.4 (no executable override), with Go 1.27.2/PostgreSQL 18.6.

All three graphs completed five measured expansions. The native target also
passed independent 1,001-node/0-edge and 1,000-node/5,001-edge 409 refusals without
partial graph/statistics. Actual browser geometry checks passed SVG CTM and exact
endpoint/node alignment after zoom, pan and root changes. All functional,
keyboard, narrow-layout and database-failure/recovery scenarios passed in both
targets. Original `result` and `cleanup` were `passed`; outer recovery also
passed separately and preserved the original evidence.

The receipt identifies base `741f2e65593df7b2b95908c350508b59e291eaf6` with
`dirty: true` and no GitHub SHA. It is a local development result, not clean
current-source hosted evidence. Native binary SHA-256 is
`4f33b878e36933b0fbd4a646414be34168710655a6a05ea322d50243e6c26ec2`. Dev-ci run
`20261020113351-1016268-01884` tested built/running image
`sha256:5159f1bbe74cb1c295e28d13a7863876300eaf508a6e8445d1a4c75b4dd40f3e`.

### Static SVG capacity measurements

Durations are milliseconds, rounded only for display; raw values enforce every
gate. Maxima are across five repetitions of the same graph and can come from
different repetitions. Cold navigation and graph/detail network time are separate
observations, not a replacement for collapsed-root opening or local feedback.

| Dataset | Nodes/edges | Five collapsed-root open times | Max layout | Max render | Cold navigation | Graph network |
|---|---|---|---|---|---|---|
| Chain | 1,000/999 | 491.3, 467.3, 497.2, 470.5, 482.1 | 238.9 | 260.2 | 1508.4 | 13.7 |
| Merge | 1,000/5,000 | 1342.6, 1339.3, 1346.1, 1323.9, 1290.9 | 999.1 | 388.7 | 2957.3 | 29.1 |
| Shared roots | 1,000/5,000 | 1420.1, 1535.9, 1644.3, 1528.2, 1609.3 | 1134.9 | 614.9 | 3445.8 | 24.7 |

| Dataset | Max detail local feedback | Max detail network | Max zoom | Max pan |
|---|---|---|---|---|
| Chain | 55.3 | 3.638 | 16.5 | 38.7 |
| Merge | 95.0 | 4.185 | 56.2 | 17.8 |
| Shared roots | 127.0 | 4.219 | 25.9 | 35.5 |

Every opening stayed below 3,000ms and every local detail/zoom/pan feedback stayed
below 300ms. These results cover the fixed topology matrix and environment;
current-source hosted acceptance and arbitrary-DAG timing remain separate claims.

## Hosted zoom failures and current investigation

The later [static SVG hosted run](https://github.com/codetreker/daynight/actions/runs/39417274711)
tested clean merge/source revision `ddfae9677312e488baeb62ce12a9a23e595faa84`, equal
to its recorded GitHub SHA. Its tree `e41cedd9d1b40f183f966e56eb2737281aae43cc`
matched PR head `5c5f523efe8e9dc49e0545bb6ddb5a509dd97fd8`. The raw web gate passed
653/659 statements across the complete 18-file inventory. Chromium was the pinned
156.0.8078.4 with CI identity and no executable override.

The unchanged 300ms zoom-feedback requirement failed: the shared graph's first
zoom measured `1056.3000000000466ms` on the trusted browser clock. That repetition
recorded opening 1018.0ms, layout 719.0ms, rendering 297.2ms, local detail 91.5ms,
detail network 2.21ms and pan 23.5ms. These measurements locate the failed gate;
they do not establish its cause. Chain and merge each completed five passing
repetitions. Native execution had ten passed scenarios (eight functional plus
chain/merge), one failed and one serial limit scenario not run; container
acceptance did not start.

The original evidence result is failed, while native/overall cleanup passed;
the outer recovery step also passed. The other five verification jobs passed;
the required aggregate failed with the web job, preventing acceptance/delivery. The run retains
`daynight-web-acceptance` artifact `12261339556` and coverage artifact
`12261704529`. Its acceptance run ID is
`20261020114702-8e59be9c-6bc1-4971-8084-fe15ec1a2c64`, with raw `evidence.json`,
`native/performance.json`, browser identity, Playwright report and traces; coverage
retains `coverage-final.json` and its matching inventory/summary.

The subsequent [merge-source run](https://github.com/codetreker/daynight/actions/runs/39418729109)
also failed shared repetition one's zoom gate at 634.7ms. Its clean tested merge
SHA was `de5e808dd6c52baaa458dbcee3733e31192c89a5`, equal to the recorded GitHub
SHA with a clean checkout. Tree `95641e697efcc58835cebfd0a8c0c20a73899ac0` matched
head `d1dd368f5b7ad72ade6e142e916d770b6db2071f`. Opening was 952.7ms, layout
660.3ms, rendering 290.5ms, detail 91.5ms, detail network 2.031ms and pan 75.9ms. Cleanup and outer
recovery passed with pinned Chromium 156.0.8078.4; the other five verification
jobs passed and the aggregate failed with web. Acceptance/coverage artifact IDs are `12262707232` and
`12263446508`. This additional failed source result does not resolve the earlier
failure or establish hosted performance success.

### Diagnostic hosted raster and commit evidence

The [diagnostic-source run](https://github.com/codetreker/daynight/actions/runs/39420010135)
tested clean merge `9bdaafe2adb71a4fa6d17417ddd68473d8b36dff`, equal to its recorded
GitHub SHA. Tree `92dd14465ce6ec09edc6101c0e80f54030862750` matched head
`844d151033d46d858217bcd74309150b01318550`. Coverage remained 653/659 across all
18 product files; pinned Chromium 156.0.8078.4 used no override. The shared graph's
first zoom measured 1238.3ms. Its input queue, condition, first-frame and
second-frame waits were 12.3/2.7/7.3/1215.9ms. Cleanup, native cleanup and recovery
passed. Acceptance/coverage artifact IDs are `12262478610` and `12263102944`;
acceptance run ID is `20261020120947-f986a342-c392-4852-86c3-ac4f0096c985`.

The inspected Chromium trace measured the zoom click handler at 3.308ms. The next
main frame lasted 1147.19ms, including 1138.619ms in
`WaitForCommitCompletion`; document and SVG paint recording were 3.383ms and
1.426ms. The preceding drawer-close frame 43 had a roughly 77ms handler, including
about 63ms style recalculation across 15,554 elements. Two workers processed four
raster tasks lasting approximately 1079/1176/831/835ms; that work began about
867ms before the zoom input. The trace therefore locates the large observed delay
in completion of earlier frame raster/commit work, rather than in the prompt
zoom JavaScript handler.

A [later diagnostic run](https://github.com/codetreker/daynight/actions/runs/39421038402)
tested clean merge `3344fa99755e0132f5952f4aa7f94dc7d229d5dd`, equal to its recorded
GitHub SHA. Tree `d2470e44a08db79fdf5b29d38633f194cef118a7` matched head
`ddad203f4761f983d0c8fc8a7a03cb3906167042`. Coverage was again 653/659 across
18 files. Its shared repetition-one opening/layout/render/detail/detail-network/
zoom/pan times were 764.0/545.0/216.4/95.6/2.475/706.7/13.0ms. Zoom phases were
3.3/2.5/8.2/692.7ms. The click handler was 3.101ms; the next main frame lasted
692.223ms, including 686.7ms commit wait. Native had ten passed scenarios, shared
failed, limits were not run and container acceptance did not start. The other
five verification jobs passed; web and aggregate failed. Cleanup/native cleanup
and recovery passed with the same pinned browser. Acceptance/coverage artifact
IDs are `12263935614` and `12263369970`, and acceptance run ID is
`20261020121741-6b16ee19-3939-4cc5-ad91-025cc97edeb6`.

These traces establish input/condition/frame ordering and prior-frame
backpressure. Exact replay then isolated long oblique native dash generation:
hiding SVG paint or making bodies solid removed the expensive raster; local
horizontal pieces with native short joins removed it while preserving all graph
and visual semantics. The
[drawing decision](../../.agents/notes/implemented/bug-fix/2026-10-20-long-dashed-dependency-paint.md)
pins the SVG2 phase rule and Chromium/Skia culling mechanism. Marker instancing
was not the demonstrated cause. Local marker-removal and paint-containment trials still retained about
1.1 seconds of preceding drawer-close raster work. Their fast zoom occurred when
input arrived after that work had finished, so they do not demonstrate a causal
reduction. Marker flattening was not adopted. The actual local-coordinate body fix now has
its own complete product result above. Modal inertness, complete graph/arrow/dash
semantics and all original end-to-end gates remain required.

The valid local static SVG matrix above remains local evidence. It does not
override this hosted result. Pinned-engine evidence and controlled replay identify long native dashed-body
paint as the expensive primitive. The implemented decomposition passed complete
local and clean hosted product acceptance. The failed revisions remain failed;
no infrastructure cause is claimed for those rendering failures.

### Diagnostic evidence format

New dataset `feedbackDiagnostics` entries retain interaction kind/repetition,
trusted input `start`, `capturedAt`, first `conditionAt`, `frame1At`, `frame2At`,
final `end`, status/error and `phases`. `inputQueueMs`, `conditionMs`,
`firstFrameMs` and `secondFrameMs` are adjacent milestone differences; unavailable
milestones stay null. First-condition/frame observations are separate from the
final accepted end, so these phases are not a replacement partition or a reason
to deduct time from the measured budget.

Per-repetition `*-chromium-trace.json` attachments record CDP timeline, frame,
GC and User Timing events without CPU sampling or CDP screenshot capture. Scenario
PNGs remain separate evidence. Diagnostic writes, trace completion and resource
closure propagate errors while preserving measurement failures. All total
measurements, graph/node/edge readiness, five repetitions and original thresholds
remain unchanged. These diagnostics establish the recorded raster/commit cause
and verify the delivered decomposition without subtracting prior-frame backlog.

### Earlier reactive-edge hosted failure

[PR #52](https://github.com/codetreker/daynight/pull/52)'s
[failed web job](https://github.com/codetreker/daynight/actions/runs/39412445956/job/118593266570)
tested clean merge revision `ea3245ff2ab4687c9d8021c84be1918bff276735`, whose tree
matched PR head `741f2e65593df7b2b95908c350508b59e291eaf6`. Coverage was 660/666
and source/cleanup checks passed. Chain and merge completed all five repetitions;
the shared 1,000-node/5,000-edge graph's second zoom measurement was 452.7ms on the
trusted browser clock, exceeding the unchanged 300ms requirement. Limit and
container acceptance were not completed by that failed run.

The original failed run, artifacts and traces remain its evidence; no unchanged
rerun is used to seek a different result. Coverage success and earlier local
timings do not replace the failure. New acceptance must test the changed rendering
source.

The current renderer retains React Flow for nodes, keyboard behavior, viewport
and controls, while one memoized SVG in the public ViewportPortal owns every
immutable Dagre edge path. It preserves all nodes/edges, identity, arrows,
external-prerequisite dashes, accessible semantics and the shared viewport
transform. Per-edge wrapper/store/endpoint-admission work is removed. Dagre's
ranking, pinned patch and exact route geometry remain unchanged.

Current-source functional/geometry checks must verify portal alignment across
actual pan, zoom and fit, every visible Dagre point and edge count, and node
interaction. All three fixed graphs must still complete five openings under
3,000ms and every detail/zoom/pan measurement under 300ms. The complete local
local and hosted dashed-paint runs above pass those gates. The earlier static
SVG hosted failures remain evidence for the native-dash revisions they tested.
The earlier passing receipts below are historical pre-static-SVG observations.

## Historical pre-static-SVG production-browser result

Before the static SVG edge layer, run
`20261020103753-bbbed443-8f6c-402c-be61-46b91fe54827` passed both targets,
all fixed capacity measurements and cleanup. It ran on Linux x64 with Node
24.19.0, pnpm 10.34.5, Playwright 1.64.1, its bundled Chromium 156.0.8078.4
(revision 1248, no executable override), Go 1.27.2 and PostgreSQL 18.6.

| Evidence | Observed result |
|---|---|
| Native production target | 12 scenarios passed; eight functional plus four capacity/limit scenarios |
| Container production target | All eight functional scenarios passed through the dev-ci stream gateway |
| Browser geometry | The earlier renderer's seven-node real-CSS regression passed card/port bounds and exact Dagre edge-path assertions |
| Capacity | Three fixed graphs, five expansions each; all original 3,000ms/300ms budgets passed |
| Independent node limit | 1,001 nodes/0 edges returned 409 with exact limits and no partial graph/statistics |
| Independent edge limit | 1,000 nodes/5,001 edges returned 409 with exact limits and no partial graph/statistics |
| Original result/cleanup | Both `passed`, including native database/process, Chromium/profile and dev-ci resources |
| Outer recovery | `passed`, retained the original successful evidence and separately recorded absent native process and recovered dev-ci cleanup |

The receipt identifies Git base
`9eb4293627eaf94448c4fda7bb0e6f4e99b2b41c` with `dirty: true` and no GitHub SHA.
It describes the tested development worktree, not a committed clean delivery
revision. Native binary SHA-256 is
`0d749afd281b81014114fb96f2806e117e6b162557b66b9b2f9e6b53311d83d4`.
The dev-ci run is `20261020104138-878457-01853`, with built/running image
`sha256:197f4a783428496f623239935b3eaf18095156b3057ce594858c58b7116f7f1d`.

### Fixed capacity measurements

Durations below are milliseconds, rounded only for display. Each gate compared
unrounded raw values. Every maximum is over the same graph's five repetitions;
maxima in different columns need not come from the same repetition.

| Dataset | Nodes/edges | Five collapsed-root open times | Max layout | Max render | Cold navigation | Graph network |
|---|---|---|---|---|---|---|
| Chain | 1,000/999 | 729.3, 680.3, 666.9, 677.6, 714.7 | 244.5 | 484.0 | 1959.7 | 14.2 |
| Merge | 1,000/5,000 | 1978.0, 2077.9, 2054.0, 1954.5, 1863.6 | 1014.6 | 1097.7 | 4045.9 | 30.0 |
| Shared roots | 1,000/5,000 | 2145.4, 2286.2, 2253.0, 2173.7, 2330.6 | 1102.1 | 1277.2 | 4566.3 | 23.0 |

| Dataset | Max detail local feedback | Max detail network | Max zoom | Max pan |
|---|---|---|---|---|
| Chain | 89.5 | 3.820 | 52.1 | 38.5 |
| Merge | 193.0 | 4.682 | 74.3 | 72.1 |
| Shared roots | 231.9 | 4.454 | 81.2 | 78.7 |

Cold navigation includes page/asset loading and the first graph request/render;
it is recorded separately and is not one of the five collapsed-root openings.
The declared budgets apply to every measured opening and each local interaction,
not an average or a network-inclusive navigation promise. The raw performance
receipt retains all 15 full measurement records, graph/detail network values,
layout/render times and independent limit results.

These are local fixed-topology observations under the stated browser/environment.
API-generated UUIDs may change layout tie ordering between isomorphic runs.
Normalized rank spans can also change layout cost; this matrix does not establish
the same latency for arbitrary DAGs. The delivered-source hosted result above
supplies separate source/image and performance receipts. The real-Docker fault matrix
below supplies startup/test-failure, cancellation and cleanup-failure evidence
beyond the normal browser run and controlled lifecycle fixtures.

## Production acceptance command and receipts

After the [browser prerequisites](../../packages/daynight-web/README.md#production-browser-acceptance)
are installed, run from the repository root:

```bash
pnpm web:acceptance
```

The harness builds embedded production assets and a new Go executable, owns an
isolated PostgreSQL 18.6 instance and native listener, then runs the functional
suite again through the actual dev-ci production-image gateway. Native acceptance
requires 12 stable scenarios; container acceptance requires the same eight
functional scenarios. Capacity runs only against the native production process.
Fixtures, including capacity datasets, use the real project/task write APIs.
Page requests remain GET/HEAD. Both the recorded dashed-paint local run and
the delivered-source clean hosted run above pass this command.

| Requirement | Validated production evidence |
|---|---|
| W1 | `project-list`: more than 50 projects, cursor requests, unique cards and navigation to the later-page project |
| W2 | `project-graph` and `deep-links`: project entry, direct HTML reload and browser history |
| W3–W4 | `project-graph`, `refresh-staleness` and `failure-recovery`: exact statistics, distinct root progress, consistent full refresh and retained old snapshot after failure |
| W5–W7 | `project-graph`, `keyboard-focus` and capacity cases: complete source-root projections, shared/external prerequisites, state markers and viewport/node actions |
| W8 | `detail-navigation` and `refresh-staleness`: current content, relation navigation and readiness differences without revising a dependent task |
| W9 | `failure-recovery`, `deep-links` and `capacity-limits`: actual owned-database failure/restoration, correlated errors, empty/not-found states, delayed request replacement and full size refusal |
| W10 | Both native and container functional targets, exact image identity and dev-ci cleanup receipt |
| W11 | Strict raw Go/V8 reports, validated complete browser/performance receipts and the required CI aggregate |
| W12 | `keyboard-focus` and `narrow-layout`: actual modal focus lifecycle, keyboard node activation and 320px page geometry |

The report parser requires first-attempt success, a unique complete stable-scenario
set, valid owned PNG screenshots, consistent totals and no skipped/flaky/global
errors. CI checks a clean source revision equal to GITHUB_SHA and requires the
Linux Chromium version bundled by Playwright 1.64.1; a local executable override
is recorded and cannot satisfy that identity. The complete run must also confirm
native and dev-ci resource cleanup, with original errors preserved.

Each acceptance run incrementally writes
`packages/daynight-web/.tmp/acceptance/<run-id>/evidence.json` and updates the
package's `.tmp/acceptance/evidence.json` latest receipt. Target directories keep
raw `playwright.json`, `browser.json`, screenshots and target state; native
performance remains in `native/performance.json`. The aggregate records source,
binary SHA-256, PostgreSQL/image/browser identities, target results, production
container receipt and cleanup outcome. CI archives the acceptance tree with
`.tmp/dev-ci/` as `daynight-web-acceptance`; the separate `daynight-web-coverage`
artifact retains `coverage-final.json`, source manifest and exact counters.

The datasets have fixed topology; task UUIDs are generated by the API, so layout
ties can differ across isomorphic runs. All five repetitions within one run use
the same exact IDs and graph. The fixed chain contains 1,000 nodes and 999 edges. Merge and shared-root datasets
each contain exactly 1,000 nodes and 5,000 edges. Every dataset requires five
collapsed-root expansions with full node/edge DOM counts and a painted, readable
source root. Timing begins at a trusted browser input event timestamp and ends
after the browser condition and two animation frames; automation setup and trace
snapshots are outside the interval, while browser event queue time remains inside. Every opening must be at most 3,000ms; task-detail local feedback,
zoom and pan must each be at most 300ms. Graph and detail network times are
recorded separately. Each expansion records `layoutMs` for projection/Dagre
and `renderMs` from layout completion through complete DOM/readable root and two
animation frames; `openMs` remains the full budget. The bounded latest
`daynight:task-layout` measure identifies only the selected root. Independent node-only and edge-only over-limit cases require
409 counts of 1,001/0 and 1,000/5,001, with neither partial graph nor statistics.
Missing, malformed or over-budget measurements fail the gate.

### Cleanup evidence and recovery interpretation

The required outer cleanup command is
`node packages/daynight-web/scripts/acceptance.mts --cleanup [run-id]`. It uses the
latest receipt by default and leaves resources unchanged when no receipt exists.
The original runner, callback/Playwright processes and their owned groups must
already be stopped. Linux
PID/executable/start-time evidence, native binary hash and exact Docker ownership
limit recovery to the recorded run. Chromium group/profile receipts and markers
are checked separately; unidentified startup resources or uncertain orphan
ownership fail rather than being removed by a broad process/profile sweep.

Recovery writes separate `recovery.json` files and preserves the original result.
A successful local hard-SIGKILL probe confirmed that recorded Chromium processes
and their owned project-local profile were removed after the Playwright CLI was
killed. Recovery of a failed exploratory acceptance run also passed while keeping
its failed original receipt. The complete successful local and hosted runs above
additionally confirmed cleanup and outer recovery. Local probes do not establish
clean hosted source identity; failed exploratory results stay failed and are not
reused as passing capacity receipts.

## Recorded real Docker deployment-fault matrix

This lifecycle matrix used the earlier UI revision. Deployment lifecycle code is
unchanged by the static SVG update; the matrix does not claim the new UI image
identity. The local manual probe `fault-1792493712152-d0ae9b41` passed all four fault cases
and final cleanup using the unchanged `deployment/dev-ci/run.sh` against a real
Docker daemon. A separate baseline B stack remained alive throughout. Its UI and
API returned 200 and the same project sentinel survived after every case and
while the cleanup-failure volume was busy. These operations used only uniquely
owned test projects; the normal localhost stack was not touched.

| Case | Real fault and expected observation | Cleanup observation |
|---|---|---|
| Startup mid-failure | Stop the verified owned PostgreSQL during startup; runner exits 1 and never calls the callback | Run resources removed; B remains healthy |
| Callback failure | Callback exits 23 after starting a background heartbeat descendant; runner preserves 23 exactly | Descendant/heartbeat stops and resources are removed; B remains healthy |
| Signal cancellation | Send SIGTERM to the verified runner; result is 143/cancelled | Callback group and resources are gone; B remains healthy |
| Cleanup failure/recovery | A verified read-only holder keeps the run's named volume busy; runner exits 1 and reports cleanup failed | Remove only the verified holder, then recover by recorded run ID; recovery passes and the original failed manifest stays unchanged |

The tested identities are retained independently for each built/running image:

| Project role | Run ID | Image ID |
|---|---|---|
| Baseline B | `20261020105512-919474-25541` | `sha256:9a8c40653c0559dce28177bc24e8fae627ad832af8d1208e6c82bc83678a629a` |
| Startup fault | `20261020105525-920602-23589` | `sha256:f34d66c07b525d35652e7b64bc48c1fb590c5868790644165675cbcb55c3d28d` |
| Callback fault | `20261020105527-921649-04664` | `sha256:ddb882115819241b4479b0a3d05eacb965614626ac1776431584b7d97a149da1` |
| Cancellation | `20261020105541-923446-26381` | `sha256:7607312d698cd6a8a93f6975ec6f88847e20877ca7f1140d78f3cfff8af3bdc6` |
| Cleanup fault | `20261020105554-925330-18788` | `sha256:7edcd8b1a115a5d02dbf0164d1c33c4b08b5d53d57024241662cee301581d66b` |

The source receipt records base
`9eb4293627eaf94448c4fda7bb0e6f4e99b2b41c`, `dirty: true`, tracked-diff SHA-256
`28516c9a74796961cba4c486812e4bf480785b4cb7d1e9954729e711205cd627`, Dagre tool
SHA-256 `2fd4316cd30b6bd023297cf9984c690b8cb1e614fc76a7e0f85c13658e1ce713`
and runtime-patch SHA-256
`142fd75deec2b03c9d6839bcdb87804ff902b25f9af621d6f8140b52c765ef7b`. These
fingerprints identify local evidence; they do not substitute for clean CI source.

The earlier probe `fault-1792493614390-6bf49cd9` retained passing product-case
observations but a failed auxiliary cleanup receipt: its case-sensitive
post-cleanup classifier misread Docker's lowercase missing-object response.
That original report was preserved. After correcting only the temporary probe,
the second complete matrix passed. An independent final audit checked both
rounds: all ten run resource sets had zero containers, volumes, networks or image
tags, both holder sets were empty, and all ten recorded process sets had no live
members. The product runner was unchanged between those two probes.

The committed [lifecycle evidence](evidence/daynight-web-lifecycle.json) preserves
the original first report, second passed report and independent final audit
unchanged inside a versioned provenance wrapper. It retains the failed auxiliary
classification, per-case source/image identities and all ten resource/process
observations after task-local files are removed. Historical loopback origins,
run IDs and relative source paths are evidence, not operator configuration. The
artifact contains no user-specific absolute paths, task bodies, SQL, database
connection strings or credentials.

This is manual dirty-worktree acceptance, not clean CI evidence, a new CI harness
or a claim that CI repeats the fault matrix. CI continues to run the 12 controlled
lifecycle fixtures and complete real production-browser suite, archiving its own
clean tested-source/image and performance receipts. Hosted delivery remains
required.

## Historical real API browser check

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

## Historical capacity probe

A separate owned PostgreSQL fixture contained a valid 1,000-node chain seeded
directly for a rendering probe. The real graph API and production browser page
rendered 1,000 nodes and 999 edges in about 1.24 seconds from navigation in one
local run, with the selected root visible at the initial readable zoom and no
page exception. Direct SQL seeding here does not validate task creation policy.

This is a single local geometry/timing observation, not the required five-run
Linux CI performance verdict, not a 5,000-edge capacity result, and not a
guarantee across machines or graph shapes. W-T6 owns those fixed-dataset gates.

## W-T5 embedded HTTP and deployment checks

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
artifacts. The complete W-T6 local production run above extends this scope with
browser and performance results. The delivered PR validation above supplies
matching clean hosted source/image identities and archived browser, cleanup and
performance receipts.

## Delivery evidence

Local worktree checks do not establish a clean hosted source identity. The
required web job publishes raw `coverage-final.json` and `summary.json`; its
source manifest and exact counters must be checked against the corresponding run.
Go retains its independent raw-profile gate and native CLI validation remains
required by the aggregate check.

Embedded Go UI, localhost integration, the isolated dev-ci environment and the
production-browser harness are delivered in PR #52. The approved source passed
all six verification jobs and the required aggregate. The direct-main workflow
also passed every required check on the merged commit. W-T1–W-T6 are complete
in the task document.

Earlier hosted rendering failures, dirty local production/capacity receipts and
the separate real-Docker deployment-fault matrix retain their actual source and
scope. W-T4 preview and W-T5 HTTP smoke evidence remain historical observations;
they are not substitutes for the delivered-source full hosted result. The
required aggregate retains every native CLI platform, dedicated Linux shell
completion, Go and web. Fixed-topology success does not establish arbitrary-DAG
latency or the separate project/task CLI's remaining acceptance.
