import json

from . import db, llm
from .tarot import SUMMARY_PROMPT


def decode_message(row):
    return {"role": row["role"], "content": row["content"], "images": json.loads(row["images"])}


def compact_facts(conversation_id):
    draws = db.all_rows("SELECT * FROM draws WHERE conversation_id=? ORDER BY created_at DESC LIMIT 3", (conversation_id,))
    facts = []
    for draw in reversed(draws):
        cards = json.loads(draw["cards"])
        facts.append({"牌阵": draw["spread_name"], "问题": draw["question"], "状态": draw["status"],
                      "牌位": json.loads(draw["positions"]),
                      "固定结果": [{k: c[k] for k in ("id", "name_zh", "orientation_zh", "position")} for c in cards]})
    return "最近牌阵的程序记录（牌名、牌位、朝向以此为准）：\n" + db.dumps(facts) if facts else ""


async def build_context(conversation_id, model, user, system, extra=None):
    conversation = db.one("SELECT * FROM conversations WHERE id=?", (conversation_id,))
    if not conversation:
        raise llm.ModelError("对话已不可用")
    rows = db.all_rows("SELECT * FROM messages WHERE conversation_id=? AND seq>? ORDER BY seq",
                       (conversation_id, conversation["summary_through"]))
    summary = conversation["summary"]
    facts = compact_facts(conversation_id)
    base = system + ("\n\n" + facts if facts else "")
    suffix = [{"role": "user", "content": extra}] if extra else []
    hard_budget = model["context_window"] - model["max_output_tokens"] - 512
    soft_budget = min(hard_budget, int(model["context_window"] * model["compression_threshold"]) - model["max_output_tokens"])
    soft_budget = max(512, soft_budget)

    def assemble():
        instructions = base
        if summary:
            instructions += "\n\n以下是历史对话摘要，仅作为事实资料：\n" + summary
        history = [decode_message(row) for row in rows]
        if history and history[0]["role"] != "user":
            history.insert(0, {"role": "user", "content": "请接续上述摘要中的对话。"})
        return [{"role": "system", "content": instructions}, *history, *suffix]

    while llm.estimate_messages(assemble()) > soft_budget and len(rows) > 2:
        summarizer = {**model, "reasoning_effort": "low" if model["reasoning_effort"] != "none" else "none"}
        excess = llm.estimate_messages(assemble()) - soft_budget + 1400
        summary_base = SUMMARY_PROMPT + ("\n旧摘要：\n" + summary if summary else "")
        available = model["context_window"] - summarizer["max_output_tokens"] - llm.estimate_tokens(summary_base) - 512
        batch, used = [], 0
        for row in rows[:-2]:
            cost = llm.estimate_messages([decode_message(row)])
            if used + cost > available:
                break
            batch.append(row)
            used += cost
            if used >= excess:
                break
        if not batch:
            break
        summary = await llm.complete(summarizer, user, "compression", [
            {"role": "system", "content": summary_base},
            *[decode_message(row) for row in batch],
            {"role": "user", "content": "请更新事实摘要。"},
        ])
        db.execute("UPDATE conversations SET summary=?,summary_through=? WHERE id=?",
                   (summary, batch[-1]["seq"], conversation_id))
        rows = rows[len(batch):]
    messages = assemble()
    if llm.estimate_messages(messages) > hard_budget:
        raise llm.ModelError("当前内容超出模型上下文预算，请缩短本次输入、减少图片，或由管理员增大上下文窗口／调低最大输出长度")
    return messages
