# JS-gen MySQL whitelist auto-sync (cumulative mode).
# The office network is multi-WAN NAT: MySQL egress drifts between two+ provider
# IPs (observed: 113.240.250.166 <-> 116.128.254.227 within minutes). A
# replace-style whitelist kills the previous IP's rule on every sync — and with
# it every ESTABLISHED connection from that egress (knex pool dies, ETIMEDOUT
# storm). So this script ACCUMULATES: every newly observed egress IP is added,
# existing rules are kept, and only IPs unseen for RETIRE_HOURS are removed.
#   1. install a temporary LOG rule at the top of DOCKER-USER
#   2. open a TCP probe to 47.101.58.49:3306 (SYN logged with SRC= even when ACCEPTed)
#   3. add the observed SRC to the whitelist if missing (keep 127.0.0.1)
#   4. retire whitelist IPs not observed for RETIRE_HOURS (comment file = last-seen)
#   5. remove the LOG rule
# Invoked by update-db-whitelist.cmd (keep window open); can also be run manually:
#   powershell -ExecutionPolicy Bypass -File update-db-whitelist.ps1
# Requires SSH key auth (~/.ssh/id_ed25519 installed in server authorized_keys).

$ErrorActionPreference = 'Stop'
$Server = '47.101.58.49'
$User = 'root'
$SeenFile = Join-Path $PSScriptRoot '.db-whitelist-seen'   # lines: <unix-ts> <ip>
$LogFile = Join-Path $PSScriptRoot '.db-whitelist-sync.log'
$RetireHours = 48                                          # retire IPs unseen this long

function Write-Log([string]$msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Path $LogFile
    # keep the log small
    if ((Get-Content $LogFile | Measure-Object -Line).Lines -gt 200) {
        Get-Content $LogFile | Select-Object -Last 100 | Set-Content $LogFile
    }
}

function Invoke-RemoteSsh([string]$scriptText) {
    # EAP=Continue so ssh stderr warnings (post-quantum notice) don't throw via 2>&1
    # Write LF-only temp file and feed via cmd redirection — PowerShell's object
    # pipeline to ssh.exe re-introduces CRLF, and bash then concatenates "prefix"\r
    # into the iptables --log-prefix value (breaks matching/cleanup).
    $ErrorActionPreference = 'Continue'
    $tmp = Join-Path $env:TEMP ('jsgen-wl-' + [guid]::NewGuid().ToString('N') + '.sh')
    try {
        $lf = $scriptText -replace "`r`n", "`n" -replace "`r", "`n"
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($tmp, $lf, $utf8)
        $out = cmd /c "ssh -o BatchMode=yes -o ConnectTimeout=10 $User@$Server bash -s < `"$tmp`"" 2>&1
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
    $ErrorActionPreference = 'Stop'
    return @($out | Out-String)
}

function Probe-SourceIp {
    # Unique prefix so we never pick up a stale dmesg line from an earlier probe
    # (multi-WAN egress drifts; old SRC in the ring buffer caused false "sync OK").
    # LOG must be at the top of DOCKER-USER: iptables LOG is non-terminating, so the
    # packet still hits ACCEPT/DROP below — but if LOG sits only before DROP, an
    # already-whitelisted IP is ACCEPTed first and never logged → stale SRC.
    $tag = 'DB3306P{0}' -f ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $setup = @'
set -e
# remove any leftover 3306 LOG rules (by line number, bottom-up)
for n in $(iptables -L DOCKER-USER --line-numbers -n | awk '/dpt:3306/ && /LOG/ {print $1}' | tac); do
    iptables -D DOCKER-USER "$n" || true
done
iptables -I DOCKER-USER 1 -p tcp --dport 3306 -j LOG --log-prefix "__TAG__ "
'@
    $setup = $setup.Replace('__TAG__', $tag)
    Invoke-RemoteSsh $setup | Out-Null

    # probe: SYN is logged at chain head, then ACCEPT or DROP as usual
    $client = New-Object Net.Sockets.TcpClient
    $null = $client.BeginConnect($Server, 3306, $null, $null)
    Start-Sleep -Milliseconds 1500
    $client.Close()

    $read = @'
set -e
SRC=$(dmesg | grep '__TAG__ ' | tail -1 | sed -n 's/.*SRC=\([0-9.]*\).*/\1/p')
# always clear LOG by line number (prefix match is fragile)
for n in $(iptables -L DOCKER-USER --line-numbers -n | awk '/dpt:3306/ && /LOG/ {print $1}' | tac); do
    iptables -D DOCKER-USER "$n" || true
done
echo "SRC=$SRC"
'@
    $read = $read.Replace('__TAG__', $tag)
    $out = Invoke-RemoteSsh $read
    $m = [regex]::Match($out, 'SRC=(\d{1,3}(?:\.\d{1,3}){3})')
    if (-not $m.Success) { throw 'could not observe source IP from server dmesg' }
    return $m.Groups[1].Value
}

try {
    $ip = Probe-SourceIp
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

    $remoteList = (Invoke-RemoteSsh "iptables -S DOCKER-USER | sed -n 's/.*-s \([0-9.]*\)\/32 .*--dport 3306 .*/\1/p' | grep -v '^127.0.0.1$'")
    # ssh output carries CRLF; strip \r so '127.0.0.1' is filtered correctly
    $remote = @(($remoteList | Out-String).Trim() -split '\s+') |
        ForEach-Object { $_.TrimEnd("`r") } |
        Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' -and $_ -ne '127.0.0.1' }

    # load last-seen timestamps
    $seen = @{}
    if (Test-Path $SeenFile) {
        foreach ($line in Get-Content $SeenFile) {
            $p = $line.Trim() -split '\s+'
            if ($p.Count -eq 2 -and $p[0] -match '^\d+$' -and $p[1] -match '^\d{1,3}(\.\d{1,3}){3}$') {
                $seen[$p[1]] = [long]$p[0]
            }
        }
    }
    $seen[$ip] = $now

    if ($remote -contains $ip) {
        Write-Log "observed source IP: $ip (already whitelisted: [$($remote -join ', ')])"
    } else {
        Write-Log "observed source IP: $ip (NEW; current whitelist: [$($remote -join ', ')]) -> adding"
        # cumulative: add NEW only; never drop existing accept rules — a rule the
        # current egress doesn't use may be serving ESTABLISHED connections from
        # the other NAT path. Insert before the 3306 DROP in both chains.
        $script = @'
set -e
NEW=__NEWIP__
for CHAIN in DOCKER-USER INPUT; do
    iptables -C $CHAIN -s "$NEW/32" -p tcp -m tcp --dport 3306 -j ACCEPT 2>/dev/null && continue
    DROPLINE=$(iptables -L $CHAIN --line-numbers -n | awk '/dpt:3306/ && /DROP/ {print $1; exit}')
    if [ -n "$DROPLINE" ]; then
        iptables -I $CHAIN "$DROPLINE" -s "$NEW/32" -p tcp -m tcp --dport 3306 -j ACCEPT
    else
        iptables -A $CHAIN -s "$NEW/32" -p tcp -m tcp --dport 3306 -j ACCEPT
    fi
done
echo "DOCKER-USER now:"
iptables -L DOCKER-USER -n | grep 3306
'@
        $script = $script.Replace('__NEWIP__', $ip)
        $res = Invoke-RemoteSsh $script
        Write-Log ("remote output: " + ($res.Trim() -replace "\r?\n", ' | '))
        Write-Log "whitelist accumulated $ip"
    }

    # retire: server rules + seen entries for IPs unseen for RETIRE_HOURS
    # (never touch the IP observed this cycle or anything seen recently)
    $stale = @($seen.Keys | Where-Object { ($now - [long]$seen[$_]) -gt ($RetireHours * 3600) })
    $retired = @()
    foreach ($old in $stale) {
        $null = $seen.Remove($old)
        if ($old -eq $ip) { continue }
        if ($remote -contains $old) {
            $script = @'
set -e
for OLD in __OLDIPS__ ; do
    [ -n "$OLD" ] || continue
    iptables -D DOCKER-USER -s "$OLD/32" -p tcp -m tcp --dport 3306 -j ACCEPT 2>/dev/null || true
    iptables -D INPUT -s "$OLD/32" -p tcp -m tcp --dport 3306 -j ACCEPT 2>/dev/null || true
done
echo "retired: __OLDIPS__"
'@
            $script = $script.Replace('__OLDIPS__', $old)
            $res = Invoke-RemoteSsh $script
            Write-Log ("retire output: " + ($res.Trim() -replace "\r?\n", ' | '))
            $retired += $old
        }
    }
    if ($retired.Count) { Write-Log ("retired unseen-for-${RetireHours}h IPs: " + ($retired -join ', ')) }

    # persist last-seen (sorted by ts for readability)
    ($seen.GetEnumerator() | Sort-Object Value | ForEach-Object { "$($_.Value) $($_.Key)" }) |
        Set-Content -Path $SeenFile
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
