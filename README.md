# 小红书内容编译器

一个面向知识型创作者的内容生产工作台，用于把活动笔记、会议复盘或其他长文整理成可发布的小红书精华正文与 3:4 知识卡片。

项目当前是可交互 MVP：已经打通长文输入、语义解析、内容编辑、卡片预览、隐私复核和本地导出流程。项目数据主要保存在当前浏览器，Nubase 数据库、认证和私有存储结构虽已预置，但尚未接入主业务流程。

## 核心流程

1. 创建或切换内容项目。
2. 填写活动信息、目标读者、表达语气和内容约束。
3. 输入不超过 10,000 字符的原始长文。
4. 通过服务端模型完成语义分块与卡片分页；模型不可用时自动使用本地规则回退。
5. 校对核心观点、公开范围和原文来源。
6. 编辑精华正文或完整卡片稿。
7. 切换卡片模板、密度并实时预览。
8. 完成发布前隐私复核。
9. 在浏览器中生成 1080 × 1440 PNG 图片并下载 ZIP 发布包。

## 已实现能力

- 多项目创建、切换和删除
- 浏览器本地自动保存
- 原文字符数、自然段数和预计卡片数统计
- 项目名称、活动信息、目标读者、语气及内容约束编辑
- 服务端 AI 语义拆分
- 无模型配置时的本地分页回退
- 原文句子 ID 保真重组，减少模型改写正文的风险
- 结构化观点编辑、必留和不公开标记
- 精华版标题、正文和话题标签编辑
- 完整卡片逐页编辑与实时预览
- 四套卡片主题与三档排版密度
- 浏览器端 PNG 渲染和 ZIP 打包下载
- 导出前人工隐私确认
- 基础响应式布局

## 当前实现边界

| 能力 | 当前状态 |
| --- | --- |
| 项目、解析结果和卡片保存 | 保存在浏览器 `localStorage` |
| AI 语义解析 | 通过 TanStack Start Server Function 调用 OpenAI 兼容接口 |
| AI 不可用时 | 按自然段和字符预算执行本地回退拆分 |
| PNG 与 ZIP 生成 | 完全在浏览器中完成 |
| 登录与账户体系 | 仅保留 OAuth 回调和运行时基础设施，主界面尚未接入 |
| Nubase 数据库 | 表结构和 RLS 已部署，主业务尚未读写 |
| 私有文件存储 | 存储桶已创建，导出包目前不会上传 |
| 内容版本与导出历史 | 当前仅为页面状态，刷新后不会保留真实历史 |
| 自动化测试 | 尚未覆盖核心业务 |

因此，当前版本适合本地体验、产品演示和工作流验证，不应直接作为多人协作或跨设备生产系统使用。

## 技术栈

- React 19
- TypeScript
- TanStack Router
- TanStack Start
- Vite 8
- Tailwind CSS 4
- Cloudflare Workers
- Nubase / Supabase 兼容客户端
- `html-to-image`
- `JSZip`
- Bun

## 项目结构

```text
Code-2/
├─ backend/
│  └─ nubase/
│     ├─ manifest.json
│     └─ migrations/
│        └─ ...-create-content-compiler-core.sql
├─ packages/
│  └─ vibecoding-tanstack-config/
├─ public/
├─ src/
│  ├─ components/
│  │  └─ ui/                       # shadcn 风格基础组件
│  ├─ integrations/
│  │  └─ nubase/                   # 平台管理的认证、数据库、存储和 AI 适配层
│  ├─ platform/                    # Cloudflare/Nubase 请求处理
│  ├─ routes/
│  │  ├─ __root.tsx               # HTML 外壳和页面元信息
│  │  ├─ index.tsx                # 内容编译器主界面与前端工作流
│  │  └─ auth/callback.tsx         # OAuth 回调页
│  ├─ semantic-cards.server.ts     # 语义拆卡、模型调用和本地回退
│  ├─ server.ts                    # TanStack Start Worker 服务入口
│  └─ styles.css                   # 主界面和卡片主题样式
├─ AGENTS.md                       # 项目开发约束
├─ VIBECODING_BLUEPRINT.md         # 产品范围和设计蓝图
├─ package.json
├─ vite.config.ts
└─ wrangler.jsonc
```

## 本地运行

### 环境要求

- Bun 1.3.14 或兼容版本
- 支持现代 Web API 的浏览器

### 安装依赖

```bash
bun install
```

### 启动开发环境

```bash
bun run dev
```

默认访问地址：

```text
http://localhost:3000
```

如果没有配置模型密钥，结构化解析仍可使用，但会进入本地回退模式。回退模式按自然段和约 240 字的预算拆分内容，不会生成高质量的语义标题。

## 模型配置

语义解析使用 OpenAI Chat Completions 兼容接口。服务端支持以下运行时变量：

| 变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `MODEL_KEY` | 是，启用模型时 | 首选模型密钥 |
| `OPENAI_API_KEY` | 否 | `MODEL_KEY` 的兼容替代项 |
| `MODEL_BASE_URL` | 否 | 接口基础地址，默认 `https://api.openai.com/v1` |
| `MODEL_NAME` | 否 | 模型名称，默认 `gpt-4.1-mini` |

这些变量必须配置在服务端或 Cloudflare Worker 运行环境中，不要放入客户端代码或提交真实密钥。

模型处理策略：

- 原文先拆成带唯一 ID 的句子。
- 模型只返回语义块、分页方案、小标题和可选导语。
- 卡片正文根据句子 ID 从原文重新拼装。
- 重复句子 ID 会被忽略。
- 模型遗漏的句子会追加到本地回退卡片中。
- 模型请求、响应解析或配置失败时，整个任务自动切换到本地回退模式。

## 数据与隐私

### 浏览器本地数据

当前项目工作区写入：

```text
xhs-compiler-workspaces
```

该键位于浏览器 `localStorage`。清除站点数据、切换浏览器或更换设备都会导致项目不可用。

### 模型数据传输

启用模型解析时，原文、项目名称、活动信息、目标读者、语气以及内容约束会发送到所配置的模型服务。部署方应根据所用模型供应商的隐私政策、数据保留策略和合规要求进行说明。

### 已预置后端

Nubase 迁移已经创建：

- `content_projects`
- `content_versions`
- `export_packages`
- 私有存储桶 `content-compiler-exports`
- 基于 `auth.uid()` 的行级访问策略

这些资源尚未被主页面使用。不要仅因为数据库迁移存在，就假定当前数据已经云端持久化。

## 导出包

导出过程由浏览器完成，不依赖服务端生成图片。ZIP 包包含：

```text
manifest.json
title.txt
content.txt
tags.txt
cards/
  card-01.png
  card-02.png
  ...
source/
  original.txt
  structured-content.json
```

卡片图片规格为：

```text
1080 × 1440 PNG
```

`manifest.json` 会记录项目名称、编辑模式、正文字符数、卡片数量、模板、密度、图片规格和生成时间。

## 可用脚本

```bash
# 启动开发服务器
bun run dev

# 生成 TanStack Router 路由树
bun run generate-routes

# 生产构建
bun run build

# 运行测试
bun run test

# 构建并部署到 Cloudflare Workers
bun run deploy
```

## 部署

生产部署目标为 Cloudflare Workers。配置位于 `wrangler.jsonc`，服务入口为 `src/server.ts`。

```bash
bun run deploy
```

部署前需要确认：

- Worker 运行环境已配置模型密钥。
- 如果计划启用 Nubase 登录和数据持久化，相应运行时配置完整。
- 构建产物同时包含客户端资源与服务端入口。
- 没有把服务端密钥暴露给浏览器。

## 已知问题

- AI 解析结果使用句子 ID，当前证据面板主要按段落 ID 查找，重新解析后可能无法正确显示来源。
- 输入页的“输出模式”和编辑器当前模式是两套状态，选择结果不一定自动同步。
- “添加观点”“添加 Block”“删除本页”“搜索”“偏好设置”等部分按钮尚未接入行为。
- 正文字符合规、卡片溢出、末页平衡等检查目前主要是界面提示，尚未全部实现真实检测。
- 版本和导出记录没有按项目持久化。
- “再次下载”会基于当前项目重新生成文件，不是下载当时的历史快照。
- 认证回调已存在，但主界面没有完整登录、注册和会话管理流程。
- 主业务集中在单个路由文件中，后续应拆分为输入、解析、编辑、预览和导出等独立模块。

## 后续优先级建议

1. 修复句子 ID 与段落 ID 的证据映射。
2. 同步输入输出模式与编辑器模式。
3. 实现真实字符、溢出、分页和隐私校验。
4. 将主页面拆分为独立业务组件和状态模块。
5. 接入登录、`content_projects` 和项目级云端持久化。
6. 持久化内容版本和导出快照。
7. 将 AI 调用统一到 Nubase AI 网关。
8. 为原文完整性、语义拆分、项目切换和 ZIP 导出增加自动化测试。

## 开发约束

修改项目前请阅读 `AGENTS.md`。需要特别注意：

- 使用 Bun 执行安装、开发、构建和测试。
- 常规业务从 `src/routes/index.tsx` 或 `src/components` 开始修改。
- 不要手动编辑 `src/routeTree.gen.ts`。
- 不要随意修改 `src/server.ts`、`src/start.ts`、`src/platform` 和 `src/integrations/nubase` 等平台管理文件。
- 服务端逻辑使用 TanStack Start Server Function 或 `.server.ts` 模块。
- 密钥、服务角色凭证和数据库管理逻辑不得进入客户端可访问代码。

## 产品蓝图

更完整的产品目标、设计方向、首版范围和验收标准请参阅：

```text
VIBECODING_BLUEPRINT.md
```
