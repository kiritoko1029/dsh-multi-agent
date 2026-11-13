#requires -Version 7.6
<#
只启动独立诊断子进程；probe.cjs 负责只读导入，不应 apply 插件或启动 CLI。
报告包含本机路径。脚本不安装依赖、不修改 profile，也不修改全局环境。
#>
[CmdletBinding()]
param(
    [string] $DshExe,
    [string] $ProfileDir,
    [string] $DshInstallDir,
    [string] $OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ExistingExe {
    param([string] $Candidate)
    if ([string]::IsNullOrWhiteSpace($Candidate)) { return $null }
    try {
        if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { return $null }
        $item = Get-Item -LiteralPath $Candidate
        if ($item.Extension -ine '.exe') { return $null }
        return $item.FullName
    }
    catch {
        return $null
    }
}

function Resolve-DshExecutable {
    param([string] $ExplicitPath)
    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $resolved = Get-ExistingExe $ExplicitPath
        if ($null -eq $resolved) { throw "-DshExe 不是现有的 EXE 文件：$ExplicitPath" }
        return $resolved
    }

    $fromEnvironment = Get-ExistingExe ([Environment]::GetEnvironmentVariable('DSH_NODE_EXECUTABLE'))
    if ($null -ne $fromEnvironment) { return $fromEnvironment }

    $candidates = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    # 仅查询指定名称进程的 Path，不读取 CommandLine，也不遍历安装目录。
    foreach ($running in @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)) {
        try {
            $candidate = Get-ExistingExe $running.Path
            if ($null -ne $candidate) { [void] $candidates.Add($candidate) }
        }
        catch {
            # 某个进程可能已退出或不允许读取 Path；不扩大搜索范围。
        }
        finally {
            $running.Dispose()
        }
    }
    if ($candidates.Count -eq 1) {
        foreach ($candidate in $candidates) { return $candidate }
    }
    if ($candidates.Count -gt 1) {
        throw ("检测到多个 DSH 安装，请用 -DshExe 明确指定：`n" + ($candidates -join "`n"))
    }
    throw '找不到可用的 DSH Electron EXE。请用 -DshExe 明确指定已安装的 DeepSeek Harness.exe。'
}

function Resolve-ExistingDirectory {
    param([string] $Candidate, [string] $Label)
    if (-not (Test-Path -LiteralPath $Candidate -PathType Container)) {
        throw "$Label 目录不存在：$Candidate"
    }
    return (Get-Item -LiteralPath $Candidate).FullName
}

$example = @'
显式指定示例（请替换成实际路径）：
  .\Diagnose-CodexHost.ps1 -DshExe 'C:\实际安装目录\DeepSeek Harness.exe' -ProfileDir 'C:\Users\你的用户名\.dsh\profiles\desktop'
请在 PowerShell 7.6 中运行；不要使用 Invoke-Expression 或 ExecutionPolicy Bypass。
'@

try {
    if (-not $IsWindows) { throw '此诊断脚本仅支持 Windows 上的 PowerShell 7.6 或更高版本的 pwsh。' }
    $executable = Resolve-DshExecutable $DshExe
    $probePath = Join-Path $PSScriptRoot 'probe.cjs'
    if (-not (Test-Path -LiteralPath $probePath -PathType Leaf)) {
        throw "找不到同目录的 probe.cjs，请保留完整诊断工具目录：$probePath"
    }
    $probePath = (Get-Item -LiteralPath $probePath).FullName

    if ([string]::IsNullOrWhiteSpace($ProfileDir)) {
        $ProfileDir = [Environment]::GetEnvironmentVariable('DSH_PROFILE_DIR')
    }
    if ([string]::IsNullOrWhiteSpace($ProfileDir)) {
        $dshHomeDirectory = [Environment]::GetEnvironmentVariable('DSH_HOME')
        if ([string]::IsNullOrWhiteSpace($dshHomeDirectory)) {
            $userHomeDirectory = [Environment]::GetEnvironmentVariable('HOME')
            if ([string]::IsNullOrWhiteSpace($userHomeDirectory)) { $userHomeDirectory = $HOME }
            if ([string]::IsNullOrWhiteSpace($userHomeDirectory)) {
                throw '无法确定用户目录，请显式提供 -ProfileDir。'
            }
            $dshHomeDirectory = Join-Path $userHomeDirectory '.dsh'
        }
        $ProfileDir = Join-Path $dshHomeDirectory 'profiles\desktop'
    }
    $profilePath = Resolve-ExistingDirectory $ProfileDir 'Profile'
    if (-not (Test-Path -LiteralPath (Join-Path $profilePath 'package.json') -PathType Leaf)) {
        throw "Profile 中没有 package.json：$profilePath"
    }

    $installAnchor = $null
    if (-not [string]::IsNullOrWhiteSpace($DshInstallDir)) {
        if (-not [IO.Path]::IsPathFullyQualified($DshInstallDir)) {
            throw '-DshInstallDir 必须是绝对路径。'
        }
        # PowerShell/.NET 无法读取 app.asar 内部；交由 probe 的 Electron 文件系统验证。
        $installDirectory = [IO.Path]::GetFullPath($DshInstallDir)
        $installAnchor = Join-Path $installDirectory 'package.json'
    }

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        $OutputPath = Join-Path $PSScriptRoot ('CodexHost-Diagnostic-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.txt')
    }
    $reportPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($reportPath)) -PathType Container)) {
        throw "报告父目录不存在，请选择已有目录：$reportPath"
    }
    # CreateNew 原子拒绝覆盖，包括检查与创建之间发生的同名文件竞争。
    $reportStream = [IO.File]::Open($reportPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
}
catch {
    [Console]::Error.WriteLine("无法开始诊断：$($_.Exception.Message)")
    [Console]::Error.WriteLine($example)
    exit 1
}

$utf8 = [Text.UTF8Encoding]::new($false)
$writer = [IO.StreamWriter]::new($reportStream, $utf8)
$writer.AutoFlush = $true
$child = [Diagnostics.Process]::new()
$started = $false
$timedOut = $false
$wrapperExitCode = 1
$childExitCode = $null
$stdoutTask = $null
$stderrTask = $null
$sawProbeMarker = $false

try {
    $writer.WriteLine('DSH Codex Host 只读导入诊断')
    $writer.WriteLine('开始时间：' + [DateTimeOffset]::Now.ToString('o'))
    $writer.WriteLine('提示：本报告含本机路径；发送前可自行核对。')
    $writer.WriteLine('PowerShell：' + $PSVersionTable.PSVersion.ToString())
    $writer.WriteLine('DSH EXE：' + $executable)
    $writer.WriteLine('Profile：' + $profilePath)
    $writer.WriteLine('Probe：' + $probePath)
    $writer.WriteLine('Install anchor：' + $(if ($null -eq $installAnchor) { '未显式指定，由 probe 判断' } else { $installAnchor }))

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $executable
    $startInfo.WorkingDirectory = $PSScriptRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = $utf8
    $startInfo.StandardErrorEncoding = $utf8
    # 只改这个子进程的环境，不改 $env:、当前进程或用户/系统环境。
    $startInfo.Environment['ELECTRON_RUN_AS_NODE'] = '1'
    $startInfo.ArgumentList.Add('--expose-internals')
    $startInfo.ArgumentList.Add($probePath)
    $startInfo.ArgumentList.Add('--profile-dir')
    $startInfo.ArgumentList.Add($profilePath)
    if ($null -ne $installAnchor) {
        $startInfo.ArgumentList.Add('--install-anchor')
        $startInfo.ArgumentList.Add($installAnchor)
    }
    $child.StartInfo = $startInfo
    $started = $child.Start()
    if (-not $started) { throw '诊断子进程未能启动。' }
    $writer.WriteLine('诊断子进程 PID：' + $child.Id)
    # 两条管道从启动后立即并发读取，避免输出缓冲区填满而互相等待。
    $stdoutTask = $child.StandardOutput.ReadToEndAsync()
    $stderrTask = $child.StandardError.ReadToEndAsync()
    if (-not $child.WaitForExit(60000)) {
        $timedOut = $true
        $writer.WriteLine('诊断超过 60 秒，正在终止本脚本创建的诊断子进程。')
        # 不调用 Kill(true)，不终止进程树，不触碰已有 DSH 进程。
        $child.Kill()
        if (-not $child.WaitForExit(5000)) { throw '诊断子进程在终止请求后仍未退出。' }
    }
    $childExitCode = $child.ExitCode
    $wrapperExitCode = if ($timedOut) { 124 } else { $childExitCode }
}
catch {
    $writer.WriteLine('Wrapper 异常：' + $_.Exception.ToString())
    $wrapperExitCode = if ($timedOut) { 124 } else { 1 }
}
finally {
    if ($started) {
        try {
            if (-not $child.HasExited) {
                $child.Kill()
                [void] $child.WaitForExit(5000)
            }
            if ($child.HasExited) { $childExitCode = $child.ExitCode }
        }
        catch { $writer.WriteLine('子进程清理异常：' + $_.Exception.ToString()) }
    }
    # 正常退出或被终止后读取完整输出；额外限制管道排空时间，避免意外继承句柄挂住 wrapper。
    foreach ($stream in @(@{ Name = 'stdout'; Task = $stdoutTask }, @{ Name = 'stderr'; Task = $stderrTask })) {
        $writer.WriteLine("`n===== $($stream.Name) =====")
        if ($null -eq $stream.Task) {
            $writer.WriteLine('未启动输出读取。')
            continue
        }
        try {
            if (-not $stream.Task.Wait(5000)) {
                $writer.WriteLine('输出管道未在退出后关闭；无法取得完整输出。')
                if ($wrapperExitCode -eq 0) { $wrapperExitCode = 1 }
            }
            else {
                $text = $stream.Task.GetAwaiter().GetResult()
                $writer.Write($text)
                if ($stream.Name -eq 'stdout' -and $text.Contains('DIAGNOSTIC=')) {
                    $sawProbeMarker = $true
                }
            }
        }
        catch {
            $writer.WriteLine('输出读取异常：' + $_.Exception.ToString())
            if ($wrapperExitCode -eq 0) { $wrapperExitCode = 1 }
        }
    }
    if ($wrapperExitCode -eq 0 -and -not $sawProbeMarker) {
        $writer.WriteLine('未收到 Node 诊断标记，不能视为导入成功。请检查 DSH EXE 和 RunAsNode 支持。')
        $wrapperExitCode = 1
    }
    $writer.WriteLine("`n===== 运行结果 =====")
    $writer.WriteLine('是否超时：' + $timedOut)
    $writer.WriteLine('子进程退出码：' + $(if ($null -eq $childExitCode) { '未知/未启动' } else { $childExitCode }))
    $writer.WriteLine('Wrapper 退出码：' + $wrapperExitCode)
    $writer.WriteLine('结束时间：' + [DateTimeOffset]::Now.ToString('o'))
    $child.Dispose()
    $writer.Dispose()
}

Write-Host "诊断报告已保存：$reportPath"
Write-Host '报告包含本机路径，请核对后将此 txt 文件发回。'
exit $wrapperExitCode
