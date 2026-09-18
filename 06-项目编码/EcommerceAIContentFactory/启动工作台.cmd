@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel% equ 0 (
  node "%~dp0服务端\启动.mjs"
) else (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "%~dp0服务端\启动.mjs"
  ) else (
    echo 请先安装 Node.js 24。
  )
)
pause
