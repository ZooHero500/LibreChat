FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi==0.115.6 "uvicorn[standard]==0.34.0" httpx==0.28.1 pymongo==4.10.1 bcrypt==4.2.1 pyjwt==2.10.1
COPY app.py index.html portal.html /app/
EXPOSE 8000
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8000"]
