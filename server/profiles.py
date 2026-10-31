from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError

from . import auth, db
from .schemas import ProfileInput, ProfilePatch


router = APIRouter(prefix="/api")
PROFILE_FIELDS = (
    "id", "name", "avatar", "color", "birth_date", "birth_time", "time_accuracy", "time_end",
    "location_name", "latitude", "longitude", "timezone", "notes", "version", "created_at", "updated_at",
)


def public_profile(row):
    return {key: row[key] for key in PROFILE_FIELDS}


def owned_profile(profile_id, user_id):
    row = db.one("SELECT * FROM profiles WHERE id=? AND user_id=?", (profile_id, user_id))
    if not row:
        raise HTTPException(404, "人物资料不存在")
    return row


def get_snapshots(user_id, ids):
    """按发送顺序返回用户拥有的完整资料快照。"""
    ids = list(dict.fromkeys(ids or []))
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    rows = db.all_rows(
        f"SELECT * FROM profiles WHERE user_id=? AND id IN ({placeholders})",
        (user_id, *ids),
    )
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(ids):
        raise HTTPException(404, "人物资料不存在或无权访问")
    return [public_profile(by_id[profile_id]) for profile_id in ids]


@router.get("/profiles")
def list_profiles(user=Depends(auth.current_user)):
    return [public_profile(row) for row in db.all_rows(
        "SELECT * FROM profiles WHERE user_id=? ORDER BY updated_at DESC, created_at DESC", (user["id"],)
    )]


@router.post("/profiles")
def create_profile(body: ProfileInput, user=Depends(auth.current_user)):
    values = body.model_dump()
    profile_id = db.uid()
    timestamp = db.now()
    with db.connect() as connection:
        connection.execute(
            """INSERT INTO profiles
            (id,user_id,name,avatar,color,birth_date,birth_time,time_accuracy,time_end,
             location_name,latitude,longitude,timezone,notes,version,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (profile_id, user["id"], values["name"], values["avatar"], values["color"],
             values["birth_date"], values["birth_time"], values["time_accuracy"], values["time_end"],
             values["location_name"], values["latitude"], values["longitude"], values["timezone"],
             values["notes"], 1, timestamp, timestamp),
        )
    return public_profile(owned_profile(profile_id, user["id"]))


@router.put("/profiles/{profile_id}")
def update_profile(profile_id: str, body: ProfilePatch, user=Depends(auth.current_user)):
    changed = body.model_dump(exclude_unset=True)
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM profiles WHERE id=? AND user_id=?", (profile_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "人物资料不存在")
        existing = dict(row)
        if not changed:
            return public_profile(existing)
        combined = {key: existing[key] for key in ProfileInput.model_fields}
        combined.update(changed)
        try:
            values = ProfileInput.model_validate(combined).model_dump()
        except ValidationError as exc:
            raise HTTPException(422, "；".join(error["msg"].removeprefix("Value error, ") for error in exc.errors())) from exc
        timestamp = db.now()
        assignments = ",".join(f"{key}=?" for key in values)
        connection.execute(f"UPDATE profiles SET {assignments},version=version+1,updated_at=? WHERE id=? AND user_id=?", (*values.values(), timestamp, profile_id, user["id"]))
        return public_profile({**existing, **values, "version": existing["version"] + 1, "updated_at": timestamp})


@router.delete("/profiles/{profile_id}")
def delete_profile(profile_id: str, user=Depends(auth.current_user)):
    if not db.execute("DELETE FROM profiles WHERE id=? AND user_id=?", (profile_id, user["id"])):
        raise HTTPException(404, "人物资料不存在")
    return {"ok": True}


@router.get("/locations")
async def locations(q: str = Query(min_length=1, max_length=200), user=Depends(auth.current_user)):
    from . import astro_runtime

    result = await astro_runtime.search_locations(q.strip(), user)
    if isinstance(result, dict):
        locations_result = result.get("locations", [])
        response = {"locations": locations_result}
        if result.get("message"):
            response["message"] = result["message"]
        return response
    return {"locations": result or []}
