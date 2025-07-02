
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
  
  const { subjects } = planDetails;

  const msg = {
    to: email,
    from: 'devanshm.btech23@rvu.edu.in', // Must match your SendGrid sender
    subject: `🎉 Congratulations! You've Completed a CodeXStudy Plan!`,
    html: `
      <h2>Congratulations, ${name}!</h2>
      <p>Incredible work! You have successfully completed your study plan for <strong>${subjects}</strong>.</p>
      <p>This is a huge accomplishment. Don't forget to check out the <strong>Analytics</strong> page in the app to see a detailed reflection on your performance and insights for your next plan.</p>
      <p>Keep up the amazing momentum!</p>
      <p><strong>The CodeXStudy Team</strong></p>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`Plan completion email successfully dispatched to SendGrid for: ${email}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("SendGrid error (plan completion):", error);
     if (error && typeof error === 'object' && 'response' in error) {
      const sgError = error as { response?: { body?: any } };
      console.error("SendGrid response body:", sgError.response?.body);
    }
    return NextResponse.json({ success: false, error: "Failed to send plan completion email." }, { status: 500 });
  }
}
