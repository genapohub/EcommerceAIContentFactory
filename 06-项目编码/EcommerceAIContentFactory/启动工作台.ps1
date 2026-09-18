$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtime = Get-Command node -ErrorAction SilentlyContinue
if ($runtime) { $nodePath = $runtime.Source }
else { $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw '需要 Node.js 24，请先安装后再启动。' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\express'))) { throw '依赖未安装，请先执行 pnpm install --frozen-lockfile。' }
& $nodePath (Join-Path $PSScriptRoot '服务端\启动.mjs')
