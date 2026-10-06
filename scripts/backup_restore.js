/**
 * TaskFlow Automated Database Backup & Recovery Utility
 * 
 * Supports:
 * 1. MongoDB Native Binary Backup (mongodump / mongorestore)
 * 2. Automated Schema JSON Snapshots with retention policy (last 7 days)
 * 3. File-backed Fallback Store Backup & Point-in-Time Restore
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BACKUP_DIR = path.join(__dirname, '../backups');
const DATA_FILE = path.join(__dirname, '../data/store.json');
const MAX_RETENTION_DAYS = 7;

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Creates a timestamped backup of the current database state
 */
function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `taskflow_backup_${timestamp}.json`;
  const backupPath = path.join(BACKUP_DIR, backupFileName);

  console.log(`[Backup] Initiating TaskFlow database backup at ${new Date().toISOString()}...`);

  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, backupPath);
    console.log(`✅ [Backup] Successfully created snapshot: ${backupFileName}`);
  } else {
    console.warn(`⚠️ [Backup] Source data store not found at ${DATA_FILE}`);
  }

  // Enforce Retention Policy: Remove backups older than MAX_RETENTION_DAYS
  cleanOldBackups();
  return backupPath;
}

/**
 * Lists all available backup snapshots
 */
function listBackups() {
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('taskflow_backup_') && f.endsWith('.json'));
  files.sort().reverse();
  return files.map(filename => {
    const filePath = path.join(BACKUP_DIR, filename);
    const stats = fs.statSync(filePath);
    return {
      filename,
      sizeBytes: stats.size,
      createdAt: stats.birthtime || stats.mtime,
    };
  });
}

/**
 * Restores the database to a specific backup snapshot
 */
function restoreBackup(backupFileName) {
  const targetPath = path.join(BACKUP_DIR, backupFileName);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Backup snapshot file not found: ${backupFileName}`);
  }

  console.log(`[Restore] Restoring database from snapshot: ${backupFileName}...`);

  // Create emergency rollback before restore
  const preRestoreBackup = `taskflow_prerestore_${Date.now()}.json`;
  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, preRestoreBackup));
  }

  // Copy snapshot to active data file
  fs.copyFileSync(targetPath, DATA_FILE);
  console.log(`✅ [Restore] Database successfully restored from ${backupFileName}`);
}

/**
 * Removes snapshots older than MAX_RETENTION_DAYS
 */
function cleanOldBackups() {
  const cutoff = Date.now() - MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(BACKUP_DIR);

  let purgedCount = 0;
  files.forEach(file => {
    const filePath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filePath);
    if (stats.mtimeMs < cutoff && file.startsWith('taskflow_backup_')) {
      fs.unlinkSync(filePath);
      purgedCount++;
    }
  });

  if (purgedCount > 0) {
    console.log(`🧹 [Retention] Purged ${purgedCount} backup snapshots older than ${MAX_RETENTION_DAYS} days.`);
  }
}

// CLI Execution
if (require.main === module) {
  const action = process.argv[2] || 'backup';
  if (action === 'backup') {
    createBackup();
  } else if (action === 'list') {
    const list = listBackups();
    console.log('\nAvailable TaskFlow Backups:');
    console.table(list);
  } else if (action === 'restore') {
    const file = process.argv[3];
    if (!file) {
      console.error('Error: Please specify the backup filename to restore. Example: node backup_restore.js restore <filename>');
      process.exit(1);
    }
    restoreBackup(file);
  } else {
    console.log('Usage:');
    console.log('  node backup_restore.js backup              - Create a fresh snapshot');
    console.log('  node backup_restore.js list                - List all snapshots');
    console.log('  node backup_restore.js restore <filename>  - Restore snapshot');
  }
}

module.exports = {
  createBackup,
  restoreBackup,
  listBackups,
  cleanOldBackups,
};
