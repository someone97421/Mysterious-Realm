# 统一工具协议

## 调用形式

唯一入口是 `tools/astro.py`。使用当前系统的 Python 3 解释器，所有全局选项放在命令名之前。计算输入必须是 JSON 对象，可通过 `--input`、`--input-file` 或 `--stdin` 提供。`capabilities` 查询本地工具目录，`schema <工具名>` 查询自包含输入 Schema 与输出包络 Schema，两者均不访问网络。

## 通用出生资料

`chart` 字段统一为 snake_case：

| 字段 | 含义 | 规则 |
|---|---|---|
| `date` | 当地日期 | 有效的 `YYYY-MM-DD` |
| `time` | 当地钟表时间 | `HH:MM` 或 `HH:MM:SS`；时间未知时省略 |
| `time_unknown` | 明确标记时间未知 | 仅本命与时间未知合盘可用；不能与 `time` 同传 |
| `latitude`、`longitude` | 十进制坐标 | 必须提供；地点名称不能替代 |
| `timezone` | IANA 时区或 `auto` | AstroWay 使用；与偏移同时提供时以时区为准 |
| `timezone_offset` | 当时 UTC 偏移 | 单位为小时，支持小数；不是分钟 |
| `house_system` | 宫位制代码 | 默认 `P`，使用 Swiss Ephemeris 字母 |
| `zodiac_type` | 黄道体系 | `tropical` 或 `sidereal` |
| `ayanamsa` | 恒星黄道体系 | 仅与 `sidereal` 同用 |
| `name`、`city` | 显示标签 | 不参与地点解析 |

未提供 `timezone` 与 `timezone_offset` 时，AstroWay 使用 `auto`；CosmyDay 按坐标处理。1970 年前未明确偏移时输出历史时区不确定性。时间未知时保留工具实际返回的限制，不能由上层补出宫位或角度。

## 工具输入摘要

| 工具 | 顶层输入 |
|---|---|
| `geocode` | `query` |
| `natal-chart` | 通用 `chart` 字段 |
| `synastry` | `chart1`、`chart2`，允许明确时间未知 |
| `composite-chart` | `chart1`、`chart2`，均需明确时间 |
| `transits` | `natal`、`transit`；目标含 `date`，可选 `time`、`timezone_offset` |
| `transit-calendar` | `natal`、`start_date`、`end_date`，可选 `max_orb`、`aspect_angles`、`transit_planet_ids` |
| `solar-return` | `natal`、`year`，可选返照所在地 `location` |
| `secondary-progressions` | `natal`、`target`，可选 `converse` |
| `sky-events` | 可选 `days`、`limit`、`min_importance`、`kind`、`from_date` |
| `sky-event-kinds` | 空对象 |
| `horoscope` | `period`，可选 `sign`；月度归档还需 `month` 与 `sign` |
| `astro-content` | `topic`：月相、行运、周展望或月度概览 |
| `electional-day` | 商业启动候选时刻的通用 `chart` 字段，需明确时间 |
| `horary-chart` | 问题时刻与地点的通用 `chart` 字段，需明确时间 |
| `horary-diagnostics` | 与卜卦盘相同的时刻资料；独立调用，独立成本 |
| `render-chart` | `kind` 及对应 `chart`、`natal`+`outer` 或 `chart1`+`chart2`，可选 `options` |
| `provider-usage` | 空对象；查询当前 key 用量 |

目标 `moment` 未提供完整时间时默认 `12:00:00` 与 UTC+0，并返回 `MOMENT_DEFAULTS_APPLIED`。该默认只是明确的目标计算口径，不能用于伪装未知出生时间。

完整约束以 `shared/schemas/inputs.json` 为准；手工校验与 Schema 共同维护，若供应商拒绝字段，应修正适配器而不是绕过校验。

## 输出包络

所有计算命令返回：

- `schema_version`：协议版本。
- `tool`：统一工具名。
- `status`：`ok` 或 `error`。
- `data`：成功数据；失败时固定为 `null`。
- `meta.provider`：实际 Provider，不代表用户指定值。
- `meta.source`：来源、端点路径、文档、获取时间与数据类型；不附带地点查询字符串。
- `meta.calculation`：宫位制、黄道、时区模式等计算口径。
- `meta.cache`：读缓存是否启用、是否写缓存、命中、陈旧、TTL 与过期时间。
- `meta.credits`、`meta.rate_limit`：供应商实际响应头与已知预估值。
- `meta.sandbox`、`meta.is_mock`、`meta.degraded`：沙箱、Mock 与降级标识。
- `warnings`、`uncertainty`：需要保留或传达的警告与不确定性。
- `error`：成功为 `null`；失败含 `code`、`message`、`retryable` 与可选 `details`。

行星、宫位、相位及高级响应中的供应商字段转换为 snake_case。星盘图以 `data.svg` 等实际字段返回，不在本地伪造 SVG。

## 缓存与离线

缓存键包含协议版本、Provider 命名空间、工具及规范化输入的 SHA-256。AstroWay 的 live 与沙箱分开命名空间，Mock 还包含 fixture 路径与修改时间，避免切换数据源后误用旧结果。有效缓存直接命中；`--refresh` 跳过读取并重新请求；`--no-cache` 禁用读写。`ASTRO_CACHE_TTL_SECONDS` 可覆盖允许缓存的工具 TTL，设为 `0` 表示只读已有缓存而不写新缓存；目录中 TTL 为 `0` 的工具不接受覆盖。

`--offline` 禁止真实 Provider 网络访问，只接受已有缓存或显式 Mock。可恢复请求失败时可返回过期缓存，并附加 `STALE_CACHE`、`STALE_DATA` 与 `degraded=true`。鉴权、输入和成本拒绝不通过陈旧缓存绕过。

## 成本与退出码

已知成本在 live 请求前与 `ASTRO_MAX_CREDITS_PER_CALL` 比较。未知成本保持 `null`，需要单独授权。实际扣除以响应头为准。Provider `usage` 查询不缓存，文档声明其读取自身用量免费，但仍需 key。

| 退出码 | 类别 |
|---:|---|
| 0 | 成功 |
| 2 | 输入、JSON 或工具名错误 |
| 3 | 配置或 key 缺失 |
| 4 | Provider、网络或内部错误 |
| 5 | 能力不支持 |
| 6 | 额度授权或成本限制 |
| 7 | 离线缓存缺失 |

CLI stdout 只输出 JSON，日志仅写 stderr 且不记录请求体或密钥。
