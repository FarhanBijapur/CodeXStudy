
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import sgMail from '@sendgrid/mail';
import { parseISO, isBefore, startOfToday, isSameDay } from 'date-fns';
import type { ScheduleData, StoredUser, ScheduleTask } from '@/types';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
const db = await getDb();

async function sendReminderEmail(email: string, name: string, planSubjects: string, daysBehind: number) {
  const msg = {
    to: email,
    from: 'devanshm.btech23@rvu.edu.in', // Must match your SendGrid sender
    subject: ` gentle reminder about your study plan`,
    html: `
      <h2>Hi ${name},</h2>
      <p>This is a friendly reminder to get back to your study plan for <strong>${planSubjects}</strong>. It looks like you've missed a day or two.</p>
      <p>Consistency is key to success. Don't lose your momentum! You can pick up right where you left off.</p>
      <p>Happy studying!</p>
      <p><strong>The CodeXStudy Team</strong></p>
    `,
  };
  await sgMail.send(msg);
}

export async function POST(req: Request) {
  try {
    const { userId, planId } = await req.json();

    if (!userId || !planId) {
      return NextResponse.json({ error: 'User ID and Plan ID are required' }, { status: 400 });
    }

    // 1. Fetch the plan and user details
    const plan = await db.get<ScheduleData>(
      'SELECT * FROM study_plans WHERE id = ? AND userId = ?',
      planId,
      userId
    );
    const user = await db.get<StoredUser>('SELECT name, email FROM users WHERE id = ?', userId);

    if (!plan || !user) {
      return NextResponse.json({ error: 'Plan or user not found' }, { status: 404 });
    }

    if (plan.status !== 'active') {
      return NextResponse.json({ message: 'No reminder needed for non-active plan.' });
    }

    // 2. Check if a reminder was already sent today
    if (plan.lastReminderSentDate) {
      const lastReminderDate = parseISO(plan.lastReminderSentDate);
      if (isSameDay(lastReminderDate, new Date())) {
        return NextResponse.json({ message: 'Reminder already sent today.' });
      }
    }

    // 3. Check if the user is behind schedule
    const tasks = await db.all<ScheduleTask[]>(
      'SELECT date, completed FROM schedule_tasks WHERE planId = ? ORDER BY date ASC',
      planId
    );
    
    const firstUncompletedTask = tasks.find(t => !t.completed);

    if (!firstUncompletedTask) {
      return NextResponse.json({ message: 'All tasks completed, no reminder needed.' });
    }
    
    const firstUncompletedDate = parseISO(firstUncompletedTask.date);
    const today = startOfToday();

    if (!isBefore(firstUncompletedDate, today)) {
       return NextResponse.json({ message: 'User is not behind schedule.' });
    }
    
    const daysBehind = Math.floor((today.getTime() - firstUncompletedDate.getTime()) / (1000 * 60 * 60 * 24));


    // 4. If all checks pass, send the email and update the timestamp
    await sendReminderEmail(user.email, user.name, plan.subjects, daysBehind);
    
    const todayISO = new Date().toISOString();
    await db.run(
      'UPDATE study_plans SET lastReminderSentDate = ? WHERE id = ?',
      todayISO,
      planId
    );

    return NextResponse.json({ success: true, message: 'Reminder email sent.' });

  } catch (error) {
    console.error('Send missed day reminder error:', error);
    if (error && typeof error === 'object' && 'response' in error) {
      const sgError = error as { response?: { body?: any } };
      console.error("SendGrid response body:", sgError.response?.body);
    }
    return NextResponse.json({ success: false, error: 'Failed to process reminder.' }, { status: 500 });
  }
}
