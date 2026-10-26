@echo off
setlocal
chcp 65001 >nul
echo 正在查找占用 4788 端口的进程...
set "FOUND="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4788" ^| findstr "LISTENING"') do (
    set "FOUND=1"
    taskkill /F /PID %%a
    echo 已强制结束 PID=%%a 的进程
)
if not defined FOUND echo 未发现占用 4788 端口的进程
echo 操作完成
pause
endlocal
