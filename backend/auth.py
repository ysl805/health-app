import os
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from database import get_db
from models import User

SECRET_KEY = os.environ.get("SECRET_KEY", "health_app_super_secret_key_2026_change_in_production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无法验证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user


def require_role(*roles):
    async def checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="权限不足")
        return current_user
    return checker


# Hierarchy: who can see whose data
ROLE_HIERARCHY = {
    "super_admin": ["super_admin", "admin", "province_manager", "region_manager", "business_manager", "user"],
    "admin": ["admin", "province_manager", "region_manager", "business_manager", "user"],
    "province_manager": ["province_manager", "region_manager", "business_manager", "user"],
    "region_manager": ["region_manager", "business_manager", "user"],
    "business_manager": ["business_manager", "user"],
    "user": ["user"],
}

SUBORDINATE_ROLES = {
    "super_admin": ["admin", "province_manager", "region_manager", "business_manager", "user"],
    "admin": ["province_manager", "region_manager", "business_manager", "user"],
    "province_manager": ["region_manager", "business_manager", "user"],
    "region_manager": ["business_manager", "user"],
    "business_manager": ["user"],
    "user": [],
}


def can_manage(creator_role: str, target_role: str) -> bool:
    return target_role in SUBORDINATE_ROLES.get(creator_role, [])
