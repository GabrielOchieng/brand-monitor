import nodemailer from "nodemailer";
import { env } from "../env";

const transporter = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpPort === 465,
  auth: { user: env.smtpUser, pass: env.smtpPass },
});

export interface AlertEmailInput {
  to: string;
  findingIdentifier: string;
  findingId: string;
  previousScore: number;
  previousSeverity: string;
  newScore: number;
  newSeverity: string;
}

export async function sendAlertEmail(input: AlertEmailInput): Promise<void> {
  const link = `${env.webAppUrl}/threats/${input.findingId}`;
  const subject = `[Brand Monitor] ${input.findingIdentifier} is now ${input.newSeverity.toUpperCase()} (${input.newScore}/100)`;
  const text = [
    `${input.findingIdentifier} changed from ${input.previousSeverity} (${input.previousScore}/100) to ${input.newSeverity} (${input.newScore}/100).`,
    "",
    `View the full breakdown: ${link}`,
  ].join("\n");

  await transporter.sendMail({
    from: env.smtpFrom,
    to: input.to,
    subject,
    text,
  });
}
