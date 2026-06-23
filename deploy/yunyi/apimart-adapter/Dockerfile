FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi==0.115.6 "uvicorn[standard]==0.34.0" httpx==0.28.1
COPY app.py /app/app.py
EXPOSE 8000
# 绑 IPv6(::)兼容 Railway 内网(*.railway.internal 走 IPv6);Linux 双栈下同时接受 IPv4
CMD ["uvicorn", "app:app", "--host", "::", "--port", "8000"]
