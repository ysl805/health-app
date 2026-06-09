import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "health_app.db"))
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def migrate_db():
    """Add new columns to existing tables if they don't exist"""
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Check and add valid_from / valid_until columns
    cursor.execute("PRAGMA table_info(users)")
    columns = [row[1] for row in cursor.fetchall()]
    if 'valid_from' not in columns:
        cursor.execute('ALTER TABLE users ADD COLUMN valid_from DATETIME')
    if 'valid_until' not in columns:
        cursor.execute('ALTER TABLE users ADD COLUMN valid_until DATETIME')
    # Check and add prompt_config / negative_prompt to knowledge_bases
    cursor.execute("PRAGMA table_info(knowledge_bases)")
    kb_columns = [row[1] for row in cursor.fetchall()]
    if 'prompt_config' not in kb_columns:
        cursor.execute('ALTER TABLE knowledge_bases ADD COLUMN prompt_config TEXT DEFAULT ""')
    if 'negative_prompt' not in kb_columns:
        cursor.execute('ALTER TABLE knowledge_bases ADD COLUMN negative_prompt TEXT DEFAULT ""')
    conn.commit()
    conn.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
