# JS-gen MySQL whitelist auto-sync.
# The office network is multi-WAN NAT: the egress IP used for MySQL traffic to the
# server differs from HTTP egress (ifconfig.me) and drifts over time. So instead of
# trusting an IP-echo service, the server itself observes the real source IP:
#   1. install a temporary LOG rule before the 3306 DROP rule in DOCKER-USER
#   2. open a TCP probe to 47.101.58.49:3306 (SYN is dropped, but logged with SRC=)
#   3. read the observed SRC from dmesg and whitelist that IP (keep 127.0.0.1)
#   4. remove the LOG rule
# Invoked by a Windows scheduled task every 10 minutes; can also be run manually:
#   powershell -ExecutionPolicy Bypass -File update-db-whitelist.ps1
# Requires SSH key auth (~/.ssh/id_ed25519 installed in server authorized_keys).

$ErrorActionPreference = 'Stop'
$Server = '47.101.58.49'
$User = 'root'
$StateFile = Join-Path $PSScriptRoot '.db-whitelist-lastip'
$LogFile = Join-Path $PSScriptRoot '.db-whitelist-sync.log'

function Write-Log([string]$msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Path $LogFile
    # keep the log small
    if ((Get-Content $LogFile | Measure-Object -Line).Lines -gt 200) {
        Get-Content $LogFile | Select-Object -Last 100 | Set-Content $LogFile
    }
}

function Invoke-RemoteSsh([string]$scriptText) {
    # EAP=Continue so ssh stderr warnings (post-quantum notice) don't throw via 2>&1
    $ErrorActionPreference = 'Continue'
    $out = $scriptText | ssh -o BatchMode=yes -o ConnectTimeout=10 "$User@$Server" 'bash -s' 2>&1
    $ErrorActionPreference = 'Stop'
    return @($out | Out-String)
}

function Probe-SourceIp {
    # 1) temporary LOG rule before the 3306 DROP rule; 2) probe; 3) read SRC; 4) cleanup
    $setup = @'
set -e
# install LOG rule idempotently right before the 3306 DROP line
if ! iptables -C DOCKER-USER -p tcp --dport 3306 -j LOG --log-prefix "DB3306 " 2>/dev/null; then
    DROPLINE=$(iptables -L DOCKER-USER --line-numbers -n | awk '/dpt:3306/ && /DROP/ {print $1; exit}')
    [ -n "$DROPLINE" ] && iptables -I DOCKER-USER "$DROPLINE" -p tcp --dport 3306 -j LOG --log-prefix "DB3306 "
fi
'@
    Invoke-RemoteSsh $setup | Out-Null

    # probe: SYN reaches the server and is logged before DROP; short timeout is fine
    $client = New-Object Net.Sockets.TcpClient
    $null = $client.BeginConnect($Server, 3306, $null, $null)
    Start-Sleep -Milliseconds 1500
    $client.Close()

    $read = @'
set -e
SRC=$(dmesg | grep 'DB3306 ' | tail -1 | sed -n 's/.*SRC=\([0-9.]*\).*/\1/p')
iptables -D DOCKER-USER -p tcp --dport 3306 -j LOG --log-prefix "DB3306 " 2>/dev/null || true
echo "SRC=$SRC"
'@
    $out = Invoke-RemoteSsh $read
    $m = [regex]::Match($out, 'SRC=(\d{1,3}(?:\.\d{1,3}){3})')
    if (-not $m.Success) { throw 'could not observe source IP from server dmesg' }
    return $m.Groups[1].Value
}

try {
    $ip = Probe-SourceIp

    $remoteList = (Invoke-RemoteSsh "iptables -S DOCKER-USER | sed -n 's/.*-s \([0-9.]*\)\/32 .*--dport 3306 .*/\1/p' | grep -v '^127.0.0.1$'")
    # ssh output carries CRLF; strip \r so '127.0.0.1' is filtered correctly
    $remote = @(($remoteList | Out-String).Trim() -split '\s+') |
        ForEach-Object { $_.TrimEnd("`r") } |
        Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' -and $_ -ne '127.0.0.1' }

    if ($remote -contains $ip) {
        Set-Content -Path $StateFile -Value $ip
        exit 0
    }

    $oldList = $remote -join ' '
    Write-Log "observed source IP: $ip; server whitelist: [$($remote -join ', ')] -> updating"

    # single-quoted here-string: nothing is evaluated locally; tokens replaced below
    $script = @'
set -e
NEW=__NEWIP__
# drop stale /32 accept rules (keep 127.0.0.1); DOCKER-USER is the chain that
# actually applies to docker-published ports, INPUT is a redundant copy
for OLD in __OLDIPS__ ; do
    [ -n "$OLD" ] || continue
    iptables -D DOCKER-USER -s "$OLD/32" -p tcp -m tcp --dport 3306 -j ACCEPT 2>/dev/null || true
    iptables -D INPUT -s "$OLD/32" -p tcp -m tcp --dport 3306 -j ACCEPT 2>/dev/null || true
done
# insert the new accept rule right before the 3306 DROP rule in both chains
for CHAIN in DOCKER-USER INPUT; do
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
    $script = $script.Replace('__NEWIP__', $ip).Replace('__OLDIPS__', $oldList)
    $res = Invoke-RemoteSsh $script
    Write-Log ("remote output: " + ($res.Trim() -replace "\r?\n", ' | '))

    Set-Content -Path $StateFile -Value $ip
    Write-Log "whitelist updated to $ip"
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
