param(
    [Parameter(Mandatory = $true)][string]$Match,
    [string]$ParentExclude = ''
)

# Kill node.exe processes whose command line contains $Match, optionally
# excluding those whose PARENT process command line contains $ParentExclude.
# Used by restart-local.cmd: the second-instance proxy (started via
# config\start-executor-proxy.cmd) has a node command line identical to the
# local executor, so it is excluded by its parent cmd carrying
# 'start-executor-proxy.cmd' in its command line.

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
$parents = @{}
foreach ($p in $procs) { $parents[$p.ProcessId] = $p.ParentProcessId }

foreach ($p in $procs) {
    $cl = $p.CommandLine
    if (-not $cl -or $cl -notlike "*$Match*") { continue }
    if ($ParentExclude) {
        $ppid = $p.ParentProcessId
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$ppid" -ErrorAction SilentlyContinue
        if ($parent -and $parent.CommandLine -and $parent.CommandLine -like "*$ParentExclude*") {
            Write-Output ("skip pid " + $p.ProcessId + " (proxy, parent=start-executor-proxy)")
            continue
        }
    }
    Write-Output ("killing pid " + $p.ProcessId)
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
