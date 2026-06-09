#!/bin/bash
# 一键更新脚本 - 在服务器上运行

echo "=== 停止后端 ==="
pkill -f "uvicorn" || true
pkill -f "python.*main.py" || true
sleep 2

echo "=== 拉取最新代码 ==="
cd /root/health-app
git pull origin main

echo "=== 检查前端文件 ==="
ls -la frontend/

echo "=== 启动后端 ==="
cd backend
nohup python3 main.py > /root/backend.log 2>&1 &
sleep 3

echo "=== 检查后端状态 ==="
ps aux | grep "python.*main.py" | grep -v grep
curl -s http://localhost:8000/api/health 2>/dev/null || echo "Health check failed"

echo "=== 完成 ==="
echo "访问地址: http://43.226.45.82:8000/"
