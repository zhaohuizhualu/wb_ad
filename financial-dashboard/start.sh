#!/bin/bash
cd /root/financial-dashboard/backend
PYTHONPATH=/root/financial-dashboard/backend python -m uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "后端启动，PID: $BACKEND_PID"

sleep 5
cd /root/financial-dashboard/frontend
npm run dev &
FRONTEND_PID=$!
echo "前端启动，PID: $FRONTEND_PID"

echo "前端: http://localhost:3000"
echo "后端: http://localhost:8000"
wait
