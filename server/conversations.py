import asyncio
import contextlib
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from . import auth, db, llm, tarot
from .context import build_context
from .schemas import Plan, Reading, ReadingOverview, Rename, SendMessage

router = APIRouter(prefix="/api/conversations")
_busy = set()


def conversation_owned(conversation_id, user):
    row = db.one("SELECT * FROM conversations WHERE id=? AND user_id=?", (conversation_id, user["id"]))
    if not row:
        raise HTTPException(404, "对话不存在")
    return row


def public_conversation(row):
    return {key: row[key] for key in ("id", "title", "created_at", "updated_at")}


def public_message(row):
    return {**{key: row[key] for key in ("id", "role", "content", "created_at", "draw_id", "kind")},
            "images": json.loads(row["images"])}


def public_draw(row):
    return {**row, "positions": json.loads(row["positions"]), "cards": json.loads(row["cards"]),
            "upright_only": bool(row["upright_only"]), "reading": json.loads(row["reading"]) if row["reading"] else None}


def draw_owned(conversation_id, draw_id, user):
    conversation_owned(conversation_id, user)
    row = db.one("SELECT * FROM draws WHERE id=? AND conversation_id=?", (draw_id, conversation_id))
    if not row:
        raise HTTPException(404, "牌阵不存在")
    return row


def default_model():
    row = db.one("SELECT * FROM models WHERE is_default=1")
    if not row:
        raise HTTPException(409, "星帷尚未接通，请联系管理员配置默认模型")
    return row


def insert_message(connection, conversation_id, role, content, images=None, draw_id=None, kind="chat"):
    message = dict(id=db.uid(), role=role, content=content, images=images or [], draw_id=draw_id, kind=kind, created_at=db.now())
    connection.execute("""INSERT INTO messages (id,conversation_id,role,content,images,draw_id,kind,created_at)
                          VALUES (?,?,?,?,?,?,?,?)""",
                       (message["id"], conversation_id, role, content, db.dumps(message["images"]), draw_id, kind, message["created_at"]))
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
                    yield ": 星帷仍在回应\n\n"
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
            await iterator.aclose()

    class GuardedResponse(StreamingResponse):
        async def __call__(self, scope, receive, send):
            try:
                await super().__call__(scope, receive, send)
            finally:
                _busy.discard(conversation_id)

    return GuardedResponse(with_heartbeat(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def structured(model, user, purpose, messages, schema, card_ids=None):
    for attempt in range(2):
        text = await llm.complete(model, user, purpose, messages)
        try:
            value = schema.model_validate(llm.extract_json(text))
            if card_ids is not None and [card.card_id for card in value.cards] != card_ids:
                raise ValueError("牌序不匹配")
            return value
        except (ValueError, ValidationError):
            if attempt:
                raise llm.ModelError("模型未能返回完整且对应牌面的解析，请重试或联系管理员调整模型／输出预算")
            messages = [*messages, {"role": "user", "content": "上一轮结构未通过校验。请重新生成完整JSON，严格遵守要求，字段齐全；如在解读，cards数量、card_id及顺序必须与固定结果完全一致。"}]


@router.get("")
def list_conversations(user=Depends(auth.current_user)):
    return [public_conversation(row) for row in db.all_rows("SELECT * FROM conversations WHERE user_id=? ORDER BY updated_at DESC", (user["id"],))]


@router.post("")
def create_conversation(user=Depends(auth.current_user)):
    row = dict(id=db.uid(), title="新的祈愿", created_at=db.now(), updated_at=db.now())
    db.execute("INSERT INTO conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)",
               (row["id"], user["id"], row["title"], row["created_at"], row["updated_at"]))
    return row


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, user=Depends(auth.current_user)):
    row = conversation_owned(conversation_id, user)
    return {"conversation": public_conversation(row),
            "messages": [public_message(message) for message in db.all_rows("SELECT * FROM messages WHERE conversation_id=? ORDER BY seq", (conversation_id,))],
            "draws": [public_draw(draw) for draw in db.all_rows("SELECT * FROM draws WHERE conversation_id=? ORDER BY created_at", (conversation_id,))]}


@router.patch("/{conversation_id}")
def rename_conversation(conversation_id: str, body: Rename, user=Depends(auth.current_user)):
    conversation_owned(conversation_id, user)
    db.execute("UPDATE conversations SET title=? WHERE id=?", (body.title, conversation_id))
    return public_conversation(conversation_owned(conversation_id, user))


@router.post("/{conversation_id}/messages")
async def send_message(conversation_id: str, body: SendMessage, user=Depends(auth.current_user)):
    conversation = conversation_owned(conversation_id, user)
    model = default_model()
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
            if latest and latest["role"] == "user" and latest["content"] == body.content and json.loads(latest["images"]) == images:
                message = public_message(latest)
            else:
                with db.connect() as connection:
                    message = insert_message(connection, conversation_id, "user", body.content, images)
                    if conversation["title"] == "新的祈愿":
                        connection.execute("UPDATE conversations SET title=? WHERE id=?", ((body.content or "一封来自画面的祈愿")[:38], conversation_id))
            yield sse("user_message", message)
            yield sse("status", {"text": "正在聆听你的祈愿，整理星象与牌阵…"})
            context = await build_context(conversation_id, model, user, tarot.PLAN_PROMPT)
            plan = await structured(model, user, "planning", context, Plan)
            if plan.mode == "draw":
                draw_id = db.uid()
                with db.connect() as connection:
                    connection.execute("""INSERT INTO draws (id,conversation_id,question,opening,spread_name,positions,upright_only,created_at)
                                          VALUES (?,?,?,?,?,?,?,?)""",
                                       (draw_id, conversation_id, plan.question, plan.opening, plan.spread_name,
                                        db.dumps(plan.positions), int(plan.upright_only), db.now()))
                    message = insert_message(connection, conversation_id, "assistant", plan.opening, draw_id=draw_id, kind="proposal")
                yield sse("message", message)
                yield sse("draw", public_draw(db.one("SELECT * FROM draws WHERE id=?", (draw_id,))))
            else:
                yield sse("status", {"text": "星帷正在回应…"})
                context = await build_context(conversation_id, model, user, tarot.VOICE)
                parts = []
                async for text in llm.stream(model, user, "chat", context):
                    parts.append(text)
                    yield sse("delta", {"text": text})
                with db.connect() as connection:
                    message = insert_message(connection, conversation_id, "assistant", "".join(parts))
                yield sse("message", message)
            yield sse("done", {})
        except llm.ModelError as exc:
            yield sse("error", {"message": str(exc)})
        except Exception:
            yield sse("error", {"message": "本次回应未能保存，请重新打开对话后重试"})

    return stream_response(conversation_id, events())


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
async def interpret(conversation_id: str, draw_id: str, user=Depends(auth.current_user)):
    draw = public_draw(draw_owned(conversation_id, draw_id, user))
    if draw["status"] == "proposed":
        raise HTTPException(409, "请先开启抽牌仪式")
    model = default_model() if draw["status"] != "interpreted" else None

    async def events():
        try:
            if draw["status"] == "interpreted":
                yield sse("draw", draw)
                saved = db.one("SELECT * FROM messages WHERE draw_id=? AND kind='reading' ORDER BY seq DESC LIMIT 1", (draw_id,))
                if saved:
                    yield sse("message", public_message(saved))
            else:
                batch_size = max(1, min(6, model["max_output_tokens"] // 1200))
                all_cards, partials = [], []
                for start in range(0, len(draw["cards"]), batch_size):
                    cards = draw["cards"][start:start + batch_size]
                    yield sse("status", {"text": f"正在解读第 {start + 1}—{start + len(cards)} 张牌，聆听牌面之间的低语…"})
                    fixed = {"question": draw["question"], "spread_name": draw["spread_name"],
                             "positions": [card["position"] for card in cards], "cards": cards}
                    context = await build_context(conversation_id, model, user, tarot.READING_PROMPT,
                                                  "本轮只解读以下固定牌面；cards只含本轮ID，保持顺序：\n" + db.dumps(fixed))
                    part = (await structured(model, user, "reading", context, Reading,
                                             [card["id"] for card in cards])).model_dump()
                    all_cards.extend(part["cards"])
                    partials.append(part)
                if len(partials) == 1:
                    reading = partials[0]
                else:
                    yield sse("status", {"text": "逐牌解读已完成，正在串联整组牌的故事…"})
                    overview_prompt = tarot.VOICE + '\n根据完整牌阵和逐牌要点总结牌际关联与建议，严格返回JSON：{"synthesis":"整组叙事与张力，不重复逐牌解释","actions":["具体行动建议"],"closing":"温柔收束"}。'
                    facts = {"question": draw["question"], "spread_name": draw["spread_name"],
                             "cards": [{"name": card["name_zh"], "orientation": card["orientation_zh"],
                                        "position": card["position"], "meaning": analysis["interpretation"]}
                                       for card, analysis in zip(draw["cards"], all_cards)]}
                    context = await build_context(conversation_id, model, user, overview_prompt, db.dumps(facts))
                    overview = (await structured(model, user, "reading", context, ReadingOverview)).model_dump()
                    reading = {"cards": all_cards, **overview}
                with db.connect() as connection:
                    connection.execute("UPDATE draws SET status='interpreted',reading=? WHERE id=?", (db.dumps(reading), draw_id))
                    message = insert_message(connection, conversation_id, "assistant", reading_text(draw, reading), draw_id=draw_id, kind="reading")
                draw.update(status="interpreted", reading=reading)
                yield sse("draw", draw)
                yield sse("message", message)
            yield sse("done", {})
        except llm.ModelError as exc:
            yield sse("error", {"message": str(exc)})
        except Exception:
            yield sse("error", {"message": "解读暂时中断，牌面已保存，可继续解读"})

    return stream_response(conversation_id, events())
