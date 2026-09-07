@echo off
chcp 65001 >nul
title FDE Editor 本地服务
cd /d "%~dp0"
echo 正在启动 FDE 编辑器本地服务...
start "" http://127.0.0.1:8137/editor.html
node tools/serve.mjs
pause
