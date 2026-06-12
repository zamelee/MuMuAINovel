"""Migration: Create chapter_scene_states table for Batch 2 SceneStateTracker
Created: 2026-06-12
Matches: backend/app/models/memory.py ChapterSceneState
Matches: backend/app/services/scene_state_extractor.py"""

import sqlite3, os, shutil
from datetime import datetime

DB_PATH = r"D:\Documents\VibeCoding\MuMuAINovel\backend\data\ai_story.db"
# backup filename = data/ai_story_backup_YYYYMMDD_HHMMSS.db
BACKUP_BASENAME = "ai_story_backup_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".db"
BACKUP_PATH = os.path.join("data", BACKUP_BASENAME)

os.chdir(r"D:\Documents\VibeCoding\MuMuAINovel\backend")

if not os.path.exists(DB_PATH):
    print("[!] Database not found at " + DB_PATH)
    exit(1)

shutil.copy2(DB_PATH, BACKUP_PATH)
print("[1/4] Backup created: " + BACKUP_PATH)

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# 2. Check if table exists
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='chapter_scene_states'")
if cursor.fetchone():
    print("[2/4] Table chapter_scene_states already exists, skipping CREATE")
else:
    print("[2/4] Creating chapter_scene_states table...")
    cursor.execute("""
        CREATE TABLE chapter_scene_states (
            id VARCHAR(36) PRIMARY KEY,
            project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            chapter_id VARCHAR(36) NOT NULL UNIQUE REFERENCES chapters(id) ON DELETE CASCADE,
            chapter_number INTEGER NOT NULL,
            location VARCHAR(200),
            characters_present JSON,
            characters_left JSON,
            characters_entered JSON,
            items JSON,
            knowledge_states JSON,
            confidence FLOAT DEFAULT 0.5,
            extractor_version VARCHAR(20) DEFAULT "v1",
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    print("    Table created")

# 3. Create indexes
print("[3/4] Creating indexes...")
for idx_sql in [
    "CREATE INDEX IF NOT EXISTS ix_chapter_scene_states_project_id ON chapter_scene_states (project_id)",
    "CREATE INDEX IF NOT EXISTS ix_chapter_scene_states_chapter_id ON chapter_scene_states (chapter_id)",
    "CREATE INDEX IF NOT EXISTS ix_chapter_scene_states_chapter_number ON chapter_scene_states (chapter_number)",
]:
    cursor.execute(idx_sql)
conn.commit()
print("    Indexes created")

# 4. Verify
cursor.execute("SELECT COUNT(*) FROM chapter_scene_states")
print("[4/4] Total rows: " + str(cursor.fetchone()[0]))

conn.close()
print()
print("Migration complete! Table chapter_scene_states ready for SceneStateTracker.")
