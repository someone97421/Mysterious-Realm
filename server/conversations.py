import asyncio
import contextlib
import json
import logging
import re
import sqlite3
from dataclasses import dataclass, field
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from . import auth, db, llm, tarot
from .agent import run_agent, save_message
from .context import build_context
from .profiles import get_snapshots
from .schemas import ConversationCreate, Plan, Reading, ReadingOverview, Rename, ResponseOptions, SendMessage
from .streaming import readable_preview, reading_preview

router = APIRouter(prefix="/api/conversations")
_busy = set()
RUNS = {}
MENTION = re.compile(r"@\[([^\]\r\n]*)\]\(profile:([a-f0-9]{32})\)")


@dataclass
class Job:
    conversation_id: str
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    computing: bool = False
    connected: bool = True
    text: str = ""
    saved: bool = False
    answer_id: str | None = None
    answer_reading: dict | None = None
    answer_kind: str = "chat"
    progress_id: str | None = None

    def emit(self, event, payload):
        if self.connected:
            self.queue.put_nowait((event, payload))

    def request_stop(self):
        self.stop.set()
        if self.task and not self.computing and not self.task.done():
            self.task.cancel()


def conversation_owned(conversation_id, user):
    row = db.one("SELECT * FROM conversations WHERE id=? AND user_id=?", (conversation_id, user["id"]))
    if not row:
        raise HTTPException(404, "对话不存在")
    return row


def require_mode(conversation, mode):
    if conversation["mode"] != mode:
        label = "塔罗" if conversation["mode"] == "tarot" else "占星"
        raise HTTPException(409, f"这段对话属于{label}模式，请切换到对应模式后继续")


def public_conversation(row):
    return {key: row[key] for key in ("id", "title", "mode", "created_at", "updated_at")}


def public_message(row):
    return {
        **{key: row[key] for key in ("id", "role", "content", "created_at", "draw_id", "kind", "reasoning") if key in row},
        "images": json.loads(row.get("images") or "[]"),
        "profiles": json.loads(row.get("profiles") or "[]"),
        "reading": json.loads(row["reading"]) if row.get("reading") else None,
    }


def public_draw(row):
    return {**row, "positions": json.loads(row["positions"]), "cards": json.loads(row["cards"]),
            "upright_only": bool(row["upright_only"]), "reading": json.loads(row["reading"]) if row["reading"] else None}


def draw_owned(conversation_id, draw_id, user):
    conversation = conversation_owned(conversation_id, user)
    require_mode(conversation, "tarot")
    row = db.one("SELECT * FROM draws WHERE id=? AND conversation_id=?", (draw_id, conversation_id))
    if not row:
        raise HTTPException(404, "牌阵不存在")
    return row


def supports_model(model, mode):
    return model and model.get("mode_scope", "both") in ("both", mode)


def default_model(mode):
    mode_column = "is_default_tarot" if mode == "tarot" else "is_default_astrology"
    model = db.one(f"SELECT * FROM models WHERE {mode_column}=1 AND mode_scope IN ('both',?) ORDER BY created_at DESC LIMIT 1", (mode,))
    if model:
        return model
    model = db.one("SELECT * FROM models WHERE is_default=1 AND mode_scope IN ('both',?) LIMIT 1", (mode,))
    if model:
        return model
    model = db.one("SELECT * FROM models WHERE mode_scope IN ('both',?) ORDER BY created_at DESC LIMIT 1", (mode,))
    if not model:
        raise HTTPException(409, f"{('塔罗' if mode == 'tarot' else '占星')}模式尚未绑定可用模型，请联系管理员配置")
    return model


def insert_message(connection, conversation_id, role, content, images=None, draw_id=None, kind="chat", reasoning=""):
    message = dict(id=db.uid(), role=role, content=content, images=images or [], draw_id=draw_id,
                   kind=kind, reasoning=reasoning, created_at=db.now())
    connection.execute("""INSERT INTO messages (id,conversation_id,role,content,images,draw_id,kind,created_at,reasoning)
                          VALUES (?,?,?,?,?,?,?,?,?)""",
                       (message["id"], conversation_id, role, content, db.dumps(message["images"]), draw_id,
                        kind, message["created_at"], reasoning))
    connection.execute("UPDATE conversations SET updated_at=? WHERE id=?", (message["created_at"], conversation_id))
    return message


def sse(event, data):
    return f"event: {event}\ndata: {db.dumps(data)}\n\n"


def stream_response(conversation_id, iterator):
    if conversation_id in _busy:
        raise HTTPException(409, "这个对话正在回应，请稍候再试")
    _busy.add(conversation_id)

    async def with_heartbeat():
        pending = None
        try:
            while True:
                pending = asyncio.create_task(anext(iterator))
                while not (await asyncio.wait({pending}, timeout=15))[0]:
                    yield ": 秘域仍在回应\n\n"
                try:
                    event = pending.result()
                except StopAsyncIteration:
                    break
                yield event
        finally:
            if pending and not pending.done():
                pending.cancel()
                with contextlib.suppress(asyncio.CancelledError, StopAsyncIteration):
                    await pending
            if pending is None or pending.done():
                await iterator.aclose()

    class GuardedResponse(StreamingResponse):
        async def __call__(self, scope, receive, send):
            try:
                await super().__call__(scope, receive, send)
            finally:
                _busy.discard(conversation_id)

    return GuardedResponse(with_heartbeat(), media_type="text/event-stream",
                           headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def structured(model, user, purpose, messages, schema, trace, card_ids=None, previous_cards=None, include_overview=True):
    def preview_event(text):
        if purpose == "reading":
            return "reading_preview", reading_preview(text, card_ids or [], previous_cards or [], include_overview)
        return "preview", {"text": readable_preview(text)}

    for attempt in range(2):
        text, previous_preview = "", None
        last_preview_at = 0
        yield preview_event("")
        if trace:
            separator = "\n\n——重新生成——\n\n" if attempt else "\n\n——下一阶段——\n\n"
            trace.append(separator)
            yield "reasoning", {"text": separator}
        async for chunk in llm.stream(model, user, purpose, messages, include_reasoning=True):
            if chunk["type"] == "reasoning":
                trace.append(chunk["text"])
                yield "reasoning", {"text": chunk["text"]}
            else:
                text += chunk["text"]
                if monotonic() - last_preview_at >= 0.06:
                    last_preview_at = monotonic()
                    preview = preview_event(text)
                    if preview != previous_preview:
                        previous_preview = preview
                        yield preview
        preview = preview_event(text)
        if preview != previous_preview:
            yield preview
        try:
            value = schema.model_validate(llm.extract_json(text))
            if card_ids is not None and [card.card_id for card in value.cards] != card_ids:
                raise ValueError("牌序不匹配")
            yield "result", value
            return
        except (ValueError, ValidationError):
            if attempt:
                raise llm.ModelError("模型未能返回完整且对应牌面的解析，请重试或联系管理员调整模型／输出预算")
            yield "status", {"text": "正在重新整理解读格式…"}
            messages = [*messages, {"role": "user", "content": "上一轮结构未通过校验。请重新生成完整JSON，严格遵守要求，字段齐全；如在解读，cards数量、card_id及顺序必须与固定结果完全一致。"}]


@router.get("")
def list_conversations(user=Depends(auth.current_user)):
    return [public_conversation(row) for row in db.all_rows(
        "SELECT * FROM conversations WHERE user_id=? ORDER BY updated_at DESC", (user["id"],)
    )]


@router.post("")
def create_conversation(body: ConversationCreate | None = None, user=Depends(auth.current_user)):
    mode = body.mode if body else "tarot"
    title = "新的祈愿" if mode == "tarot" else "新的星空来信"
    created = db.now()
    row = dict(id=db.uid(), title=title, mode=mode, created_at=created, updated_at=created)
    db.execute("INSERT INTO conversations (id,user_id,title,mode,created_at,updated_at) VALUES (?,?,?,?,?,?)",
               (row["id"], user["id"], title, mode, created, created))
    return row


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, user=Depends(auth.current_user)):
    conversation = conversation_owned(conversation_id, user)
    messages = [public_message(message) for message in db.all_rows(
        "SELECT * FROM messages WHERE conversation_id=? ORDER BY seq", (conversation_id,)
    )]
    return {
        "conversation": public_conversation(conversation),
        "messages": messages,
        "draws": [public_draw(draw) for draw in db.all_rows(
            "SELECT * FROM draws WHERE conversation_id=? ORDER BY created_at", (conversation_id,)
        )] if conversation["mode"] == "tarot" else [],
        "charts": [json.loads(row["payload"]) for row in db.all_rows(
            "SELECT payload FROM charts WHERE conversation_id=? ORDER BY created_at", (conversation_id,)
        )] if conversation["mode"] == "astrology" else [],
        "progress": db.all_rows(
            "SELECT * FROM (SELECT id,text,state,created_at FROM progress WHERE conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 200) ORDER BY created_at,id", (conversation_id,)
        ) if conversation["mode"] == "astrology" else [],
        "active": conversation_id in RUNS,
    }


@router.patch("/{conversation_id}")
def rename_conversation(conversation_id: str, body: Rename, user=Depends(auth.current_user)):
    conversation_owned(conversation_id, user)
    db.execute("UPDATE conversations SET title=?,updated_at=? WHERE id=?", (body.title, db.now(), conversation_id))
    return public_conversation(conversation_owned(conversation_id, user))


def _conversation_files(connection, conversation_id, user_id):
    images = set()
    for row in connection.execute("SELECT images FROM messages WHERE conversation_id=?", (conversation_id,)):
        images.update(image["id"] for image in json.loads(row["images"] or "[]"))
    connection.execute("DELETE FROM conversations WHERE id=? AND user_id=?", (conversation_id, user_id))
    if not images:
        return []
    for row in connection.execute("SELECT m.images FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=?", (user_id,)):
        images.difference_update(image["id"] for image in json.loads(row["images"] or "[]"))
    files = []
    for image_id in images:
        image = connection.execute("SELECT filename FROM uploads WHERE id=? AND user_id=?", (image_id, user_id)).fetchone()
        if image:
            files.append(image["filename"])
            connection.execute("DELETE FROM uploads WHERE id=? AND user_id=?", (image_id, user_id))
    return files


@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: str, user=Depends(auth.current_user)):
    conversation = conversation_owned(conversation_id, user)
    if conversation_id in _busy:
        raise HTTPException(409, "这个对话正在回应，请先停止生成或等回应结束后删除")
    if job := RUNS.get(conversation_id):
        job.request_stop()
    from .config import UPLOAD_DIR
    files = []
    with db.connect() as connection:
        files = _conversation_files(connection, conversation_id, user["id"])
    for filename in files:
        try:
            (UPLOAD_DIR / filename).unlink(missing_ok=True)
        except OSError:
            logging.getLogger(__name__).warning("对话已删除，上传文件清理失败", exc_info=True)
    return {"ok": True}


@router.post("/{conversation_id}/stop")
async def stop_conversation(conversation_id: str, user=Depends(auth.current_user)):
    conversation_owned(conversation_id, user)
    if job := RUNS.get(conversation_id):
        job.request_stop()
    return {"ok": True}


@router.post("/{conversation_id}/messages")
async def send_message(conversation_id: str, body: SendMessage, user=Depends(auth.current_user)):
    conversation = conversation_owned(conversation_id, user)
    if conversation["mode"] == "astrology":
        return await send_astrology_message(conversation, body, user)
    require_mode(conversation, "tarot")
    if body.profile_ids:
        raise HTTPException(400, "塔罗对话不能引用占星人物")
    return await send_tarot_message(conversation, body, user)


async def send_tarot_message(conversation, body, user):
    conversation_id = conversation["id"]
    model = default_model("tarot")
    if body.image_ids and not model["supports_images"]:
        raise HTTPException(400, "当前服务暂不支持图片，请移除图片后发送")
    images = []
    for image_id in dict.fromkeys(body.image_ids):
        image = db.one("SELECT * FROM uploads WHERE id=? AND user_id=?", (image_id, user["id"]))
        if not image:
            raise HTTPException(404, "上传的图片不存在，请重新添加")
        images.append({"id": image_id, "url": f"/api/uploads/{image_id}", "original_name": image["original_name"]})

    async def events():
        try:
            latest = db.one("SELECT * FROM messages WHERE conversation_id=? ORDER BY seq DESC LIMIT 1", (conversation_id,))
            if latest and latest["role"] == "user" and latest["content"] == body.content and json.loads(latest["images"] or "[]") == images:
                message = public_message(latest)
            else:
                with db.connect() as connection:
                    message = insert_message(connection, conversation_id, "user", body.content, images)
                    if conversation["title"] == "新的祈愿":
                        connection.execute("UPDATE conversations SET title=?,updated_at=? WHERE id=?", ((body.content or "一封来自画面的祈愿")[:38], message["created_at"], conversation_id))
            yield sse("user_message", message)
            yield sse("status", {"text": "正在聆听你的祈愿，整理星象与牌阵…"})
            context = await build_context(conversation_id, model, user, tarot.PLAN_PROMPT + tarot.length_instruction(body.length_mode, "planning"), mode="tarot")
            trace = []
            async for event, value in structured(model, user, "planning", context, Plan, trace):
                if event == "result":
                    plan = value
                else:
                    yield sse(event, value)
            if plan.mode == "draw":
                draw_id = db.uid()
                with db.connect() as connection:
                    connection.execute("""INSERT INTO draws (id,conversation_id,question,opening,spread_name,positions,upright_only,created_at)
                                          VALUES (?,?,?,?,?,?,?,?)""",
                                       (draw_id, conversation_id, plan.question, plan.opening, plan.spread_name,
                                        db.dumps(plan.positions), int(plan.upright_only), db.now()))
                    message = insert_message(connection, conversation_id, "assistant", plan.opening, draw_id=draw_id, kind="proposal", reasoning="".join(trace))
                yield sse("message", public_message({**message, "images": "[]", "profiles": "[]", "reading": None}))
                yield sse("draw", public_draw(db.one("SELECT * FROM draws WHERE id=?", (draw_id,))))
            else:
                yield sse("status", {"text": "正在为你整理回应…"})
                yield sse("preview", {"text": ""})
                if trace:
                    trace.append("\n\n——回应——\n\n")
                    yield sse("reasoning", {"text": trace[-1]})
                context = await build_context(conversation_id, model, user, tarot.VOICE + tarot.length_instruction(body.length_mode, "chat"), mode="tarot")
                parts = []
                async for chunk in llm.stream(model, user, "chat", context, include_reasoning=True):
                    if chunk["type"] == "reasoning":
                        trace.append(chunk["text"])
                        yield sse("reasoning", {"text": chunk["text"]})
                    else:
                        parts.append(chunk["text"])
                        yield sse("delta", {"text": chunk["text"]})
                with db.connect() as connection:
                    message = insert_message(connection, conversation_id, "assistant", "".join(parts), reasoning="".join(trace))
                yield sse("message", public_message({**message, "images": "[]", "profiles": "[]", "reading": None}))
            yield sse("done", {})
        except llm.ModelError as exc:
            yield sse("error", {"message": str(exc)})
        except Exception:
            yield sse("error", {"message": "本次回应未能保存，请重新打开对话后重试"})

    return stream_response(conversation_id, events())


async def send_astrology_message(conversation, body, user):
    conversation_id = conversation["id"]
    if conversation_id in RUNS:
        raise HTTPException(409, "这段星象解读仍在整理中，请先停止或等待完成。")
    model = default_model("astrology")
    snapshots = get_snapshots(user["id"], body.profile_ids)
    profiles = {profile["id"]: profile for profile in snapshots}
    referenced = {match.group(2) for match in MENTION.finditer(body.content)}
    if not referenced.issubset(profiles):
        raise HTTPException(422, "人物引用已失效，请从人物选择器重新插入。")
    content = MENTION.sub(lambda match: f"@[{profiles[match.group(2)]['name'].replace(']', '')}](profile:{match.group(2)})", body.content)
    images = []
    if body.image_ids and not model["supports_images"]:
        raise HTTPException(400, "当前服务暂不支持图片。")
    for identity in dict.fromkeys(body.image_ids):
        image = db.one("SELECT id,original_name FROM uploads WHERE id=? AND user_id=?", (identity, user["id"]))
        if not image:
            raise HTTPException(404, "图片不存在或不属于当前账号。")
        images.append({**image, "url": f"/api/uploads/{identity}"})
    message = save_message(conversation_id, "user", content, snapshots, images)
    if conversation["title"] == "新的星空来信":
        title = MENTION.sub(lambda match: match.group(1), content).strip()[:36] or "人物星盘咨询"
        db.execute("UPDATE conversations SET title=? WHERE id=?", (title, conversation_id))
    job = Job(conversation_id)
    RUNS[conversation_id] = job
    job.emit("user_message", message)
    job.task = asyncio.create_task(produce(job, model, user, body.length_mode))
    job.task.add_done_callback(lambda _: settled(job))
    return StreamingResponse(event_stream(job), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def produce(job, model, user, length_mode):
    try:
        await run_agent(job, model, user, length_mode)
    except asyncio.CancelledError:
        pass
    except Exception as error:
        from .errors import describe_error, diagnostic
        diagnostic(error, "会话收尾")
        code, reason = describe_error(error)
        try:
            if not db.one("SELECT 1 FROM conversations WHERE id=?", (job.conversation_id,)):
                return
            if job.text and not job.saved:
                message = save_message(job.conversation_id, "assistant", job.text + "\n\n（本次回应未能完整结束。）", kind="partial")
                job.saved = True
                job.emit("message", message)
            if job.progress_id:
                from .agent import progress
                progress(job, "回应保存或收尾未完成：" + reason, "error", job.progress_id)
        except sqlite3.Error:
            pass
        text = "这次回应未能完整结束：" + reason
        if job.text and not job.saved:
            text = "已显示的文字暂未保存，请先复制留存，再重新打开对话。"
        job.emit("error", {"message": text, "code": code, "recoverable": False})


def settled(job):
    if RUNS.get(job.conversation_id) is job:
        RUNS.pop(job.conversation_id, None)
    job.emit("done", {})
    job.queue.put_nowait(None)


async def event_stream(job):
    try:
        while True:
            try:
                event = await asyncio.wait_for(job.queue.get(), timeout=12)
            except asyncio.TimeoutError:
                yield ": 星光仍在抵达\n\n"
                continue
            if event is None:
                break
            name, payload = event
            yield f"event: {name}\ndata: {db.dumps(payload)}\n\n"
    finally:
        job.connected = False
        job.request_stop()


@router.post("/{conversation_id}/draws/{draw_id}/reveal")
def reveal(conversation_id: str, draw_id: str, user=Depends(auth.current_user)):
    draw_owned(conversation_id, draw_id, user)
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = dict(connection.execute("SELECT * FROM draws WHERE id=?", (draw_id,)).fetchone())
        if row["status"] == "proposed":
            cards = tarot.draw_cards(json.loads(row["positions"]), bool(row["upright_only"]))
            connection.execute("UPDATE draws SET cards=?,status='drawn' WHERE id=?", (db.dumps(cards), draw_id))
            connection.execute("UPDATE conversations SET updated_at=? WHERE id=?", (db.now(), conversation_id))
            row.update(cards=db.dumps(cards), status="drawn")
    return public_draw(row)


def reading_text(draw, reading):
    lines = [draw["spread_name"]]
    for card, analysis in zip(draw["cards"], reading["cards"]):
        lines.append(f"{card['position']} · {card['name_zh']} / {card['name_en']} · {card['orientation_zh']}")
        lines.extend(analysis[field] for field in ("imagery", "symbolism", "interpretation", "advice"))
    lines.extend([reading["synthesis"], "\n".join(f"{i}. {action}" for i, action in enumerate(reading["actions"], 1)), reading["closing"]])
    return "\n\n".join(lines)


@router.post("/{conversation_id}/draws/{draw_id}/interpret")
async def interpret(conversation_id: str, draw_id: str, body: ResponseOptions | None = None, user=Depends(auth.current_user)):
    draw = public_draw(draw_owned(conversation_id, draw_id, user))
    if draw["status"] == "proposed":
        raise HTTPException(409, "请先开启抽牌仪式")
    model = default_model("tarot") if draw["status"] != "interpreted" else None
    length_mode = body.length_mode if body else "detailed"

    async def events():
        try:
            if draw["status"] == "interpreted":
                yield sse("draw", draw)
                saved = db.one("SELECT * FROM messages WHERE draw_id=? AND kind='reading' ORDER BY seq DESC LIMIT 1", (draw_id,))
                if saved:
                    yield sse("message", public_message(saved))
            else:
                batch_size = max(1, min(6, model["max_output_tokens"] // 1200))
                multiple_batches = len(draw["cards"]) > batch_size
                all_cards, partials, trace = [], [], []
                for start in range(0, len(draw["cards"]), batch_size):
                    cards = draw["cards"][start:start + batch_size]
                    yield sse("status", {"text": f"正在解读第 {start + 1}—{start + len(cards)} 张牌，聆听牌面之间的低语…"})
                    fixed = {"question": draw["question"], "spread_name": draw["spread_name"],
                             "positions": [card["position"] for card in cards], "cards": cards}
                    context = await build_context(conversation_id, model, user, tarot.READING_PROMPT + tarot.length_instruction(length_mode, "reading"),
                                                  "本轮只解读以下固定牌面；cards只含本轮ID，保持顺序：\n" + db.dumps(fixed), mode="tarot")
                    async for event, value in structured(model, user, "reading", context, Reading, trace,
                                                         [card["id"] for card in cards], all_cards, not multiple_batches):
                        if event == "result":
                            part = value.model_dump()
                        else:
                            yield sse(event, value)
                    all_cards.extend(part["cards"])
                    partials.append(part)
                if len(partials) == 1:
                    reading = partials[0]
                else:
                    yield sse("status", {"text": "逐牌解读已完成，正在串联整组牌的故事…"})
                    overview_prompt = tarot.VOICE + '\n根据完整牌阵和逐牌要点总结牌际关联与建议，严格返回JSON：{"synthesis":"整组叙事与张力，不重复逐牌解释","actions":["具体行动建议"],"closing":"温柔收束"}。'
                    overview_prompt += tarot.length_instruction(length_mode, "overview")
                    facts = {"question": draw["question"], "spread_name": draw["spread_name"],
                             "cards": [{"name": card["name_zh"], "orientation": card["orientation_zh"],
                                        "position": card["position"], "meaning": analysis["interpretation"]}
                                       for card, analysis in zip(draw["cards"], all_cards)]}
                    context = await build_context(conversation_id, model, user, overview_prompt, db.dumps(facts), mode="tarot")
                    async for event, value in structured(model, user, "reading", context, ReadingOverview, trace, previous_cards=all_cards):
                        if event == "result":
                            overview = value.model_dump()
                        else:
                            yield sse(event, value)
                    reading = {"cards": all_cards, **overview}
                with db.connect() as connection:
                    connection.execute("UPDATE draws SET status='interpreted',reading=? WHERE id=?", (db.dumps(reading), draw_id))
                    message = insert_message(connection, conversation_id, "assistant", reading_text(draw, reading), draw_id=draw_id, kind="reading", reasoning="".join(trace))
                draw.update(status="interpreted", reading=reading)
                yield sse("draw", draw)
                yield sse("message", public_message({**message, "images": "[]", "profiles": "[]", "reading": None}))
            yield sse("done", {})
        except llm.ModelError as exc:
            yield sse("error", {"message": str(exc)})
        except Exception:
            yield sse("error", {"message": "解读暂时中断，牌面已保存，可继续解读"})

    return stream_response(conversation_id, events())


async def shutdown():
    jobs = list(RUNS.values())
    for job in jobs:
        job.request_stop()
    if jobs:
        await asyncio.gather(*(job.task for job in jobs if job.task), return_exceptions=True)
