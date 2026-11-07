#Requires -Version 5.1
<#
.SYNOPSIS
    Поднимает локальный сервер DevOps Trainer на фиксированном порту.

.DESCRIPTION
    Адрес приложения фиксирован: http://127.0.0.1:8000/.
    Это принципиально: прогресс и свои карточки лежат в localStorage браузера
    и привязаны к адресу (origin). Другой порт — это другое хранилище,
    прогресс там будет пустым.

    Если порт занят, скрипт НЕ подбирает другой порт: он объясняет, как
    освободить текущий. Так адрес всегда остаётся одним и тем же.

.PARAMETER Port
    Порт. По умолчанию 8000. Меняйте только осознанно: прогресс станет отдельным.

.PARAMETER NoBrowser
    Не открывать браузер автоматически.

.EXAMPLE
    .\start.ps1

.EXAMPLE
    .\start.ps1 -NoBrowser
#>
[CmdletBinding()]
param(
    [int]$Port = 8000,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$url = "http://127.0.0.1:$Port/"

# --- Python ---------------------------------------------------------------

$pyExe = $null
$pyArgs = @()

foreach ($candidate in @('python', 'py')) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }

    $versionArgs = if ($candidate -eq 'py') { @('-3', '--version') } else { @('--version') }
    try {
        $out = & $cmd.Source @versionArgs 2>&1
        if ($LASTEXITCODE -eq 0 -and "$out" -match 'Python 3') {
            $pyExe = $cmd.Source
            if ($candidate -eq 'py') { $pyArgs = @('-3') }
            break
        }
    } catch {
        continue
    }
}

if (-not $pyExe) {
    Write-Host 'Python 3 не найден.' -ForegroundColor Red
    Write-Host 'Установите Python 3.8+ с python.org и запустите скрипт снова.'
    exit 1
}

# --- проверка порта -------------------------------------------------------

function Test-PortBusy {
    param([int]$Candidate)

    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Candidate)
        $listener.Start()
        return $false
    } catch {
        return $true
    } finally {
        if ($listener) {
            try { $listener.Stop() } catch { }
        }
    }
}

if (Test-PortBusy -Candidate $Port) {
    Write-Host ''
    Write-Host "Порт $Port уже занят — сервер не запущен." -ForegroundColor Red
    Write-Host ''
    Write-Host 'Вероятно, тренажёр уже открыт в другой вкладке или остался висеть старый процесс.'
    Write-Host ''
    Write-Host 'Найти процесс, который держит порт:'
    Write-Host "  Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object OwningProcess"
    Write-Host 'Остановить его:'
    Write-Host '  Stop-Process -Id <PID>'
    Write-Host ''
    Write-Host "Адрес приложения фиксирован: $url" -ForegroundColor Yellow
    Write-Host 'Не поднимайте сервер на другом порту: это другой origin,' -ForegroundColor Yellow
    Write-Host 'и браузер покажет пустой прогресс вместо вашего.' -ForegroundColor Yellow
    exit 1
}

if ($Port -ne 8000) {
    Write-Host "Внимание: порт $Port отличается от стандартного 8000." -ForegroundColor Yellow
    Write-Host 'Прогресс и свои карточки в нём будут отдельными от http://127.0.0.1:8000/.' -ForegroundColor Yellow
    Write-Host ''
}

# --- запуск ---------------------------------------------------------------

Write-Host ''
Write-Host '  DevOps Trainer' -ForegroundColor Cyan
Write-Host "  Адрес:  $url"
Write-Host "  Папка:  $root"
Write-Host ''
Write-Host '  Ctrl+C — остановить сервер.' -ForegroundColor DarkGray
Write-Host ''

if (-not $NoBrowser) {
    Start-Process $url
}

$serverArgs = @('-m', 'http.server', $Port.ToString(), '--bind', '127.0.0.1')

Push-Location $root
try {
    & $pyExe @($pyArgs + $serverArgs)
} finally {
    Pop-Location
}
