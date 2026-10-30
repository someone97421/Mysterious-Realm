import json
import re


_FIELDS = {"opening": "", "spread_name": "牌阵"}
_STRING = re.compile(r'"((?:[^"\\]|\\.)*)("|\\?$)', re.DOTALL)


def _decode_fragment(value):
    value = re.sub(r'\\u[0-9a-fA-F]{0,3}$', '', value)
    if len(value) - len(value.rstrip('\\')) & 1:
        value = value[:-1]
    try:
        return json.loads('"' + value + '"').encode('utf-8', errors='ignore').decode('utf-8')
    except (ValueError, UnicodeError):
        return ""


def partial_object(text):
    """读取尚未结束的 JSON 供展示；持久化仍要求完整 Schema 校验。"""
    position = text.find('{')
    if position < 0:
        return {}
    missing = object()
    decoder = json.JSONDecoder()

    def skip_space():
        nonlocal position
        while position < len(text) and text[position].isspace():
            position += 1

    def parse(depth=0):
        nonlocal position
        skip_space()
        if position >= len(text) or depth > 24:
            return missing
        opening = text[position]
        if opening == '"':
            match = _STRING.match(text, position)
            if not match:
                return missing
            position = match.end()
            return _decode_fragment(match[1])
        if opening in '{[':
            mapping = opening == '{'
            result = {} if mapping else []
            position += 1
            while position < len(text):
                skip_space()
                if position >= len(text):
                    break
                if text[position] == ('}' if mapping else ']'):
                    position += 1
                    break
                if mapping:
                    match = _STRING.match(text, position)
                    if not match or match[2] != '"':
                        break
                    key = _decode_fragment(match[1])
                    position = match.end()
                    skip_space()
                    if position >= len(text) or text[position] != ':':
                        break
                    position += 1
                value = parse(depth + 1)
                if value is missing:
                    break
                if mapping:
                    result[key] = value
                else:
                    result.append(value)
                skip_space()
                if position >= len(text) or text[position] != ',':
                    if position < len(text) and text[position] == ('}' if mapping else ']'):
                        position += 1
                    break
                position += 1
            return result
        try:
            value, position = decoder.raw_decode(text, position)
            return value
        except ValueError:
            return missing

    result = parse()
    return result if isinstance(result, dict) else {}


def reading_preview(text, card_ids, previous_cards, include_overview):
    value = partial_object(text)
    source = value.get('cards')
    cards = list(previous_cards)
    if isinstance(source, list):
        for index, item in enumerate(source[:len(card_ids)]):
            if not isinstance(item, dict):
                continue
            claimed_id = item.get('card_id', '')
            if not isinstance(claimed_id, str) or not card_ids[index].startswith(claimed_id):
                continue
            cards.append({
                'card_id': card_ids[index],
                **{field: item.get(field, '') if isinstance(item.get(field, ''), str) else ''
                   for field in ('imagery', 'symbolism', 'interpretation', 'advice')},
            })
    actions = value.get('actions', [])
    return {
        'cards': cards,
        'synthesis': value.get('synthesis', '') if include_overview and isinstance(value.get('synthesis', ''), str) else '',
        'actions': [action for action in actions if isinstance(action, str)] if include_overview and isinstance(actions, list) else [],
        'closing': value.get('closing', '') if include_overview and isinstance(value.get('closing', ''), str) else '',
    }


def readable_preview(text):
    value = partial_object(text)
    parts = []
    for field in ('opening', 'spread_name'):
        if isinstance(value.get(field), str) and value[field]:
            label = _FIELDS[field]
            parts.append(f'{label}\n{value[field]}' if label else value[field])
    positions = value.get('positions')
    if isinstance(positions, list):
        parts.extend(f'{index}. {position}' for index, position in enumerate(positions, 1) if isinstance(position, str))
    return '\n\n'.join(parts)
