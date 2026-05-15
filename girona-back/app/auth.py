import os

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from . import db, models, personnel, schemas, security

router = APIRouter(prefix="/auth")
bearer_scheme = HTTPBearer(auto_error=False)

VALID_APP_ROLES: set[str] = {
    "mesero",
    "caja_mesero",
    "admin",
    "full_access",
    "gerente",
    "jefe_cocina",
}


DEFAULT_PROFILE_PHOTO_URL = "/backgrounds/default.jpg"
DEFAULT_PROFILE_NAME = "Usuario"


def _default_name_from_email(email: str) -> str:
    _ = email
    return DEFAULT_PROFILE_NAME


def _is_legacy_email_based_name(email: str, full_name: str | None) -> bool:
    if not full_name:
        return False
    local_part = email.split("@", 1)[0].strip().lower()
    candidate = "".join(full_name.strip().lower().split())
    return bool(local_part) and candidate == local_part


def _ensure_profile_defaults(user: models.User, db_session: Session) -> models.User:
    changed = False
    if (
        not user.full_name
        or not user.full_name.strip()
        or _is_legacy_email_based_name(user.email, user.full_name)
    ):
        user.full_name = DEFAULT_PROFILE_NAME
        changed = True
    if not user.profile_photo_url or not user.profile_photo_url.strip():
        user.profile_photo_url = DEFAULT_PROFILE_PHOTO_URL
        changed = True
    if changed:
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db_session: Session = Depends(db.get_db),
) -> models.User:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token requerido",
        )

    payload = security.decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )

    email = payload.get("sub")
    if not isinstance(email, str) or not email.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )

    email_norm = email.strip().lower()
    db_user = db_session.query(models.User).filter(models.User.email == email_norm).first()
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no encontrado",
        )
    if not db_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo",
        )
    return _ensure_profile_defaults(db_user, db_session)


def require_gerente_admin_or_owner(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    role = (current_user.role or "").strip().lower()
    if role not in {"full_access", "admin", "gerente"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sin permiso para esta accion",
        )
    return current_user


def _user_profile_payload(db_session: Session, user: models.User) -> dict:
    wid, wname = personnel.resolve_waiter_for_staff_user(db_session, user)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.full_name or DEFAULT_PROFILE_NAME,
        "profile_photo_url": user.profile_photo_url or DEFAULT_PROFILE_PHOTO_URL,
        "role": user.role or "mesero",
        "waiter_id": wid,
        "waiter_name": wname,
    }


def require_owner(current_user: models.User = Depends(get_current_user)) -> models.User:
    role = (current_user.role or "").strip()
    if role != "full_access":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo cuentas de dueño pueden gestionar permisos",
        )
    return current_user


def _staff_user_dict(u: models.User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "name": u.full_name or DEFAULT_PROFILE_NAME,
        "role": u.role or "mesero",
        "is_active": bool(u.is_active),
    }


@router.get("/staff/users", response_model=list[schemas.StaffUserOut])
def list_staff_users(
    db_session: Session = Depends(db.get_db),
    _: models.User = Depends(require_owner),
):
    rows = (
        db_session.query(models.User)
        .order_by(models.User.email.asc())
        .all()
    )
    return [_staff_user_dict(u) for u in rows]


@router.get(
    "/staff/waiter-link-candidates",
    response_model=list[schemas.StaffUserOut],
)
def list_waiter_link_candidates(
    db_session: Session = Depends(db.get_db),
    _: models.User = Depends(require_gerente_admin_or_owner),
):
    rows = (
        db_session.query(models.User)
        .filter(models.User.is_active == True)  # noqa: E712
        .order_by(models.User.email.asc())
        .all()
    )
    return [_staff_user_dict(u) for u in rows]


@router.post("/staff/users", response_model=schemas.StaffUserOut)
def create_staff_user(
    payload: schemas.StaffUserCreate,
    db_session: Session = Depends(db.get_db),
    _: models.User = Depends(require_owner),
):
    role = (payload.role or "").strip()
    if role not in VALID_APP_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Rol inválido. Use uno de: {', '.join(sorted(VALID_APP_ROLES))}",
        )
    email_norm = payload.email.strip().lower()
    exists = db_session.query(models.User).filter(models.User.email == email_norm).first()
    if exists:
        raise HTTPException(status_code=400, detail="Ya existe un usuario con ese correo")
    user = models.User(
        email=email_norm,
        hashed_password=security.hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role=role,
        profile_photo_url=DEFAULT_PROFILE_PHOTO_URL,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    personnel.sync_waiter_links_for_staff_users(db_session)
    db_session.commit()
    return _staff_user_dict(user)


@router.patch("/staff/users/{user_id}", response_model=schemas.StaffUserOut)
def update_staff_user(
    user_id: int,
    payload: schemas.StaffUserUpdate,
    db_session: Session = Depends(db.get_db),
    owner: models.User = Depends(require_owner),
):
    user = db_session.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if payload.email is not None:
        email_norm = str(payload.email).strip().lower()
        clash = (
            db_session.query(models.User)
            .filter(models.User.email == email_norm, models.User.id != user_id)
            .first()
        )
        if clash:
            raise HTTPException(status_code=400, detail="Ya existe otro usuario con ese correo")
        user.email = email_norm
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.role is not None:
        role = payload.role.strip()
        if role not in VALID_APP_ROLES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Rol inválido. Use uno de: {', '.join(sorted(VALID_APP_ROLES))}",
            )
        user.role = role
    if payload.is_active is not None:
        user.is_active = bool(payload.is_active)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    personnel.sync_waiter_links_for_staff_users(db_session)
    db_session.commit()
    return _staff_user_dict(user)


@router.delete("/staff/users/{user_id}", response_model=schemas.StaffUserOut)
def deactivate_staff_user(
    user_id: int,
    db_session: Session = Depends(db.get_db),
    owner: models.User = Depends(require_owner),
):
    user = db_session.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.id == owner.id:
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta")
    user.is_active = False
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return _staff_user_dict(user)


@router.post("/staff/users/{user_id}/password", response_model=schemas.StaffUserOut)
def staff_set_password(
    user_id: int,
    payload: schemas.StaffSetPasswordBody,
    db_session: Session = Depends(db.get_db),
    _: models.User = Depends(require_owner),
):
    user = db_session.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.hashed_password = security.hash_password(payload.new_password)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return _staff_user_dict(user)


@router.post("/signup", response_model=schemas.UserOut)
def signup(user: schemas.UserCreate, db: Session = Depends(db.get_db)):
    allow = os.getenv("ALLOW_PUBLIC_SIGNUP", "").lower() in ("1", "true", "yes")
    if not allow:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El registro público está deshabilitado",
        )

    email_norm = user.email.strip().lower()
    existing = db.query(models.User).filter(models.User.email == email_norm).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = models.User(
        email=email_norm,
        hashed_password=security.hash_password(user.password),
        full_name=_default_name_from_email(email_norm),
        profile_photo_url=DEFAULT_PROFILE_PHOTO_URL,
        role="mesero",
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    personnel.sync_waiter_links_for_staff_users(db)
    db.commit()
    return {
        "id": new_user.id,
        "email": new_user.email,
        "name": new_user.full_name or DEFAULT_PROFILE_NAME,
        "profile_photo_url": new_user.profile_photo_url,
    }

@router.post("/login", response_model=schemas.Token)
def login(user: schemas.UserCreate, db: Session = Depends(db.get_db)):
    email_norm = user.email.strip().lower()
    db_user = db.query(models.User).filter(models.User.email == email_norm).first()
    if not db_user or not security.verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = security.create_access_token(
        {"sub": db_user.email, "role": db_user.role or "mesero"},
    )
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=schemas.UserProfileOut)
def get_me(
    current_user: models.User = Depends(get_current_user),
    db_session: Session = Depends(db.get_db),
):
    return _user_profile_payload(db_session, current_user)


@router.put("/me", response_model=schemas.UserProfileOut)
def update_me(
    payload: schemas.UserProfileUpdate,
    db_session: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
):
    if payload.name is not None:
        current_user.full_name = payload.name.strip()
    if payload.profile_photo_url is not None:
        current_user.profile_photo_url = payload.profile_photo_url.strip()

    current_user = _ensure_profile_defaults(current_user, db_session)
    db_session.add(current_user)
    db_session.commit()
    db_session.refresh(current_user)

    return _user_profile_payload(db_session, current_user)


@router.post("/me/password", response_model=schemas.UserProfileOut)
def change_password(
    payload: schemas.UserPasswordChange,
    db_session: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not security.verify_password(
        payload.current_password,
        current_user.hashed_password,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña actual no es correcta",
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe ser distinta a la actual",
        )
    current_user.hashed_password = security.hash_password(payload.new_password)
    db_session.add(current_user)
    db_session.commit()
    db_session.refresh(current_user)

    return _user_profile_payload(db_session, current_user)
