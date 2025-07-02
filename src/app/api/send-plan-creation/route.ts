
import { NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";
import type { PlanInput } from "@/types";

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

interface RequestBody {
    email: string;
    name: string;
    planDetails: PlanInput;
}

export async function POST(req: Request) {
  const { email, name, planDetails } = await req.json() as RequestBody;

  if (!email || !name || !planDetails) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { subjects, studyDurationDays, dailyStudyHours } = planDetails;

  const msg = {
    to: email,
    from: 'devanshm.btech23@rvu.edu.in', // Must match your SendGrid sender
    subject: `🚀 Your New CodeXStudy Plan has been Created!`,
    html: `
      <h2>Hi ${name},</h2>
      <p>Great job taking the first step! Your new personalized study plan for <strong>${subjects}</strong> has been successfully created.</p>
      <h3>Plan Overview:</h3>
      <ul>
        <li><strong>Subjects:</strong> ${subjects}</li>
        <li><strong>Total Duration:</strong> ${studyDurationDays} days</li>
        <li><strong>Daily Goal:</strong> ${dailyStudyHours} hours</li>
      </ul>
      <p>You can view and start tracking your progress by logging into the app.</p>
      <p>Happy studying!</p>
      <p><strong>The CodeXStudy Team</strong></p>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`Plan creation email successfully dispatched to SendGrid for: ${email}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("SendGrid error (plan creation):", error);
    if (error && typeof error === 'object' && 'response' in error) {
      const sgError = error as { response?: { body?: any } };
      console.error("SendGrid response body:", sgError.response?.body);
    }
    return NextResponse.json({ success: false, error: "Failed to send plan creation email." }, { status: 500 });
  }
}
