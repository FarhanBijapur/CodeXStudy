
export interface PlanInput {
  subjects: string; // Comma-separated subject names, optionally with priority e.g., "Math (1), Physics (2)"
  dailyStudyHours: number;
  studyDurationDays: number;
  subjectDetails?: string; // Optional: User provides details about topics/chapters
  startDate?: string; // Optional: YYYY-MM-DD format
}

export interface SubTask {
  id: string;
  text: string;
  completed: boolean;
}

export interface ScheduleTask {
  id:string; // Unique ID for the task within its plan
  date: string; // YYYY-MM-DD
  task: string;
  completed: boolean;
  youtubeSearchQuery?: string;
  referenceSearchQuery?: string;
  subTasks?: SubTask[];
  quizScore?: number;
  quizAttempted?: boolean;
  notes?: string; // Added for short task notes
}

export interface ParsedRawScheduleItem {
  date: string; // YYYY-MM-DD
  task: string;
  youtubeSearchQuery?: string;
  referenceSearchQuery?: string;
  // Notes are not typically part of AI-generated raw schedule
}

export interface ScheduleData {
  id: string; // Unique ID for this specific plan instance
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  scheduleString: string; // The raw JSON string from AI (or revised)
  tasks: ScheduleTask[];
  planDetails: PlanInput;
  status: 'active' | 'completed' | 'archived'; // More refined status
  completionDate?: string; // ISO string
  lastReminderSentDate?: string; // ISO date string
  // Optional: add fields for plan overview stats if needed from your HTML
  daysToGoal?: number;
  successProbability?: number;
  totalHours?: number;
}


export interface AISettings {
  plannerBotEnabled: boolean;
  reflectionAiEnabled: boolean;
  adaptiveAiEnabled: boolean;
}

// For mock authentication
export interface UserCredentials {
  name: string;
  email: string;
  password?: string;
}

// What's actually stored in local storage for the list of users
export interface StoredUser extends Required<Omit<UserCredentials, 'password'>> {
  id: string;
  email: string;
  password_unsafe: string;
  studyLevel?: string;
  preferredStudyTime?: string;
  aiSettings?: AISettings;
  securityQuestion?: string;
  securityAnswer?: string;
}

export interface Achievement {
  id: string;
  title: string;
  icon: React.ElementType;
  description: string;
  achieved: boolean;
  color?: string;
}


// For dashboard display
export interface AgentDisplayData {
  name: string;
  avatar: string;
  role: string;
  specialty?: string;
  confidence: number;
  active?: boolean;
  agentKey: string;
}

export interface InsightDisplayData { // For Analytics Page
  agent: string;
  text: string;
  confidence?: string;
  actionText?: string;
  primaryAction?: boolean;
}

export interface SampleSubject {
  id: string;
  name: string;
  emoji: string;
  difficulty?: string;
  progress?: number;
}

// Quiz Related Types
export interface QuizQuestion {
  id: string; // Unique ID for the question
  questionText: string;
  options: string[]; // Array of answer options
  correctOptionIndex: number; // Index of the correct answer in the options array
}

export type Quiz = QuizQuestion[];

// Input for the AI flow to generate a quiz
export interface GenerateTaskQuizInput {
  taskText: string;
  subjectContext: string; // e.g., "Physics" or "Algebra Chapter 2"
}

// Output from the AI flow (the quiz itself as a JSON string)
export interface GenerateTaskQuizOutput {
  quizJson: string; // A JSON string that parses into Quiz
}

// Chatbot specific types
export interface StudyAssistantChatInput {
  query: string;
}

export interface StudyAssistantChatOutput {
  response: string;
}
