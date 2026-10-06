# TaskFlow Enterprise Database Backup & Disaster Recovery Guide

## 1. Overview
TaskFlow provides an enterprise-ready backup, retention, and point-in-time recovery procedure supporting both live MongoDB clusters and persistent file-backed data stores.

---

## 2. Automated & Manual Backup Procedures

### A. Snapshot Creation (CLI)
To trigger an immediate snapshot:
```bash
cd backend
node scripts/backup_restore.js backup
```
*Creates a timestamped snapshot under `backend/backups/` and automatically applies the 7-day retention policy.*

### B. MongoDB Cluster Native Backup (Production)
For MongoDB Atlas or dedicated MongoDB instances:
```bash
# Dump entire TaskFlow database
mongodump --uri="$MONGODB_URI" --out="./backups/mongo_dump_$(date +%Y%m%d_%H%M%S)" --gzip

# Dump specific collection (e.g., leads, opportunities, auditlogs)
mongodump --uri="$MONGODB_URI" --collection=leads --out="./backups/leads_dump" --gzip
```

---

## 3. Disaster Recovery & Restore Procedures

### A. Point-in-Time Restore (CLI)
1. List available snapshots:
   ```bash
   node scripts/backup_restore.js list
   ```
2. Restore selected snapshot:
   ```bash
   node scripts/backup_restore.js restore taskflow_backup_YYYY-MM-DDTHH-MM-SS.json
   ```
   *Note: A pre-restore emergency rollback snapshot (`taskflow_prerestore_<timestamp>.json`) is created automatically prior to applying any restoration.*

### B. MongoDB Cluster Native Restore
```bash
mongorestore --uri="$MONGODB_URI" --dir="./backups/mongo_dump_TIMESTAMP" --gzip --drop
```

---

## 4. Retention & Lifecycle Policy
- **Daily Retention**: Keeps rolling snapshots for the last 7 days (`MAX_RETENTION_DAYS = 7`).
- **Rotation**: Snapshots older than 7 days are automatically purged upon each backup run.
- **Off-site Sync**: Backups directory should be mounted to an encrypted AWS S3 / Cloud Storage bucket with lifecycle rule enabling 30-day Glacier archiving.

---

## 5. Audit & Compliance
Every backup and restore operation generates log entries with timestamp, operator ID, and snapshot integrity checksums.
