import asyncio
import json
import sqlite3
from datetime import datetime, timezone
from time import monotonic

from pydantic import ValidationError

from . import astro_runtime, db, llm, maintenance, reading, tool_availability
from .agent_prompts import Action, FINAL, PLANNER, SKILLS, VOICE, allowed_tools, knowledge, skill_index
from .astro_pack.shared.protocol import input_schemas, tool_catalog
from .context import bounded, build_context, conversation_profiles
from .errors import AgentFailure, describe_error, diagnostic
from .settings import runtime_settings

STAGES = {
    "geocode": ("正在寻找这段故事发生的地方。", "地点的轮廓已经找到。"),
    "natal-chart": ("正在展开出生时刻的星空。", "出生星盘已经展开，接下来寻找与你的问题相关的线索。"),
    "synastry": ("正在对照两片星空，寻找彼此的呼应。", "两张星盘已经相遇，可以开始梳理关系中的联系。"),
    "composite-chart": ("正在描绘这段关系共同的星图。", "关系的组合星图已经呈现。"),
    "transits": ("正在把当下的星空与出生星盘相映照。", "这一时刻的行运资料已经取得。"),
    "transit-calendar": ("正在沿着时间，整理星象变化的节点。", "这段时间的行运节点已经整理完成。"),
    "solar-return": ("正在寻找太阳回到原点时的年度星图。", "太阳返照的年度星图已经展开。"),
    "secondary-progressions": ("正在梳理内在成长的象征节奏。", "次限推运资料已经取得，可以继续观察成长主题。"),
    "sky-events": ("正在查看这段日子里的天空。", "这一段时间的公共星象已经取得。"),
    "sky-event-kinds": ("正在整理可以观察的星象主题。", "可以观察的星象主题已经整理好。"),
    "horoscope": ("正在翻阅这一季节的星座来信。", "通用星座指引已经取得，会与个人星盘分析分开呈现。"),
    "astro-content": ("正在收集这段时光的星象背景。", "通用星象背景已经取得。"),
    "electional-day": ("正在观察这个候选日期的星象条件。", "候选日期的辅助资料已经取得。"),
    "horary-chart": ("正在展开问题被提出时的星空。", "问题时刻的星盘已经展开。"),
    "horary-diagnostics": ("正在核对这张问题星盘适合解读的部分。", "问题星盘的辅助判断资料已经取得。"),
}


def save_message(conversation_id, role, content, profiles=None, images=None, kind="chat", result=None, identity=None):
    message = {"id": identity or db.uid(), "role": role, "content": content, "profiles": profiles or [],
               "images": images or [], "kind": kind, "reading": result, "created_at": db.now()}
    with db.connect() as connection:
        connection.execute("INSERT INTO messages (id,conversation_id,role,content,profiles,images,kind,reading,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
                           (message["id"], conversation_id, role, content, db.dumps(message["profiles"]), db.dumps(message["images"]), kind, db.dumps(result) if result else None, message["created_at"]))
        connection.execute("UPDATE conversations SET updated_at=? WHERE id=?", (message["created_at"], conversation_id))
    return message


def progress(job, text, state="running", identity=None):
    identity = identity or db.uid()
    created = db.now()
    with db.connect() as connection:
        connection.execute("INSERT INTO progress (id,conversation_id,text,state,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,state=excluded.state",
                           (identity, job.conversation_id, text, state, created))
        row = connection.execute("SELECT id,text,state,created_at FROM progress WHERE id=?", (identity,)).fetchone()
    maintenance.notify("progress")
    job.emit("progress", dict(row))
    job.progress_id = identity if state == "running" else None
    return identity


def feedback(job, error, attempt, stage="探索"):
    code, reason = describe_error(error)
    diagnostic(error, stage)
    recoverable = attempt < 3
    suffix = f"第 {attempt}/3 次未完成，正在调整后继续。" if recoverable else "连续三次未能完成，已暂停这一阶段；已有资料仍然保留。"
    text = f"{stage}：{reason.rstrip('。')}。{suffix}"
    try:
        progress(job, text, "error", job.progress_id)
    except sqlite3.Error:
        job.emit("progress", {"id": db.uid(), "text": text, "state": "error", "created_at": db.now()})
    payload = {"message": text, "code": code, "attempt": attempt, "max_attempts": 3, "recoverable": recoverable}
    job.emit("error", payload)
    return {"code": code, "message": reason, "attempt": attempt, "max_attempts": 3}


async def pause(job, seconds=0.6):
    try:
        await asyncio.wait_for(job.stop.wait(), timeout=seconds)
    except asyncio.TimeoutError:
        return
    raise asyncio.CancelledError


def schema_for(tool):
    definitions = input_schemas()["$defs"]
    if tool not in definitions:
        raise AgentFailure("当前工具没有可用的参数说明，请选择其他方式。", "UNKNOWN_TOOL")

    def resolve(value):
        if isinstance(value, dict):
            if "$ref" in value:
                return resolve(definitions[value["$ref"].split("/")[-1]])
            return {key: resolve(child) for key, child in value.items()}
        if isinstance(value, list):
            return [resolve(child) for child in value]
        return value
    reference = {"type": "object", "required": ["profile_id"], "properties": {"profile_id": {"type": "string"}}, "additionalProperties": False}
    if tool == "natal-chart":
        return reference
    schema = resolve(definitions[tool])
    if tool in {"synastry", "composite-chart"}:
        schema["properties"] = {"chart1": reference, "chart2": reference}
    elif tool in astro_runtime.PERSONAL_TOOLS:
        schema["properties"]["natal"] = reference
    return schema


def read_result(conversation_id, action, profiles):
    row = db.tool_result(action.result_id, conversation_id)
    if not row:
        raise AgentFailure("这份结果不属于当前对话或已被删除，请重新选择。", "RESULT_NOT_FOUND")
    original = json.loads(row["result"])
    versions = {p["id"]: p["version"] for p in profiles}
    if any(versions.get(identity) != version for identity, version in original.get("profile_versions", {}).items()):
        raise AgentFailure("人物资料已更新，需要按新资料计算。", "PROFILE_VERSION_CHANGED")
    response = {"result_id": action.result_id, "path": action.path, "source": original.get("source"),
                "status": original.get("status"), "limitations": original.get("limitations", [])}
    if original.get("status") != "ok":
        return {**response, "error": original.get("error") or {"code": "RESULT_NOT_READY", "message": "这份结果没有可读取的数据，请调整后续动作。"}, "value": None}
    value = original
    for key in action.path.split("."):
        if isinstance(value, dict) and key in value:
            value = value[key]
        elif isinstance(value, list) and key.isdigit() and int(key) < len(value):
            value = value[int(key)]
        else:
            available = {"available_fields": list(value)} if isinstance(value, dict) else {"available_range": {"start": 0, "end": len(value) - 1}} if isinstance(value, list) else {}
            return {**response, "status": "error", "error": {"code": "RESULT_FIELD_MISSING",
                    "message": "路径不存在；请按 available_fields 或 available_range 修正，不要重复猜测。", "failed_segment": key, **available}, "value": None}
    if isinstance(value, list):
        value = {"items": value[action.offset:action.offset + action.limit], "total": len(value), "offset": action.offset}
    return {**response, "value": bounded(value, 10000)}


def result_sources(observations):
    sources = {}
    for observation in observations:
        result = observation.get("result")
        if not isinstance(result, dict) or result.get("status") == "error":
            continue
        source = result.get("source")
        if isinstance(source, dict):
            name = source.get("name")
            if name in {"cosmyday", "astroway"}:
                sources[name] = {"name": "CosmyDay" if name == "cosmyday" else "AstroWay",
                                 "url": "https://cosmyday.com" if name == "cosmyday" else "https://api.astroway.info"}
    return list(sources.values())


async def persist_answer(job, result=None, kind="chat"):
    identity = db.uid()
    job.answer_id, job.answer_reading, job.answer_kind = identity, result, kind
    for attempt in range(1, 4):
        try:
            message = save_message(job.conversation_id, "assistant", job.text, kind=kind, result=result, identity=identity)
            job.saved = True
            job.emit("message", message)
            return True
        except sqlite3.Error as error:
            feedback(job, error, attempt, "保存回应")
            if attempt < 3:
                await pause(job)
    job.emit("error", {"message": "这段回应未能保存，请先复制当前文字留存。", "code": "STORAGE_ERROR", "recoverable": False, "attempt": 3, "max_attempts": 3})
    return False


async def final_answer(job, model, user, selected, observations, length_mode, layout):
    sources = result_sources(observations)
    charts = [json.loads(row["payload"]) for row in db.all_rows("SELECT payload FROM charts WHERE conversation_id=? ORDER BY created_at DESC LIMIT 3", (job.conversation_id,))]
    last_error = None
    structured = layout in reading.LAYOUTS
    result = None
    for attempt in range(1, 4):
        if job.stop.is_set():
            raise asyncio.CancelledError
        job.text = ""
        job.emit("reading_reset", {"attempt": attempt})
        identity = progress(job, "正在把星象线索织成这次的解读。" if attempt == 1 else "正在重新整理已经取得的星象，让这次回应完整呈现。")
        try:
            system = VOICE + "\n" + knowledge(selected) + "\n" + (reading.instructions(layout) if structured else FINAL)
            system += "\n回答长度：" + ("简洁，聚焦当前问题。" if length_mode == "concise" or attempt > 1 else "充分解释当前问题，不堆砌无关知识。")
            system += "\n已展示星盘行星：" + db.dumps([{ "chart_id": c["id"], "title": c["title"], "ids": [p["id"] for p in c.get("planets", []) + c.get("outer_planets", [])]} for c in charts])
            if last_error:
                system += "\n上一轮未完成的原因：" + last_error + "。请修正并输出完整内容，不沿用损坏的结构。"
            messages = await build_context(job.conversation_id, model, user, system, observations[-max(2, 8 // attempt):])
            text, last_preview = "", 0.0
            async for chunk in llm.stream(model, user, "reading" if structured else "chat", messages):
                if job.stop.is_set():
                    raise asyncio.CancelledError
                text += chunk
                if structured:
                    if monotonic() - last_preview >= 0.10:
                        value = reading.preview(text, layout)
                        job.text = reading.markdown(value)
                        job.emit("reading_preview", {"reading": value, "attempt": attempt})
                        last_preview = monotonic()
                else:
                    job.text += chunk
                    job.emit("delta", {"text": chunk})
            if structured:
                try:
                    result = reading.validate(llm.extract_json(text), layout, sources)
                except ValidationError as error:
                    problems = error.errors(include_url=False, include_context=False, include_input=False)[:3]
                    fields = "; ".join(".".join(map(str, problem["loc"])) + ": " + problem["type"] for problem in problems)
                    raise AgentFailure("解读字段需要修正（" + fields + "）。", "RESULT_FORMAT") from error
                except ValueError as error:
                    raise AgentFailure("解读JSON或三个段落的id与顺序需要修正。", "RESULT_FORMAT") from error
                job.text = reading.markdown(result)
                job.emit("reading_preview", {"reading": result, "attempt": attempt})
            else:
                for source in sources:
                    if source["url"] not in job.text:
                        text = f"\n\n资料来源：[{source['name']}]({source['url']})。"
                        job.text += text
                        job.emit("delta", {"text": text})
            break
        except asyncio.CancelledError:
            raise
        except Exception as error:
            code, last_error = describe_error(error)
            feedback(job, error, attempt, "整理回应")
            if code == "CONTEXT_LIMIT":
                selected = selected[:1]
            if attempt < 3:
                await pause(job)
            else:
                if job.text.strip():
                    job.text += "\n\n（本次解读未完整完成，请结合进展中的限制阅读。）"
                    await persist_answer(job, kind="partial")
                else:
                    job.text = "这次回应连续三次未能完成：" + last_error + " 已取得的星象资料仍然保留，你可以继续追问。"
                    await persist_answer(job, kind="error")
                return
    if await persist_answer(job, result=result, kind="reading" if structured else "chat"):
        try:
            progress(job, "这次解读已经收好，下一段旅程可以从你的追问开始。", "complete", identity)
        except sqlite3.Error as error:
            diagnostic(error, "更新完成进度")


async def run_agent(job, model, user, length_mode):
    selected, schemas, observations, attempted = [], {}, [], {}
    profiles = conversation_profiles(job.conversation_id)
    unavailable = {"render-chart", "provider-usage"}
    layout, failures, blocked = "chat", 0, False
    initial = progress(job, "正在聆听你的问题，整理这一段星空旅程。")
    try:
        for iteration in range(24):
            if job.stop.is_set():
                raise asyncio.CancelledError
            observation, action = {}, None
            try:
                enabled = tool_availability.available_tools(runtime_settings()) - unavailable
                catalog = {name: spec["description"] for name, spec in tool_catalog().items() if name in enabled}
                schemas = {tool: schema for tool, schema in schemas.items() if tool in enabled}
                system = VOICE + "\n" + PLANNER + "\n当前UTC时间：" + datetime.now(timezone.utc).isoformat()
                system += "\n业务索引：" + db.dumps(skill_index()) + "\n已启用工具：" + db.dumps(catalog)
                system += "\n当前业务：" + db.dumps(selected) + "\n" + knowledge(selected)
                system += "\n费用由管理员配置，不能要求聊天用户配置或授权。页面自动绘图，不调用render-chart。"
                system += "\n已读取工具Schema：" + db.dumps(schemas)
                planner_model = {**model, "max_output_tokens": min(model["max_output_tokens"], 8192)}
                context = await build_context(job.conversation_id, planner_model, user, system, observations)
                raw = await llm.complete(planner_model, user, "planning", context)
                try:
                    action = Action.model_validate(llm.extract_json(raw))
                except (ValueError, ValidationError) as error:
                    raise AgentFailure("下一步计划格式不完整，需要调整。", "ACTION_FORMAT") from error
                if job.stop.is_set():
                    raise asyncio.CancelledError
                if action.action == "respond":
                    layout = action.format
                    break
                observation = {"action": action.model_dump(exclude_defaults=True)}
                if action.action == "load_skills":
                    if not action.skills or any(identity not in SKILLS for identity in action.skills):
                        raise AgentFailure("咨询方向尚未匹配，请从业务索引重新选择。", "SKILL_NOT_FOUND")
                    if selected == list(dict.fromkeys(action.skills)):
                        raise AgentFailure("这个咨询方向已经加载，请继续分析或回答。", "DUPLICATE_ACTION")
                    selected = list(dict.fromkeys(action.skills))
                    schemas = {tool: schema for tool, schema in schemas.items() if tool in allowed_tools(selected)}
                    observation["result"] = {"loaded": selected, "available_tools": sorted(allowed_tools(selected) & enabled)}
                    if initial:
                        progress(job, "问题的方向已经清晰，正在选择适合这次咨询的星象线索。", "complete", initial)
                        initial = None
                elif action.action == "tool_schema":
                    if action.tool not in catalog or action.tool not in allowed_tools(selected):
                        raise AgentFailure("当前咨询方向没有这项能力，请调整方向或使用已有资料。", "TOOL_UNAVAILABLE")
                    if action.tool in schemas:
                        raise AgentFailure("这项计算的参数说明已加载，请继续下一步。", "DUPLICATE_ACTION")
                    schemas[action.tool] = schema_for(action.tool)
                    observation["result"] = {"schema_loaded": action.tool}
                elif action.action == "read_result":
                    observation["result"] = read_result(job.conversation_id, action, profiles)
                    failures = 0
                elif action.action == "tool":
                    if action.tool not in schemas or action.tool not in allowed_tools(selected) or action.tool not in enabled:
                        raise AgentFailure("计算前需要确认对应的咨询方向和参数格式。", "TOOL_NOT_PREPARED")
                    signature = json.dumps([action.tool, action.input], ensure_ascii=False, sort_keys=True)
                    previous = attempted.get(signature)
                    if previous:
                        if previous.get("status") == "ok":
                            observation["result"] = bounded(previous)
                            observations.append(observation)
                            failures = 0
                            continue
                        if (previous.get("error") or {}).get("exhausted") or not (previous.get("error") or {}).get("retryable", False):
                            raise AgentFailure("相同计算已无法继续，请补充资料、调整参数或选择其他分析方式。", "TOOL_ATTEMPTS_EXHAUSTED")
                    start, end = STAGES.get(action.tool, ("正在整理与你有关的星象资料。", "这部分星象资料已经取得。"))
                    identity = progress(job, start)
                    attempted[signature] = {"status": "error", "error": {"code": "RESULT_UNCONFIRMED", "retryable": False, "exhausted": True}}
                    job.computing = True
                    try:
                        result, chart = await astro_runtime.execute(action.tool, action.input, user, job.conversation_id, profiles, stop=job.stop)
                    finally:
                        job.computing = False
                    attempted[signature] = result
                    observation["result"] = bounded(result)
                    if result["status"] != "ok":
                        error = result.get("error") or {}
                        if error.get("exhausted") or error.get("code") in tool_availability.UNAVAILABLE_ERRORS:
                            unavailable.add(action.tool)
                            observation["notice"] = "本轮不再调用此工具，也不更换参数重试。请使用其他可用能力或基于已有资料说明限制并回答。"
                            progress(job, "这部分资料暂不可用，将沿用已取得的线索继续。", "complete", identity)
                            observations.append(observation)
                            failures = 0
                            continue
                        raise AgentFailure(error.get("message") or astro_runtime.public_error(error.get("code")), error.get("code") or "CALCULATION_ERROR")
                    if result.get("cache", {}).get("hit"):
                        end = "这份星象已在此前保存，沿着已有的星图继续。"
                    progress(job, end, "complete", identity)
                    if chart:
                        job.emit("chart", chart)
                    failures = 0
                failures = 0
                observations.append(observation)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failures += 1
                observation["error"] = feedback(job, error, failures, "整理星象")
                observations.append(observation)
                if getattr(error, "code", None) == "CONTEXT_LIMIT":
                    observations = observations[-2:]
                    schemas = {}
                    selected = selected[:1]
                if failures >= 3:
                    blocked = True
                    break
                await pause(job)
        else:
            observations.append({"notice": "本轮动作较多，先回答已取得的资料，剩余部分在后续对话继续。"})
        if job.stop.is_set():
            raise asyncio.CancelledError
        if job.progress_id:
            progress(job, "这一阶段的线索已整理，接下来回应你的问题。", "complete", job.progress_id)
        if blocked:
            last = observations[-1].get("error", {})
            job.text = "这次探索在连续三次调整后仍未完成：" + last.get("message", "当前资料暂时无法继续处理。") + "\n\n已经取得的星盘和资料仍然保留。你可以补充资料或继续提问，我会从已有结果接着分析。"
            await persist_answer(job, kind="error")
            return
        await final_answer(job, model, user, selected, observations, length_mode, layout)
    except asyncio.CancelledError:
        if job.progress_id:
            progress(job, "星空先在这里停留，已经取得的资料会为你保留。", "complete", job.progress_id)
        if job.text.strip() and not job.saved:
            complete_id = getattr(job, "answer_id", None)
            message = save_message(job.conversation_id, "assistant", job.text if complete_id else job.text + "\n\n（本次解读已暂停。）",
                                   kind=getattr(job, "answer_kind", "partial") if complete_id else "partial",
                                   result=getattr(job, "answer_reading", None), identity=complete_id)
            job.saved = True
            job.emit("message", message)
