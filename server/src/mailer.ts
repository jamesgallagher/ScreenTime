import nodemailer from 'nodemailer';
import type { SmtpConfig } from './config.js';

export interface Mailer {
  sendSignInCode(to: string, code: string): Promise<void>;
  /** A plain-text alert, such as the SOS email backup. Optional, so test mailers that only sign in can leave it out. */
  sendAlert?(to: string, subject: string, text: string): Promise<void>;
}

/** Sends email over SMTP (docs/SPEC.md §11.1), or logs the code when SMTP is not configured (dev and tests only). */
export function createMailer(smtp: SmtpConfig | null): Mailer {
  if (!smtp) {
    return {
      async sendSignInCode(to, code) {
        console.log(`SMTP not configured: sign-in code for ${to} is ${code}`);
      },
      async sendAlert(to, subject) {
        console.log(`SMTP not configured: alert for ${to}: ${subject}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // 465 is implicit TLS; any other port (587) upgrades with STARTTLS.
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  return {
    async sendSignInCode(to, code) {
      await transport.sendMail({
        from: { name: smtp.fromName, address: smtp.from },
        to,
        subject: `Your ScreenTime sign-in code: ${code}`,
        text: `Your ScreenTime sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not ask for it, ignore this email.\n`,
      });
    },
    async sendAlert(to, subject, text) {
      await transport.sendMail({ from: { name: smtp.fromName, address: smtp.from }, to, subject, text });
    },
  };
}
