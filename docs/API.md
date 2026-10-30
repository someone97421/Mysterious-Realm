# 星帷塔罗：前后端接口约定

前端位于 `web/`，React + TypeScript + Vite，开发代理 `/api` 到 `http://127.0.0.1:8000`。后端 Python FastAPI 位于 `server/`。最终产物 `web/dist` 由后端提供静态服务。接口同源，Cookie 会话，前端 fetch 携带 credentials。响应 JSON；错误使用 `{detail: string}`。时间均为 ISO UTC。

## 身份
- `GET /api/auth/me` → `{user: User|null, setup_required: boolean}`
- `POST /api/auth/setup` `{username,password,display_name}` → `{user}`；首次创建管理员，同时登录。
- `POST /api/auth/login` `{username,password}` → `{user}`
- `POST /api/auth/logout` → `{ok:true}`
- `GET /api/config` → `{app_name, model_ready, supports_images, max_upload_mb:10}`，需要登录。
- User: `{id,username,display_name,role:'admin'|'user',is_active,created_at}`。
- 登录成功默认进入新的空白对话，第一次发送才 POST 创建，刷新当前页可以保留当前会话；模型选择不向用户开放。

## 会话与上传
- `GET /api/conversations` → `Conversation[]`，最近优先。
- `POST /api/conversations` `{}` → Conversation。
- `GET /api/conversations/{id}` → `{conversation, messages: Message[], draws: Draw[]}`。
- `PATCH /api/conversations/{id}` `{title}` → Conversation。
- Conversation: `{id,title,created_at,updated_at}`。
- Message: `{id,role:'user'|'assistant',content,reasoning:string,images:Image[],created_at,draw_id?:string|null,kind?:'chat'|'reading'|'proposal'}`；reasoning 保存模型接口实际返回的思考内容，旧记录为空。
- Image: `{id,url,original_name}`。
- `POST /api/uploads` multipart 字段 `file` → Image；PNG/JPEG/WebP，单张最多 10MB，一条消息最多4张。
- `POST /api/conversations/{id}/messages` `{content, image_ids:[]}` → SSE，使用 fetch + ReadableStream（POST 不使用 EventSource）。每个事件均为 `event: 名称\ndata: JSON\n\n`。
- SSE 事件：`user_message` data=Message；`status` data=`{text}`；`delta` data=`{text}`（追加正文）；`preview` data=`{text}`（替换排阵开场的可读预览）；`reading_preview` data=Reading（字段可能为空，以快照方式原位更新解析表格、卡片、综合、行动与结语；重试时保留已完成批次）；`reasoning` data=`{text}`（追加思考，默认折叠展示）；`message` data=最终 Message；`draw` data=Draw；`done` data=`{}`；`error` data=`{message}`。
- 每15秒发送以 `:` 开头的 SSE 注释心跳；客户端忽略注释块。流结束但既未收到 `done` 也未收到 `error` 时，视为意外中断。
- 普通聊天返回 assistant message；需要抽牌时先给浪漫开场和牌阵提案，再发 draw。

## 抽牌
- Draw: `{id,conversation_id,status:'proposed'|'drawn'|'interpreted',question,opening,spread_name,positions:string[],upright_only:boolean,cards:Card[],reading:Reading|null,created_at}`。
- Card: `{id,name_zh,name_en,arcana:'major'|'minor',suit:string|null,orientation:'upright'|'reversed',orientation_zh,image_url,position}`。
- Reading: `{cards:[{card_id,imagery,symbolism,interpretation,advice}],synthesis,actions:string[],closing}`。
- `POST /api/conversations/{cid}/draws/{did}/reveal` `{}` → Draw。真实随机选牌并持久化，重复调用返回原结果，前端负责有仪式感的逐张点选、翻牌。
- `POST /api/conversations/{cid}/draws/{did}/interpret` `{}` → SSE，事件 status / reading_preview / reasoning / message / draw / done / error 同上。生成中与完成后共用 ReadingDetails 版式，最终 draw.reading 覆盖临时字段并持久化。对应 reading 消息保留供上下文使用，界面不重复渲染正文。重试不重复抽牌。
- 一个会话可以有多次抽牌；历史恢复后不自动播放已完成仪式。proposed 显示「开启仪式」；drawn 显示牌面并提供继续解读；interpreted 显示完整解析。
- 牌图优先 `/cards/{card_id}.jpg`，索引可用 `/cards/manifest.json`。没有牌图时仍应有精致、可区分牌名的 fallback。

## 管理（仅 admin）
- `GET /api/admin/users` → User[]。
- `POST /api/admin/users` `{username,display_name,password,role,is_active}` → User。
- `PATCH /api/admin/users/{id}` `{username?,display_name?,password?,role?,is_active?}` → User，password 空白不修改。
- `DELETE /api/admin/users/{id}` → `{ok:true}`，删除账号及其聊天与上传；前端明确确认，自身账号不允许删除／停用／降权，保留管理入口。
- `GET /api/admin/models` → Model[]。
- `POST /api/admin/models` → Model。
- `PATCH /api/admin/models/{id}` → Model。
- `DELETE /api/admin/models/{id}` → `{ok:true}`。
- `POST /api/admin/models/{id}/default` → Model。
- `POST /api/admin/models/{id}/check` → `{ok, message, latency_ms}`。
- Model: `{id,name,provider,base_url,model_id,schema_type:'chat_completions'|'responses'|'anthropic',reasoning_effort:string,reasoning_field:string,supports_images,context_window,compression_threshold,max_output_tokens,is_default,has_api_key,created_at}`。思考预置级别为 none / low / medium / high / xhigh / max，可自定义级别值。reasoning_field 留空沿用协议默认字段；填写点分路径（例如 `reasoning.effort`、`output_config.effort`）时，直接把级别值写到该字段。
- 创建模型请求以上配置字段 + `api_key`，不传 id、has_api_key、created_at；修改时 api_key 省略或空字符串表示保留，不回显密钥。
- provider 为预设名称，仅前端辅助填入 base_url/schema_type，可完全自定义；API Base URL 表示 `/v1` 级前缀，不含具体 endpoint（兼容用户粘贴完整 endpoint）。
- compression_threshold 为 0.3～0.95 的比例，context_window >=4096，max_output_tokens >=256，默认 8192。
- `GET /api/admin/stats?days=30&user_id=&model_id=` → `{totals:{input_tokens,output_tokens,cached_tokens,cache_hit_rate:number|null,requests,estimated_requests},by_user:UsageRow[],by_model:UsageRow[],daily:UsageRow[],recent:UsageEvent[]}`。
- UsageRow: `{label,input_tokens,output_tokens,cached_tokens,cache_hit_rate,requests}`。
- UsageEvent: `{id,created_at,username,model_name,purpose,input_tokens,output_tokens,cached_tokens:number|null,estimated:boolean}`。
- 汇总缓存命中率只用服务提供了完整缓存及Token用量的请求加权计算；混合筛选时未提供缓存数据的请求不进入比例分母。明细 recent 最多返回100条。大牌阵按输出预算分批解读后串联，分批请求都计入 reading 用量。
- cache_hit_rate 是 0～1 或 null；接口未报告 cache 就显示「未提供」。统计包含普通聊天、排阵、解读、压缩和连接检查。

## 体验要求
中文界面；紫色暗调、神秘浪漫，高品质响应式；手机与电脑横竖屏；提示使用 hint / tooltip，不放大段说明。支持图片上传及预览移除、流式文字、错误重试、取消等待时不自动重复抽牌。管理账号卡片 CRUD，模型 CRUD + 默认设置 +连接检查，统计筛选。3D 仪式采用 Three.js，可跳过，支持 reduced-motion，移动端低开销。用户界面不能出现模型管理或模型切换控件；管理员可通过独立入口进入后台。
