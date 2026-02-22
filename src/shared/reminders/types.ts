export interface Reminder {
  id: string;
  message: string;
  /** For one-time: ISO datetime string. For recurring: cron expression */
  when: string;
  recurring: boolean;
  createdAt: string;
}

export interface RemindersFile {
  reminders: Reminder[];
}

export interface ScheduleReminderInput {
  message: string;
  /** ISO datetime string for one-time, cron expression for recurring */
  when: string;
  recurring?: boolean;
}
