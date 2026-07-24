# MVP+1 核心体验优化计划

> **目标**: 从「能跑」到「好用」,为演示/试用做准备  
> **预计工作量**: 12-16 小时(2-3 个工作日)  
> **开始时间**: 2026-07-23

---

## 一、UI 设计优化(前端体验提升)

### 1.1 对话界面优化 ⭐⭐⭐

**当前问题**:
- 消息气泡样式单调(纯色背景)
- 工具调用卡片视觉层次不明显
- 长会话滚动性能差(无虚拟滚动)
- 输入框缺少快捷功能(清空、多行输入提示)

**优化任务**:

#### 1.1.1 消息气泡美化 (1-2h)
- [ ] 用户消息:渐变背景(品牌色 `#eb3f00` → 浅橙),圆角气泡
- [ ] 助手消息:卡片样式,带左侧头像栏(员工 avatar)
- [ ] Markdown 渲染优化:代码块语法高亮(已有 highlight.js,需调整主题)
- [ ] 时间戳显示:hover 显示完整时间(yyyy-MM-dd HH:mm:ss)

#### 1.1.2 工具调用卡片重设计 (2-3h)
- [ ] **调用中状态**:骨架屏 + 加载动画(旋转图标)
- [ ] **成功状态**:绿色左边框 + 折叠面板(默认收起参数/结果,点击展开)
- [ ] **失败状态**:红色左边框 + 错误图标,展开显示错误详情
- [ ] 工具图标库:为常见工具添加图标(🔍 搜索 / 📊 数据分析 / 📝 文案生成)

#### 1.1.3 输入框增强 (1h)
- [ ] 多行输入支持:`Shift+Enter` 换行,`Enter` 发送
- [ ] 字数统计:实时显示字符数(右下角灰色小字)
- [ ] 快捷按钮:清空输入框按钮(× 图标)
- [ ] 占位符动态提示:根据员工能力提示(「试试问我:查询北京天气」)

#### 1.1.4 会话列表优化 (1h)
- [ ] 最近消息预览:显示最后一条消息的前 20 字
- [ ] 未读标记:新消息会话显示红点
- [ ] 搜索框:按会话名称搜索
- [ ] 固定/归档:右键菜单支持置顶/归档会话

**工作量**: 5-7 小时

---

### 1.2 员工广场/能力市场视觉升级 ⭐⭐

**当前问题**:
- 卡片设计过于朴素(白底黑字)
- 缺少视觉吸引力(无渐变、阴影、悬停效果)
- 行业/岗位标签不够醒目

**优化任务**:

#### 1.2.1 员工卡片重设计 (2-3h)
- [ ] 卡片悬停效果:阴影加深 + 轻微上移(`transform: translateY(-4px)`)
- [ ] Avatar 优化:圆形头像带彩色边框(根据行业配色)
- [ ] 行业标签:彩色徽章(电商→橙色、金融→蓝色、医疗→绿色)
- [ ] 价格显示:大号加粗 + 「/月」小字
- [ ] 「已订阅」状态:金色边框 + 右上角勋章图标

#### 1.2.2 能力卡片设计 (1-2h)
- [ ] 类型图标:AGENT 🤖 / SKILL ⚡ / RPA 🔄 / AI_APP 📱
- [ ] 平台标识:Coze/OpenCode/N8N logo 小图标(右上角)
- [ ] 状态徽章:待审核(黄色) / 已通过(绿色) / 已拒绝(红色),带圆点动画

#### 1.2.3 筛选/排序优化 (1h)
- [ ] 侧边栏筛选面板:行业/岗位/价格区间复选框
- [ ] 顶部排序下拉框:最新上架 / 最受欢迎 / 价格升序/降序
- [ ] 「重置筛选」按钮

**工作量**: 4-6 小时

---

### 1.3 管理端界面专业化 ⭐⭐

**当前问题**:
- 表格样式单调(无斑马纹)
- 操作按钮拥挤(编辑/删除图标太小)
- 表单布局松散

**优化任务**:

#### 1.3.1 表格美化 (1-2h)
- [ ] 斑马纹行背景(`odd:bg-muted/20`)
- [ ] 悬停高亮(`hover:bg-muted/40`)
- [ ] 固定表头(长列表滚动时表头不动)
- [ ] 空状态插画:无数据时显示友好插图 + 提示文案

#### 1.3.2 表单优化 (1-2h)
- [ ] 必填标记:红色星号 `*` 统一放标签右侧
- [ ] 字段帮助文本:灰色小字说明(放在输入框下方)
- [ ] 表单分组:用 `<fieldset>` + 标题分隔不同区域
- [ ] 保存按钮状态:保存中显示加载动画

#### 1.3.3 操作确认弹窗 (1h)
- [ ] 删除确认:模态框显示「确定删除 XXX 吗?此操作不可撤销」
- [ ] 危险操作:按钮红色 + 二次确认(需输入名称确认)

**工作量**: 3-5 小时

---

### 1.4 全局 UI 细节打磨 ⭐

**优化任务**:

#### 1.4.1 加载状态统一 (1h)
- [ ] 骨架屏组件库扩充(列表/卡片/表单)
- [ ] 全局 loading 遮罩(页面切换时顶部进度条)
- [ ] 按钮加载态:禁用 + 旋转图标

#### 1.4.2 错误提示友好化 (1h)
- [ ] Toast 通知组件:成功(绿)、警告(黄)、错误(红),右上角 3 秒自动消失
- [ ] 替换所有 `alert()`:改用 Toast
- [ ] 错误页面:404/500 带返回首页按钮

#### 1.4.3 响应式适配 (2h)
- [ ] 移动端适配:侧边栏折叠为汉堡菜单
- [ ] 表格在移动端转为卡片列表
- [ ] 对话输入框在小屏下全宽

#### 1.4.4 暗色模式(可选) (3-4h)
- [ ] CSS 变量切换(`:root[data-theme="dark"]`)
- [ ] 顶部栏主题切换按钮(月亮/太阳图标)
- [ ] 所有颜色适配暗色(背景 `#1a1a1a`,文字 `#e5e5e5`)

**工作量**: 4-8 小时(含暗色模式)

---

## 二、后端功能完善

### 2.1 OpenCode Skills Service 对接 ⭐⭐⭐

**现状**: `opencode.adapter.ts` 已存在,但 `OPENCODE_API_BASE_URL` 未配置,工具调用返回 `not_implemented`

**任务**:

#### 2.1.1 环境变量与配置 (0.5h)
- [ ] `.env.example` 和 `.env` 新增:
  ```bash
  OPENCODE_API_BASE_URL="http://localhost:8000"  # OpenCode 服务端点
  OPENCODE_API_KEY=""                             # 可选鉴权
  ```
- [ ] `opencode.adapter.ts` 读取配置,替换硬编码占位符

#### 2.1.2 HTTP 调用逻辑 (1-2h)
- [ ] 参考 OpenCode API 文档,补充 `POST /skills/{skillName}/execute` 调用
- [ ] 请求格式:
  ```json
  {
    "input": "搜索关键词",
    "sessionId": "xxx"
  }
  ```
- [ ] 响应解析:提取 `output` 字段返回
- [ ] 错误处理:超时/404/500 统一包装为 `AdapterExecutionResult.error`

#### 2.1.3 测试验证 (0.5h)
- [ ] 本地启动 OpenCode 服务(或 mock 服务)
- [ ] 创建测试能力绑定到员工
- [ ] 对话触发工具调用,验证结果正确返回

**工作量**: 2-3 小时

---

### 2.2 计费落库 ⭐⭐⭐

**现状**: `conversation-stream.service.ts` 已收集 `usage`,写入了 `Message.inputTokens/outputTokens`,但未落 `ComputeTransaction`

**任务**:

#### 2.2.1 Schema 确认 (检查即可)
- [x] `ComputeAccount` 表已存在(用户余额账户)
- [x] `ComputeTransaction` 表已存在(消费记录)

#### 2.2.2 计费逻辑实现 (2-3h)
- [ ] 新建 `backend/src/modules/billing/billing.service.ts`
- [ ] 方法 `recordUsage(userId, modelId, inputTokens, outputTokens)`:
  1. 根据 `modelId` 查表获取单价(硬编码 Map 或新增 `ModelPricing` 表)
  2. 计算费用:`cost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1M`
  3. 插入 `ComputeTransaction` 记录
  4. 更新 `ComputeAccount.balance` (扣费)
- [ ] `conversation-stream.service.ts` 在消息保存后调用 `billingService.recordUsage()`

#### 2.2.3 价格配置 (1h)
- [ ] 新建 `backend/src/shared/index.ts` 导出 `MODEL_PRICING`:
  ```typescript
  export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    'deepseek-v4-flash': { input: 0.1, output: 0.3 },  // 单位: ¥/百万token
    'gpt-4o': { input: 5, output: 15 },
    // ...
  };
  ```
- [ ] 前端镜像到 `web/src/lib/models.ts`

#### 2.2.4 查询接口 (1h)
- [ ] `GET /users/me/compute-usage?startDate=&endDate=` 返回:
  ```json
  {
    "totalCost": 12.34,
    "totalTokens": 1234567,
    "transactions": [
      {
        "createdAt": "2026-07-23T10:00:00Z",
        "modelId": "deepseek-v4-flash",
        "inputTokens": 100,
        "outputTokens": 500,
        "cost": 0.18
      }
    ]
  }
  ```
- [ ] 前端「个人设置」新增「用量统计」tab,显示图表(可选:用 recharts)

**工作量**: 4-5 小时

---

### 2.3 错误处理优化 ⭐⭐

**任务**:

#### 2.3.1 统一错误码 (1h)
- [ ] 新建 `backend/src/shared/error-codes.ts`:
  ```typescript
  export const ErrorCode = {
    MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
    CAPABILITY_EXECUTION_FAILED: 'CAPABILITY_EXECUTION_FAILED',
    INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
    // ...
  } as const;
  ```
- [ ] 自定义异常类 `BusinessException(code, message)`
- [ ] 全局异常过滤器返回统一格式:
  ```json
  {
    "code": "MODEL_NOT_FOUND",
    "message": "模型 deepseek-chat 不存在",
    "timestamp": "2026-07-23T10:00:00Z"
  }
  ```

#### 2.3.2 前端错误处理 (1h)
- [ ] API Client 拦截器:识别 `code` 字段,映射到中文提示
- [ ] Toast 组件显示错误(替换 `alert`)
- [ ] 对话界面:AI 回复错误时,显示红色错误卡片(而非空白)

**工作量**: 2 小时

---

### 2.4 结构化日志 ⭐

**任务**:

#### 2.4.1 引入 Winston (1h)
- [ ] 安装 `winston` + `winston-daily-rotate-file`
- [ ] 配置日志级别:开发 `debug`,生产 `info`
- [ ] 日志格式:JSON(包含 `timestamp`, `level`, `message`, `context`, `trace`)
- [ ] 文件输出:`logs/app-%DATE%.log`,按天轮转

#### 2.4.2 关键节点日志 (1h)
- [ ] 用户登录/注册
- [ ] AI 调用开始/结束(记录 `modelId`, `tokens`, `duration`)
- [ ] 工具调用开始/结束(记录 `capabilityId`, `success`)
- [ ] 错误日志(记录完整堆栈)

**工作量**: 2 小时

---

### 2.5 性能优化 ⭐

**任务**:

#### 2.5.1 Redis 缓存 (2h)
- [ ] 员工列表缓存:TTL 5 分钟,key `employees:published`
- [ ] 能力列表缓存:TTL 5 分钟,key `capabilities:approved`
- [ ] 缓存失效:创建/更新/删除员工/能力时主动清除
- [ ] `CacheService` 封装 `get/set/del` 方法

#### 2.5.2 分页优化 (1h)
- [ ] 所有列表接口支持 `?page=1&limit=20`(当前硬编码 `limit=50`)
- [ ] 返回格式统一:
  ```json
  {
    "items": [...],
    "total": 100,
    "page": 1,
    "limit": 20,
    "hasMore": true
  }
  ```
- [ ] 前端无限滚动或分页器组件

**工作量**: 3 小时

---

## 三、生产环境配置 ⭐

### 3.1 Docker 镜像 (2-3h)

#### 3.1.1 后端 Dockerfile
- [ ] 多阶段构建:
  ```dockerfile
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package.json pnpm-lock.yaml ./
  RUN npm i -g pnpm && pnpm install --frozen-lockfile
  COPY . .
  RUN pnpm build
  
  FROM node:20-alpine
  WORKDIR /app
  COPY --from=builder /app/dist ./dist
  COPY --from=builder /app/node_modules ./node_modules
  EXPOSE 3001
  CMD ["node", "dist/main.js"]
  ```

#### 3.1.2 前端 Dockerfile
- [ ] Next.js standalone 构建:
  ```dockerfile
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package.json pnpm-lock.yaml ./
  RUN npm i -g pnpm && pnpm install --frozen-lockfile
  COPY . .
  RUN pnpm build
  
  FROM node:20-alpine
  WORKDIR /app
  COPY --from=builder /app/.next/standalone ./
  COPY --from=builder /app/.next/static ./.next/static
  COPY --from=builder /app/public ./public
  EXPOSE 3000
  CMD ["node", "server.js"]
  ```

#### 3.1.3 docker-compose.prod.yml
- [ ] 包含:backend / web / postgres / redis / nginx
- [ ] Nginx 反向代理:
  - `/` → 前端(3000)
  - `/api` → 后端(3001)
  - SSL 证书挂载

**工作量**: 2-3 小时

---

### 3.2 环境变量模板 (0.5h)

- [ ] `.env.production.example`:
  ```bash
  # 生产数据库(外部 RDS 或独立容器)
  DATABASE_URL="postgresql://user:pass@db.example.com:5432/sep_prod"
  
  # Redis(外部或独立容器)
  REDIS_URL="redis://redis.example.com:6379"
  
  # 后端
  NODE_ENV=production
  PORT=3001
  JWT_SECRET=<生成强随机密钥>
  
  # AI 集成
  SUB2API_BASE_URL=https://api.sub2api.com/v1
  SUB2API_API_KEY=<生产环境密钥>
  SUB2API_DEFAULT_MODEL=deepseek-v4-flash
  
  COZE_API_BASE=https://api.coze.cn
  COZE_PAT=<生产环境 PAT>
  
  OPENCODE_API_BASE_URL=https://opencode.example.com
  ```

**工作量**: 0.5 小时

---

## 四、任务优先级与里程碑

### 里程碑 1:UI 体验提升(5-7h)
- [x] 对话界面优化(气泡/工具卡片/输入框)
- [x] 员工广场视觉升级
- [x] 全局加载/错误状态优化

**交付**: 演示级 UI,适合截图/录屏

---

### 里程碑 2:功能完整性(6-8h)
- [x] OpenCode 对接
- [x] 计费落库
- [x] 错误处理优化

**交付**: 业务闭环完整,可试运行

---

### 里程碑 3:生产就绪(2-3h)
- [x] Docker 镜像
- [x] 环境变量模板
- [x] 日志/缓存/性能优化

**交付**: 可部署到生产环境

---

## 五、可选/延后项

- [ ] 暗色模式(+3-4h)
- [ ] 用量统计图表(recharts,+2h)
- [ ] 移动端深度适配(+4-5h)
- [ ] 管理端数据看板(员工/能力/订阅统计,+3h)

---

**总工作量预估**: 12-16 小时(不含可选项)  
**建议排期**: 分 3 个半天完成,每完成一个里程碑就部署测试

**下一步**: 从里程碑 1 的对话界面优化开始?
