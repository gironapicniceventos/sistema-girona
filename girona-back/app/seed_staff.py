"""Usuarios iniciales del personal (correo ya normalizado a minúsculas)."""

from __future__ import annotations

import logging
import os

from sqlalchemy.orm import Session

from . import db, models, security

logger = logging.getLogger("uvicorn.error")

# (email, password, nombre visible, rol)
# Roles: mesero | caja_mesero | admin | gerente | jefe_cocina | full_access (dueños)
STAFF_SEED: list[tuple[str, str, str, str]] = [
    ("jenny799@hotmail.com", "2u%cirWx6ZM4", "Jenny", "full_access"),
    ("jefferortizm@hotmail.com", "P9jXKh@UEqC$", "Jeffer Ortiz", "full_access"),
    ("laurasuarez.girona@gmail.com", "v4Ui8a^Jph%H", "Laura Suárez", "full_access"),
    ("rodriguezurieles@gmail.com", "3J&kszESuaxU", "Derwin Rodríguez", "full_access"),
    ("acevedopulido08@gmail.com", "Z#8eEN6X$xuN", "Alejandra Acevedo", "admin"),
    ("haryucatalina@gmail.com", "YQP^#y^$W62m", "Catalina", "mesero"),
    ("elkinvillabona1@icloud.com", "X&eCewH^ED7m", "Elkin Villabona", "mesero"),
    ("luifernanda2308@gmail.com", "Q!DPzxB5Pj38", "Luisa Fernanda", "full_access"),
    ("majitootoloza13@gmail.com", "KTP5KYv2$SvM", "María José Toloza", "mesero"),
    ("mydr0305@gmail.com", "fBAwm489#dMw", "Mayra de Ávila", "mesero"),
    ("michellmorelli56@gmail.com", "kUnz6z2M3hi", "Michell Morelli", "mesero"),
    ("ivansuares69@gmail.com", "QjB5Uk3uy!7K", "Néstor Suárez", "mesero"),
    ("yulieth.martinez.jerez21@gmail.com", "vaTW5nybjkC&", "Yulieth Martínez", "caja_mesero"),
    ("angemoreno1984@gmail.com", "jA3vG^x2i4CJ", "Angélica Moreno", "mesero"),
    ("jose.villarrela1308@gmail.com", "v3B#dmhsSUN", "José Villarreal", "jefe_cocina"),
    ("chefjuliogonzales@gmail.com", "t8ar#PNM4&Pm", "Julio César González", "gerente"),
]


def run_if_enabled() -> None:
    if os.getenv("SEED_STAFF_USERS", "1") != "1":
        return

    reset_pw = os.getenv("SEED_RESET_STAFF_PASSWORDS", "").lower() in ("1", "true", "yes")

    session = Session(bind=db.engine)
    try:
        created = 0
        updated = 0
        for email_raw, password, full_name, role in STAFF_SEED:
            email = email_raw.strip().lower()
            user = session.query(models.User).filter(models.User.email == email).first()
            if not user:
                session.add(
                    models.User(
                        email=email,
                        hashed_password=security.hash_password(password),
                        full_name=full_name,
                        role=role,
                        is_active=True,
                    ),
                )
                created += 1
            else:
                user.full_name = full_name
                user.role = role
                if reset_pw:
                    user.hashed_password = security.hash_password(password)
                updated += 1
        session.commit()
        if created or updated:
            logger.info(
                "seed_staff: %s nuevos, %s actualizados (reset_pw=%s)",
                created,
                updated,
                reset_pw,
            )
    except Exception:
        session.rollback()
        logger.exception("seed_staff failed")
        raise
    finally:
        session.close()
