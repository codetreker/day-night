param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('default', 'resolved')]
    [string] $GhPathMode
)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$directory = Join-Path $repository '.tmp/gh-startup'
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$samplesPath = Join-Path $directory 'process-samples.jsonl'
$stdoutPath = Join-Path $directory 'collector.stdout.log'
$stderrPath = Join-Path $directory 'collector.stderr.log'
$ghExecutable = (Get-Command gh.exe -CommandType Application -ErrorAction Stop).Source
$nodeExecutable = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
$ghFile = Get-Item -LiteralPath $ghExecutable
$preloadPath = Join-Path $directory 'capture-gh-result.cjs'
@'
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const original = childProcess.spawnSync;
const directory = path.resolve(".tmp/gh-startup");

// Preserve the native result before the collector limits diagnostic output to 16 KiB.
childProcess.spawnSync = function (...args) {
  const result = Reflect.apply(original, this, args);
  if (["gh", "gh.exe"].includes(path.basename(String(args[0])).toLowerCase())) {
    fs.writeFileSync(path.join(directory, "gh.stdout.log"), result.stdout ?? "");
    fs.writeFileSync(path.join(directory, "gh.stderr.log"), result.stderr ?? "");
    fs.writeFileSync(path.join(directory, "gh-result.json"), `${JSON.stringify({
      capturedAt: new Date().toISOString(),
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
  }
  return result;
};
'@ | Set-Content -LiteralPath $preloadPath -Encoding utf8
$metadata = [ordered]@{
    capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
    ghPathMode = $GhPathMode
    ghExecutable = $ghExecutable
    ghFileVersion = $ghFile.VersionInfo.FileVersion
    ghProductVersion = $ghFile.VersionInfo.ProductVersion
    ghFileBytes = $ghFile.Length
    nodeExecutable = $nodeExecutable
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

$collectorEnvironment = @{ GODEBUG = 'inittrace=1'; GH_PATH = '' }
if ($GhPathMode -eq 'resolved') { $collectorEnvironment.GH_PATH = $ghExecutable }
$launchedAt = [DateTimeOffset]::UtcNow
$collector = $null
$stdoutReader = $null
$stderrReader = $null
$seenGh = [System.Collections.Generic.HashSet[int]]::new()
$exitCode = $null
try {
    $collector = Start-Process -FilePath $nodeExecutable `
        -ArgumentList @('--require', '.tmp/gh-startup/capture-gh-result.cjs', 'packages/daynight/scripts/validation-environment.ts') `
        -WorkingDirectory $repository -Environment $collectorEnvironment `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath `
        -NoNewWindow -PassThru
    [Console]::Out.WriteLine("{0} Collector launched: pid={1}, GH_PATH mode={2}" -f $launchedAt.ToString('o'), $collector.Id, $GhPathMode)
    & $sampleProcess $collector
    $stdoutReader = & $openLog $stdoutPath
    $stderrReader = & $openLog $stderrPath
    while (-not $collector.HasExited) {
        & $streamLogs
        foreach ($process in @(Get-Process -Name gh -ErrorAction Ignore)) {
            try {
                if ($process.StartTime.ToUniversalTime() -lt $launchedAt.UtcDateTime) { continue }
                if ($seenGh.Add($process.Id)) {
                    [Console]::Out.WriteLine("{0} gh observed: pid={1}, path={2}" -f [DateTimeOffset]::UtcNow.ToString('o'), $process.Id, $process.Path)
                }
                & $sampleProcess $process
            } catch {
                & $writeSample ([ordered]@{
                    capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
                    processId = $process.Id
                    error = $_.Exception.Message
                })
            } finally {
                $process.Dispose()
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
    if ($null -ne $collector) { $collector.Dispose() }
}
if ($exitCode -ne 0) { throw "The native validation collector failed with exit code $exitCode." }
