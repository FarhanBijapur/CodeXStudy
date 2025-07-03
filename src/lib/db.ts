
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import path from 'path';
import fs from 'fs/promises'; // For ensuring directory exists

// Define the path for the database file
const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'mydb.sqlite');

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  // Ensure the data directory exists
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create database directory:', error);
    throw error; // Re-throw if directory creation fails
  }

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  // Run migrations/initial setup
  await db.exec(`
    PRAGMA foreign_keys = ON; -- Enable foreign key constraints

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      studyLevel TEXT,
      preferredStudyTime TEXT,
      aiSettings_json TEXT,
      securityQuestion TEXT,
      securityAnswer_hash TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_plans (
      id TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      scheduleString TEXT, -- Can be NULL if tasks are always parsed and stored separately
      subjects TEXT NOT NULL,
      dailyStudyHours REAL NOT NULL,
      studyDurationDays INTEGER NOT NULL,
      subjectDetails TEXT,
      startDate TEXT,
      status TEXT NOT NULL DEFAULT 'active', -- 'active', 'completed', 'archived'
      completionDate TEXT,
      lastReminderSentDate TEXT, -- Date reminder was last sent
      FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS schedule_tasks (
      id TEXT PRIMARY KEY,
      planId TEXT NOT NULL,
      date TEXT NOT NULL,
      task TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      youtubeSearchQuery TEXT,
      referenceSearchQuery TEXT,
      quizScore INTEGER,
      quizAttempted BOOLEAN DEFAULT FALSE,
      -- 'notes' column might be missing if table was created before this field was added to the CREATE statement
      FOREIGN KEY (planId) REFERENCES study_plans (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sub_tasks (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        text TEXT NOT NULL,
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        FOREIGN KEY (taskId) REFERENCES schedule_tasks (id) ON DELETE CASCADE
    );
  `);
  
  // Schema migration check for 'notes' column in 'schedule_tasks'
  try {
    const scheduleTasksInfo = await db.all("PRAGMA table_info(schedule_tasks);");
    const notesColumnExists = scheduleTasksInfo.some(col => col.name === 'notes');

    if (!notesColumnExists) {
      console.log("Attempting to add 'notes' column to 'schedule_tasks' table.");
      await db.exec("ALTER TABLE schedule_tasks ADD COLUMN notes TEXT;");
      console.log("'notes' column added successfully to 'schedule_tasks'.");
    }
  } catch (migrationError) {
    console.error("Error during 'notes' column migration for 'schedule_tasks':", migrationError);
  }

  // Schema migration check for 'lastReminderSentDate' column in 'study_plans'
   try {
    const studyPlansInfo = await db.all("PRAGMA table_info(study_plans);");
    const reminderColumnExists = studyPlansInfo.some(col => col.name === 'lastReminderSentDate');

    if (!reminderColumnExists) {
      console.log("Attempting to add 'lastReminderSentDate' column to 'study_plans' table.");
      await db.exec("ALTER TABLE study_plans ADD COLUMN lastReminderSentDate TEXT;");
      console.log("'lastReminderSentDate' column added successfully to 'study_plans'.");
    }
  } catch (migrationError) {
    console.error("Error during 'lastReminderSentDate' column migration for 'study_plans':", migrationError);
  }
  
  dbInstance = db;
  return db;
}
