# 管理员用量统计页 — 设计文档

日期:2026-06-23
状态:已与用户确认,待实现

## 目标

给管理员一个**独立的「用量统计」页面**,只读地查看各用户的 token 消耗,支持:

- **时间范围筛选**(起止日期)
- **人员筛选**(可选,单个用户;不选则统计全部用户)
- 按 **用户 × 模型** 分组的 token 表格(prompt / completion / 合计)
- 顶部按**模型**的 token 小计卡片
- **趋势折线图**(按天的 token 消耗)

只统计 token。**不**显示金额、**不**统计图片数量、**不**做任何限额/拦截(纯监控)。

## 背景与关键事实

LibreChat 已经在记录所需数据,无需新增"网关"或流量嗅探:

- `transactions.enabled` 默认 `true`,当前 `deploy/yunyi/librechat.yaml` 未关闭它 → 每次对话的 token 消耗已写入 `transactions` 集合。
- `transactions` 每条记录字段(见 `packages/data-schemas/src/schema/transaction.ts`):
  - `user`(ObjectId,索引)、`model`(String,索引)、`tokenType`(`'prompt' | 'completion' | 'credits'`)、`rawAmount`(原始 token 数,消耗为负值)、`createdAt`(索引,timestamps)。
- 聚合维度 `user`、`model`、`createdAt` 均有索引,聚合走索引、单次查询,不把记录拉进内存。

### 数据准确性前提(需在 UI 注明)

对话 token 数来自模型供应商的 usage 上报。走 `apimart-adapter`、把生图包装成 chat 的自定义模型,token 数可能为 0 或偏低。面板需用一行小字注明:**"token 数据来自模型用量上报,部分自定义/图像模型可能偏低"**。本页不统计图片数量(图片在 `files` 集合以 `context: 'image_generation'` 标记,但无模型维度,本版不纳入)。

## 架构

沿用现有「管理员用户管理」(`admin/users`)的三层模式。

### 1. 数据层 — `packages/data-schemas`

在 `src/methods/transaction.ts` 新增两个聚合方法(纯函数,接收 filter,返回结构化结果):

- `getUsageByUserModel(filter)`:对 `transactions` 做聚合
  - `$match`:`{ tokenType: { $in: ['prompt', 'completion'] }, createdAt: { $gte, $lte }, ...(userId ? { user } : {}) }`
  - `$group` by `{ user, model }`,用 `$cond` 按 `tokenType` 分别累加 `|rawAmount|` 到 `promptTokens` / `completionTokens`
  - 返回 `{ user, model, promptTokens, completionTokens }[]`
- `getUsageTimeseries(filter)`:同样 `$match`,`$group` by 按天的日期字符串(`$dateToString`,`'%Y-%m-%d'`),累加 token 总数 → `{ date, totalTokens }[]`

两个方法都通过 `createMethods()` 工厂注入(`src/methods/index.ts`),供 `/api` 的 `db` 使用。

类型(`AdminUsageRow`、`AdminUsageTimeseriesPoint`、`AdminUsageResponse`)定义在 data-schemas 的 `src/types`,并从包导出。先检查是否有可复用的既有类型,避免重复定义。

### 2. 接口层 — `packages/api` + `/api`

- `packages/api/src/admin/usage.ts`:`createAdminUsageHandlers(deps)` 依赖注入工厂,照搬 `admin/users.ts` 写法。
  - `deps`:`{ getUsageByUserModel, getUsageTimeseries, findUsers }`
  - handler `getUsage(req, res)`:
    1. 解析并校验 query:`startDate`、`endDate`(ISO 日期;缺省给合理默认,如近 30 天)、可选 `userId`(校验 ObjectId)、`sort`(`tokens` 降序默认)、分页。
    2. 并行调用 `getUsageByUserModel` 和 `getUsageTimeseries`。
    3. 用 `findUsers` 把行里的 `user` ObjectId 批量解析成 `{ name, email }`(一次 `$in` 查询,避免 N+1)。
    4. 在 JS 里算出**按模型的小计**和**全局合计**。
    5. 返回 `{ rows, perModelTotals, grandTotal, timeseries, range }`。
- `api/server/routes/admin/usage.js`:Express 路由,沿用 `admin/users.js`:
  - `router.use(requireJwtAuth, requireAdminAccess)`
  - `router.get('/', requireReadUsers, handlers.getUsage)`
  - 在 `createAdminUsageHandlers` 注入 `db.getUsageByUserModel`、`db.getUsageTimeseries`、`db.findUsers`。
- 在 `api/server/routes/index.js` 注册 `adminUsage`,挂到 `/api/admin/usage`。

### 3. data-provider 共享层 — `packages/data-provider`

- `src/api-endpoints.ts`:`adminUsage = (params) => \`${BASE_URL}/api/admin/usage?...\``,动态参数用 `encodeURIComponent`。
- `src/data-service.ts`:`getAdminUsage(params): Promise<AdminUsageResponse>`。
- `src/types/`:`AdminUsageResponse` 等类型(若 data-schemas 已定义则复用/re-export,保持单一来源)。
- `src/keys.ts`:`QueryKeys.adminUsage = 'adminUsage'`。

### 4. 前端 — `client`

- `client/src/data-provider/Admin/usage.ts`:`useAdminUsage(params, config)` React Query hook,key 为 `[QueryKeys.adminUsage, params]`,`refetchOnWindowFocus: false`。从 `Admin/index.ts` → `data-provider/index.ts` 导出。
- `client/src/components/Admin/Usage/AdminUsageView.tsx`(+ `index.ts`):
  - 顶部筛选栏:起止日期选择 + 人员选择(复用 `admin/users` 的用户搜索 `searchUsers`,可清空)。
  - 合计区:按模型的 token 小计卡片 + 全局合计。
  - **趋势折线图**:**手写轻量 SVG 折线**(单条线、按天),不引入图表库(client 当前无图表依赖,避免 bundle 膨胀)。备选:引入 `recharts`——默认不选。
  - 明细表:用户 × 模型行,列为 prompt / completion / 合计;支持按合计排序、分页。
  - 数据准确性小字提示。
  - 所有用户可见文案走 `useLocalize()`,只在 `client/src/locales/en/translation.json` 加英文 key(前缀 `com_ui_`),其它语言外部自动化。
- 路由:`client/src/routes/index.tsx` 加 `path: 'admin/usage'`,懒加载 `AdminUsageView`。
- 导航:`client/src/components/UnifiedSidebar/ExpandedPanel.tsx` 参照 `AdminUsersButton` 加一个「用量统计」入口,`requireCapability` 同样走 admin 可见性。

## 权限

复用现有 admin 能力门:`requireJwtAuth` + `requireAdminAccess`(`ACCESS_ADMIN`)+ `requireReadUsers`(`READ_USERS`)。无需新增 capability。

## 数据流

```
前端筛选(时间 + 人员)
  → useAdminUsage → GET /api/admin/usage?startDate&endDate&userId
    → admin/usage.js (鉴权) → createAdminUsageHandlers.getUsage
      → db.getUsageByUserModel + db.getUsageTimeseries (并行,MongoDB 聚合)
      → db.findUsers 批量补用户名
      → JS 算 perModelTotals / grandTotal
    → { rows, perModelTotals, grandTotal, timeseries, range }
  → 表格 + 小计卡片 + SVG 趋势图
```

## 错误处理

- 后端:try/catch + `logger.error('[adminUsage] ...')`,失败返回 500 `{ error }`,沿用 `admin/users.js` 风格。
- query 校验:非法日期 / 非法 `userId` 返回 400;`endDate < startDate` 返回 400。
- 前端:React Query 的 loading / error / success 三态都要渲染(空数据给空态)。

## 测试

按 workspace 用 Jest,遵循 CLAUDE.md「真实逻辑优先、用 `mongodb-memory-server`」:

- `packages/data-schemas`:对 `getUsageByUserModel` / `getUsageTimeseries` 写测试——内存 Mongo 插入真实 transactions,断言分组、时间过滤、用户过滤、prompt/completion 拆分、按天分桶都正确。
- `packages/api`:对 `createAdminUsageHandlers.getUsage` 写测试——注入真实(或薄包装)方法,覆盖默认时间范围、userId 过滤、非法参数 400、聚合后的 perModelTotals/grandTotal。
- `client`:`AdminUsageView` 的 `__tests__`——覆盖 loading / 有数据 / 空数据 / error,断言表格行、模型小计、趋势图渲染。

## 范围之外(本版不做)

- 金额 / 成本展示(库里有 `tokenValue`,后续要再加)。
- 图片数量统计(`files` 集合可数,但无模型维度)。
- 任何限额 / 计费 / 拦截(LibreChat 自带 Balance 系统,需要时再启用,不在本页)。
- CSV / 导出。
- 缓存或预聚合 rollup 表(当前团队规模下按需聚合足够)。

## 涉及文件清单

新增:
- `packages/api/src/admin/usage.ts`
- `api/server/routes/admin/usage.js`
- `client/src/data-provider/Admin/usage.ts`
- `client/src/components/Admin/Usage/AdminUsageView.tsx`
- `client/src/components/Admin/Usage/index.ts`

修改:
- `packages/data-schemas/src/methods/transaction.ts`(+ 方法导出 / 类型)
- `packages/data-schemas/src/methods/index.ts`(注入新方法)
- `packages/data-provider/src/{api-endpoints,data-service,keys}.ts` + `types/`
- `api/server/routes/index.js`(注册 adminUsage)
- `client/src/data-provider/Admin/index.ts`、`client/src/data-provider/index.ts`
- `client/src/routes/index.tsx`(加路由)
- `client/src/components/UnifiedSidebar/ExpandedPanel.tsx`(加入口按钮)
- `client/src/locales/en/translation.json`(英文 key)
