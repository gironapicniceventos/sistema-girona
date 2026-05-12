import os

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from . import db, models, schemas, security

router = APIRouter(prefix="/auth")
bearer_scheme = HTTPBearer(auto_error=False)


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
def get_me(current_user: models.User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.full_name or DEFAULT_PROFILE_NAME,
        "profile_photo_url": current_user.profile_photo_url or DEFAULT_PROFILE_PHOTO_URL,
        "role": current_user.role or "mesero",
    }


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

    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.full_name or DEFAULT_PROFILE_NAME,
        "profile_photo_url": current_user.profile_photo_url or DEFAULT_PROFILE_PHOTO_URL,
        "role": current_user.role or "mesero",
    }
