import { injectable } from 'tsyringe';
import nodemailer, { Transporter } from 'nodemailer';
import { smtpEnvironment } from '@core/config/environments';
import { ISendEmailRequest } from '@core/common/interfaces/ISendEmailRequest';

@injectable()
export class EmailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const port = smtpEnvironment.getSmtpPort();
    const isSecure = smtpEnvironment.getSmtpSecure() || port === 465;
    const useTls = smtpEnvironment.getSmtpTls();

    this.transporter = nodemailer.createTransport({
      host: smtpEnvironment.getSmtpServer(),
      port: port,
      secure: isSecure,
      requireTLS: useTls && !isSecure,
      auth: {
        user: smtpEnvironment.getSmtpUsername(),
        pass: smtpEnvironment.getSmtpPassword(),
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    return this.transporter;
  }

  async sendEmail(data: ISendEmailRequest): Promise<void> {
    const transporter = this.getTransporter();

    const mailOptions = {
      from: smtpEnvironment.getSmtpFrom(),
      to: Array.isArray(data.to) ? data.to.join(', ') : data.to,
      subject: data.subject,
      html: data.html,
      text: data.text,
      cc: data.cc
        ? Array.isArray(data.cc)
          ? data.cc.join(', ')
          : data.cc
        : undefined,
      bcc: data.bcc
        ? Array.isArray(data.bcc)
          ? data.bcc.join(', ')
          : data.bcc
        : undefined,
      attachments: data.attachments,
    };

    await transporter.sendMail(mailOptions);
  }

  async verifyConnection(): Promise<boolean> {
    try {
      const transporter = this.getTransporter();
      await transporter.verify();
      return true;
    } catch (error) {
      console.error('Erro ao verificar conexão SMTP:', error);
      return false;
    }
  }
}
