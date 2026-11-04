from app.core.database import ensure_schema
from app.models import models

def init_db():
    ensure_schema()
    print("Database tables created")

if __name__ == "__main__":
    init_db()
