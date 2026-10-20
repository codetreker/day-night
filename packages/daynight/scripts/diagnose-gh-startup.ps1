param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('baseline', 'utc', 'files')]
    [string] $Experiment,
    [switch] $TraceInitialization
)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$directory = Join-Path $repository '.tmp/gh-startup'
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$samplesPath = Join-Path $directory 'process-samples.jsonl'
$stdoutPath = Join-Path $directory 'collector.stdout.log'
$stderrPath = Join-Path $directory 'collector.stderr.log'
$ghCommands = @(Get-Command gh.exe -CommandType Application -ErrorAction Stop)
$nodeCommands = @(Get-Command node.exe -CommandType Application -ErrorAction Stop)
$ghExecutable = $ghCommands[0].Source
$nodeExecutable = $nodeCommands[0].Source
$ghFile = Get-Item -LiteralPath $ghExecutable
$cdbPath = 'C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe'
[ordered]@{ experiment = $Experiment } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'experiment.json') -Encoding utf8
$preloadPath = Join-Path $directory 'capture-gh-result.cjs'
@'
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const original = childProcess.spawnSync;
const directory = path.resolve(".tmp/gh-startup");
const { experiment } = JSON.parse(fs.readFileSync(path.join(directory, "experiment.json"), "utf8").replace(/^\uFEFF/, ""));

// Preserve the native result before the collector limits diagnostic output to 16 KiB.
childProcess.spawnSync = function (...args) {
  if (!["gh", "gh.exe"].includes(path.basename(String(args[0])).toLowerCase())) {
    return Reflect.apply(original, this, args);
  }
  let startedAt;
  let nativeElapsedMs;
  const runNative = (nativeArgs) => {
    startedAt = new Date().toISOString();
    const started = performance.now();
    const nativeResult = Reflect.apply(original, this, nativeArgs);
    nativeElapsedMs = performance.now() - started;
    return nativeResult;
  };
  const nativeStdout = path.join(directory, "gh.native.stdout.log");
  const nativeStderr = path.join(directory, "gh.native.stderr.log");
  let result;
  let outputLimitError;
  let outputBytes;
  if (experiment === "files") {
    const stdoutFd = fs.openSync(nativeStdout, "w");
    const stderrFd = fs.openSync(nativeStderr, "w");
    try {
      // This experiment isolates Windows pipe handling while retaining the native deadline.
      result = runNative([args[0], args[1], {
        ...args[2], stdio: ["ignore", stdoutFd, stderrFd],
      }]);
    } finally {
      fs.closeSync(stdoutFd);
      fs.closeSync(stderrFd);
    }
    const stdoutBytes = fs.statSync(nativeStdout).size;
    const stderrBytes = fs.statSync(nativeStderr).size;
    outputBytes = { stdout: stdoutBytes, stderr: stderrBytes };
    // Regular files need an explicit output check; this is diagnostic-only transport.
    if (stdoutBytes + stderrBytes > args[2].maxBuffer) {
      outputLimitError = new Error(`gh output exceeded maxBuffer=${args[2].maxBuffer}: stdout=${stdoutBytes}, stderr=${stderrBytes}.`);
      outputLimitError.code = "ENOBUFS";
    } else {
      result.stdout = fs.readFileSync(nativeStdout, args[2].encoding);
      result.stderr = fs.readFileSync(nativeStderr, args[2].encoding);
      result.output[1] = result.stdout;
      result.output[2] = result.stderr;
    }
  } else {
    result = runNative(args);
  }
  fs.writeFileSync(path.join(directory, "gh.stdout.log"), result.stdout ?? "");
  fs.writeFileSync(path.join(directory, "gh.stderr.log"), result.stderr ?? "");
  fs.writeFileSync(path.join(directory, "gh-result.json"), `${JSON.stringify({
    startedAt,
    capturedAt: new Date().toISOString(),
    experiment,
    nativeElapsedMs,
    parentProcessId: process.pid,
    parentExecutable: process.execPath,
    executable: args[0],
    args: args[1],
    timeoutMs: args[2]?.timeout,
    maxBuffer: args[2]?.maxBuffer,
    outputBytes,
    outputLimitError: outputLimitError?.message,
    processId: result.pid,
    status: result.status,
    signal: result.signal,
    error: result.error === undefined ? null : {
      name: result.error.name,
      message: result.error.message,
      code: result.error.code,
    },
  }, null, 2)}\n`);
  if (result.stderr) process.stderr.write(result.stderr);
  if (outputLimitError) throw outputLimitError;
  return result;
};
'@ | Set-Content -LiteralPath $preloadPath -Encoding utf8
$metadata = [ordered]@{
    capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
    experiment = $Experiment
    traceInitialization = $TraceInitialization.IsPresent
    wrapperProcessId = $PID
    wrapperExecutable = [System.Environment]::ProcessPath
    ghExecutable = $ghExecutable
    ghCommandCandidates = @($ghCommands | ForEach-Object { $_.Source })
    ghFileVersion = $ghFile.VersionInfo.FileVersion
    ghProductVersion = $ghFile.VersionInfo.ProductVersion
    ghFileBytes = $ghFile.Length
    nodeExecutable = $nodeExecutable
    nodeCommandCandidates = @($nodeCommands | ForEach-Object { $_.Source })
    cdbPath = $cdbPath
    cdbAvailable = (Test-Path -LiteralPath $cdbPath)
    imageOS = $env:ImageOS
    imageVersion = $env:ImageVersion
    runnerOS = $env:RUNNER_OS
    runnerArchitecture = $env:RUNNER_ARCH
}
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $directory 'metadata.json') -Encoding utf8

$writeSample = {
    param($value)
    [System.IO.File]::AppendAllText($samplesPath, (($value | ConvertTo-Json -Depth 12 -Compress) + [Environment]::NewLine))
}
$sampleProcess = {
    param([System.Diagnostics.Process] $process)
    $sample = [ordered]@{
        capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
        processId = $process.Id
        processName = $process.ProcessName
    }
    try {
        $process.Refresh()
        $sample.executable = $process.Path
        $sample.startedAt = $process.StartTime.ToUniversalTime().ToString('o')
        $sample.cpuMilliseconds = $process.TotalProcessorTime.TotalMilliseconds
        $sample.pagedMemoryBytes = $process.PagedMemorySize64
        $sample.privateMemoryBytes = $process.PrivateMemorySize64
        $sample.workingSetBytes = $process.WorkingSet64
        $sample.threads = @(
            foreach ($thread in $process.Threads) {
                $threadSample = [ordered]@{ threadId = $thread.Id }
                try {
                    $state = $thread.ThreadState
                    $threadSample.state = $state.ToString()
                    $threadSample.cpuMilliseconds = $thread.TotalProcessorTime.TotalMilliseconds
                    if ($state -eq [System.Diagnostics.ThreadState]::Wait) {
                        $threadSample.waitReason = $thread.WaitReason.ToString()
                    }
                } catch {
                    $threadSample.error = $_.Exception.Message
                }
                $threadSample
            }
        )
    } catch {
        $sample.error = $_.Exception.Message
    }
    & $writeSample $sample
}
$openLog = {
    param([string] $path)
    $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
}
$streamLogs = {
    $output = $stdoutReader.ReadToEnd()
    if ($output.Length -gt 0) { [Console]::Out.Write($output); [Console]::Out.Flush() }
    $errorOutput = $stderrReader.ReadToEnd()
    if ($errorOutput.Length -gt 0) { [Console]::Error.Write($errorOutput); [Console]::Error.Flush() }
}

$collectorEnvironment = @{ GODEBUG = ''; GH_PATH = '' }
if ($TraceInitialization) { $collectorEnvironment.GODEBUG = 'inittrace=1' }
if ($Experiment -eq 'utc') { $collectorEnvironment.TZ = 'UTC' }
$launchedAt = [DateTimeOffset]::UtcNow
$collector = $null
$stdoutReader = $null
$stderrReader = $null
$seenGh = [System.Collections.Generic.HashSet[int]]::new()
$ghProcess = $null
$ghStartedAt = $null
$sampleMarksMs = @(0, 2000, 6000, 9000)
$nextSampleMark = 0
$exitCode = $null
try {
    $collector = Start-Process -FilePath $nodeExecutable `
        -ArgumentList @('--require', './.tmp/gh-startup/capture-gh-result.cjs', 'packages/daynight/scripts/validation-environment.ts') `
        -WorkingDirectory $repository -Environment $collectorEnvironment `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath `
        -NoNewWindow -PassThru
    [Console]::Out.WriteLine(("{0} Collector launched: pid={1}, experiment={2}, trace={3}" -f $launchedAt.ToString('o'), $collector.Id, $Experiment, $TraceInitialization.IsPresent))
    & $sampleProcess $collector
    $stdoutReader = & $openLog $stdoutPath
    $stderrReader = & $openLog $stderrPath
    while (-not $collector.HasExited) {
        & $streamLogs
        if ($null -eq $ghProcess) {
            foreach ($process in @(Get-Process -Name gh -ErrorAction Ignore)) {
                try {
                    if ($null -ne $ghProcess -or $process.StartTime.ToUniversalTime() -lt $launchedAt.UtcDateTime) { continue }
                    $ghProcess = $process
                    $ghStartedAt = $process.StartTime.ToUniversalTime()
                    $seenGh.Add($process.Id) | Out-Null
                    [Console]::Out.WriteLine(("{0} gh observed: pid={1}, path={2}" -f [DateTimeOffset]::UtcNow.ToString('o'), $process.Id, $process.Path))
                } catch {
                    & $writeSample ([ordered]@{
                        capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
                        processId = $process.Id
                        error = $_.Exception.Message
                    })
                } finally {
                    if ($process -ne $ghProcess) { $process.Dispose() }
                }
            }
        }
        if ($null -ne $ghProcess -and $nextSampleMark -lt $sampleMarksMs.Count) {
            $ghProcess.Refresh()
            $ghElapsedMs = ([DateTime]::UtcNow - $ghStartedAt).TotalMilliseconds
            if (-not $ghProcess.HasExited -and $ghElapsedMs -ge $sampleMarksMs[$nextSampleMark]) {
                & $sampleProcess $ghProcess
                $nextSampleMark += 1
            }
        }
        if (([DateTimeOffset]::UtcNow - $launchedAt).TotalSeconds -ge 70) {
            throw 'The validation collector exceeded the 70-second diagnostic wrapper deadline.'
        }
        Start-Sleep -Milliseconds 100
        $collector.Refresh()
    }
    $collector.WaitForExit()
    $exitCode = $collector.ExitCode
    & $streamLogs
    [ordered]@{
        capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
        collectorProcessId = $collector.Id
        collectorExitCode = $exitCode
        elapsedMilliseconds = ([DateTimeOffset]::UtcNow - $launchedAt).TotalMilliseconds
        observedGhProcessIds = @($seenGh)
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $directory 'result.json') -Encoding utf8
} finally {
    if ($null -ne $collector -and -not $collector.HasExited) { $collector.Kill($true); $collector.WaitForExit() }
    if ($null -ne $stdoutReader) { $stdoutReader.Dispose() }
    if ($null -ne $stderrReader) { $stderrReader.Dispose() }
    if ($null -ne $ghProcess) { $ghProcess.Dispose() }
    if ($null -ne $collector) { $collector.Dispose() }
}
if ($exitCode -ne 0) { throw "The native validation collector failed with exit code $exitCode." }
