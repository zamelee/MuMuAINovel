"""Migration: Move end_anchor from outlines to chapters"""
import sqlite3, os, shutil
from datetime import datetime

DB_PATH = r"D:\Documents\VibeCoding\MuMuAINovel\backend\data\ai_story.db"
BACKUP_PATH = f"data/ai_story_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"

os.chdir(r"D:\Documents\VibeCoding\MuMuAINovel\backend")

if not os.path.exists(DB_PATH):
    print(f"[!] Database not found at {DB_PATH}")
    exit(1)

shutil.copy2(DB_PATH, "data/" + os.path.basename(BACKUP_PATH))
print(f"[1/5] Backup created: data/{os.path.basename(BACKUP_PATH)}")

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# 2. Add end_anchor to chapters if not exists
cursor.execute("PRAGMA table_info(chapters)")
columns = [col[1] for col in cursor.fetchall()]
if "end_anchor" not in columns:
    print("[2/5] Adding end_anchor column to chapters...")
    cursor.execute("ALTER TABLE chapters ADD COLUMN end_anchor TEXT")
    conn.commit()
else:
    print("[2/5] end_anchor already exists in chapters")

# 3. Migrate data: outline.end_anchor → last chapter per outline
print("[3/5] Migrating anchor data...")
cursor.execute("SELECT id, end_anchor FROM outlines WHERE end_anchor IS NOT NULL AND end_anchor != ''")
outlines_with_anchor = cursor.fetchall()
migrated = 0
for outline_id, anchor in outlines_with_anchor:
    cursor.execute("SELECT id FROM chapters WHERE outline_id=? ORDER BY sub_index DESC LIMIT 1", (outline_id,))
    ch = cursor.fetchone()
    if ch:
        cursor.execute("UPDATE chapters SET end_anchor=? WHERE id=? AND (end_anchor IS NULL OR end_anchor='')", (anchor, ch[0]))
        if cursor.rowcount > 0:
            migrated += 1
conn.commit()
print(f"[3/5] Migrated {migrated} chapter anchors (from {len(outlines_with_anchor)} outlines)")

# 4. Verify
cursor.execute("SELECT COUNT(*) FROM chapters WHERE end_anchor IS NOT NULL AND end_anchor != ''")
print(f"[4/5] Chapters with anchors: {cursor.fetchone()[0]}")

# 5. Check outlines column still exists
cursor.execute("PRAGMA table_info(outlines)")
outline_cols = [col[1] for col in cursor.fetchall()]
print(f"[5/5] outlines.end_anchor column: {'exists (OK - kept for safety)' if 'end_anchor' in outline_cols else 'removed'}")

conn.close()
print("\nMigration complete!")
