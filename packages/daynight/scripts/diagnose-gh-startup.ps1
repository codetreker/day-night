param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('baseline')]
    [string] $Experiment,
    [switch] $TraceInitialization,
    [string] $CollectorScript = 'packages/daynight/scripts/validation-environment.ts',
    [switch] $DisableDebugger
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
$preloadPath = Join-Path $directory 'capture-gh-result.cjs'
@'
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const original = childProcess.spawnSync;
const directory = path.resolve(".tmp/gh-startup");

// Preserve the native result before the collector limits diagnostic output to 16 KiB.
childProcess.spawnSync = function (...args) {
  if (!["gh", "gh.exe"].includes(path.basename(String(args[0])).toLowerCase())) {
    return Reflect.apply(original, this, args);
  }
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = Reflect.apply(original, this, args);
  const nativeElapsedMs = performance.now() - started;
  fs.writeFileSync(path.join(directory, "gh.stdout.log"), result.stdout ?? "");
  fs.writeFileSync(path.join(directory, "gh.stderr.log"), result.stderr ?? "");
  fs.writeFileSync(path.join(directory, "gh-result.json"), `${JSON.stringify({
    startedAt,
    capturedAt: new Date().toISOString(),
    nativeElapsedMs,
    parentProcessId: process.pid,
    parentExecutable: process.execPath,
    executable: args[0],
    args: args[1],
    timeoutMs: args[2]?.timeout,
    maxBuffer: args[2]?.maxBuffer,
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
  return result;
};
'@ | Set-Content -LiteralPath $preloadPath -Encoding utf8
$metadata = [ordered]@{
    capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
    experiment = $Experiment
    traceInitialization = $TraceInitialization.IsPresent
    collectorScript = $CollectorScript
    debuggerDisabled = $DisableDebugger.IsPresent
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
$symbolDirectory = Join-Path $directory 'symbols'
[System.IO.Directory]::CreateDirectory($symbolDirectory) | Out-Null
$debuggerState = [ordered]@{
    executable = $cdbPath
    symbolDirectory = $symbolDirectory
    targetAliveMilliseconds = 1000
    state = 'pending'
}
if ($DisableDebugger) { $debuggerState.state = 'disabled' }
elseif ($TraceInitialization) { $debuggerState.state = 'disabled-for-warm-trace' }
elseif (-not $metadata.cdbAvailable) { $debuggerState.state = 'unavailable' }
$writeDebuggerState = {
    $debuggerState.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $debuggerState | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $directory 'debugger.json') -Encoding utf8
}
& $writeDebuggerState

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
$launchedAt = [DateTimeOffset]::UtcNow
$collector = $null
$stdoutReader = $null
$stderrReader = $null
$seenGh = [System.Collections.Generic.HashSet[int]]::new()
$ghProcess = $null
$ghStartedAt = $null
$sampleMarksMs = @(0, 2000, 6000, 9000)
$nextSampleMark = 0
$debugger = $null
$exitCode = $null
try {
    $collector = Start-Process -FilePath $nodeExecutable `
        -ArgumentList @('--require', './.tmp/gh-startup/capture-gh-result.cjs', $CollectorScript) `
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
            if (-not $ghProcess.HasExited -and $ghElapsedMs -ge 1000 -and $debuggerState.state -eq 'pending') {
                $debuggerState.state = 'launching'
                $debuggerState.targetProcessId = $ghProcess.Id
                $debuggerState.targetAgeAtLaunchMs = $ghElapsedMs
                $debuggerState.startedAt = [DateTimeOffset]::UtcNow.ToString('o')
                $debuggerArguments = @('-pvr', '-p', [string]$ghProcess.Id, '-sins', '-y', ('"{0}"' -f $symbolDirectory), '-c', '"~* k; q"')
                $debuggerState.arguments = $debuggerArguments
                try {
                    $debugger = Start-Process -FilePath $cdbPath -ArgumentList $debuggerArguments `
                        -WorkingDirectory $repository `
                        -Environment @{ _NT_SYMBOL_PATH = $symbolDirectory; _NT_ALT_SYMBOL_PATH = '' } `
                        -RedirectStandardOutput (Join-Path $directory 'debugger.stdout.log') `
                        -RedirectStandardError (Join-Path $directory 'debugger.stderr.log') `
                        -NoNewWindow -PassThru
                    $debuggerState.state = 'running'
                    $debuggerState.processId = $debugger.Id
                } catch {
                    $debuggerState.state = 'launch-failed'
                    $debuggerState.error = $_.Exception.Message
                }
                & $writeDebuggerState
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
    if ($null -ne $debugger) {
        try {
            if (-not $debugger.WaitForExit(15000)) {
                $debugger.Kill($true)
                $debugger.WaitForExit()
                $debuggerState.state = 'terminated-after-deadline'
            } else {
                $debuggerState.state = 'completed'
            }
            $debuggerState.exitedAt = [DateTimeOffset]::UtcNow.ToString('o')
            $debuggerState.exitCode = $debugger.ExitCode
        } catch {
            $debuggerState.state = 'cleanup-failed'
            $debuggerState.error = $_.Exception.Message
        } finally {
            $debugger.Dispose()
        }
    } elseif ($debuggerState.state -eq 'pending') {
        $debuggerState.state = 'target-exited-before-trigger'
    }
    & $writeDebuggerState
    if ($null -ne $stdoutReader) { $stdoutReader.Dispose() }
    if ($null -ne $stderrReader) { $stderrReader.Dispose() }
    if ($null -ne $ghProcess) { $ghProcess.Dispose() }
    if ($null -ne $collector) { $collector.Dispose() }
}
if ($exitCode -ne 0) { throw "The native validation collector failed with exit code $exitCode." }
