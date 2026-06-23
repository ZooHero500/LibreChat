# YunYi · essjoy AI 平台部署

基于本 fork(LibreChat)为 essjoy 电商团队搭建的自托管 AI 平台:**统一门户 + 对话(LibreChat)+ 自建生图工作台**,单点登录、全站 HTTPS。本目录收纳所有自定义部署产物。

## 架构

```
同事 → https://app.essjoy.com  (门户/登录/SSO,apimart-studio 提供)
            │ 登录一次,会话 Cookie 写到 .essjoy.com,chat/draw 自动免登
            ├─💬 https://chat.essjoy.com → LibreChat(对话 + 电商智能体 + 技能)
            └─🎨 https://draw.essjoy.com → 生图工作台(apimart-studio)
   ┌────────────────────────────────────────────────┐
   │ Caddy(自动 HTTPS 反代 + 改写 chat 的 Set-Cookie 域到 .essjoy.com)│
   │ LibreChat(api) + MongoDB + Meilisearch + pgvector + rag_api      │
   │ apimart-adapter(把 apimart 异步图像接口包装成 OpenAI 兼容 chat) │
   │ apimart-studio(生图工作台 + 门户;复用同一 MongoDB 校验账号)    │
   └────────────────────────────────────────────────┘
```

服务器:Vultr `149.28.152.211`(Ubuntu 24.04, 3.8GB)。运行目录 `/root/librechat`。
**所有密钥/密码在服务器 `/root/librechat/.env`,不入库。** 本仓库只含脱敏配置与代码。

## 目录内容

| 文件 | 说明 |
|------|------|
| `docker-compose.override.yml` | 叠加在上游 `docker-compose.yml` 上,新增 adapter/studio/caddy 三个服务 + 挂载 |
| `librechat.yaml` | 自定义端点(APImart / DeepSeek / OpenRouter)+ modelSpecs(默认 DeepSeek V4 Pro) |
| `Caddyfile` | chat/draw/app 三域自动 HTTPS;chat 的 Set-Cookie 改写到 `.essjoy.com` |
| `.env.example` | 环境变量模板(密钥占位) |
| `apimart-adapter/` | OpenAI 兼容适配层:对话/Gemini 透传;gpt-image-2、grok 走异步 images 接口拦截轮询 |
| `apimart-studio/` | 生图工作台 + 统一门户;`app.py`(后端)/`index.html`(生图)/`portal.html`(门户) |
| `scripts/create_agents.py` | 批量创建电商智能体并设为全员共享(ACL public) |
| `../../skill/` | 8 个电商技能(SKILL.md),启动时加载、全员只读可见 |

## 模型

- **对话**:`claude-opus-4-8` / `gpt-5.5`(APImart),`deepseek-v4-pro` / `deepseek-v4-flash`(DeepSeek 官方),`x-ai/grok-4.3`(OpenRouter)
- **生图**:`grok-imagine-1.5-apimart`、`gemini-3.1-flash-image-preview`、`gpt-image-2`(APImart;三者均支持参考图,grok 图生图走 `/v1/images/edits`)
- 默认模型 DeepSeek V4 Pro(`modelSpecs` 全列出,可自由切换)

## 从零部署

```bash
# 1. 把本目录文件 + 上游 docker-compose.yml + 上游 .env(填好)放到服务器 /root/librechat
cp .env.example .env && vi .env            # 填密钥(openssl 生成安全密钥)
mkdir -p data-node images uploads logs studio-data caddy-data caddy-config
chown -R 1000:1000 .
# 2. DNS:chat/draw/app.essjoy.com 三条 A 记录 → 服务器 IP(Cloudflare 用灰云/DNS only)
# 3. 放行端口
ufw allow 80,443,3080,8080,8000/tcp
# 4. 起服务(adapter/studio 会 build,caddy 自动签证书)
docker compose up -d
```

## 常用运维

```bash
# 建用户(公开注册已关)。name ≥3 字符
docker exec LibreChat npm run create-user -- user@essjoy.com "姓名" "username" "密码" --email-verified=true

# 批量建电商智能体并共享
ADMIN_EMAIL=admin@yunyi.com ADMIN_PASSWORD=*** \
  cat scripts/create_agents.py | docker exec -i apimart-studio python -

# 加技能:在 skill/<name>/SKILL.md 放好 → docker compose restart api

# 改 librechat.yaml(模型/端点)后必须 restart(up -d 不会重载 bind mount):
docker compose restart api

# 改 Caddyfile 后:docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

# 改 adapter/studio 代码后:docker compose up -d --build apimart-adapter apimart-studio
```

## 坑(务必知道)

1. **调 LibreChat API 必须带浏览器 User-Agent**,否则被 `uaParser` 中间件拦为 `Illegal request`。
2. **模型 id 不要和 LibreChat 内置库撞名**(否则会被路由到 Responses API / 点亮多余服务商)。APImart 端点的对话模型若撞名,在适配层用 `apimart-` 前缀别名映射回真实 id。
3. **改 `librechat.yaml` 用 `docker compose restart api`**,`up -d` 检测不到 bind mount 变化、不会重载。
4. **单点登录**:门户 `apimart-studio` 的 `/api/portal-login` 代理 LibreChat 登录,把 `refreshToken` 等 Cookie 作用域改写到 `.essjoy.com`;Caddy 再把 chat 后续所有 Set-Cookie 也改写到该域,保证登录态稳定。SSO 依赖 HTTPS(Secure Cookie)。
5. **Cloudflare 用灰云**(DNS only),否则 Caddy 签证书/长请求会被边缘干扰。
