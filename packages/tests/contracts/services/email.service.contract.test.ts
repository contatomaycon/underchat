import 'reflect-metadata';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

jest.mock('@core/config/environments', () => ({
  smtpEnvironment: {
    getSmtpPort: jest.fn(() => 587),
    getSmtpSecure: jest.fn(() => false),
    getSmtpTls: jest.fn(() => true),
    getSmtpServer: jest.fn(() => 'smtp.example.com'),
    getSmtpUsername: jest.fn(() => 'user'),
    getSmtpPassword: jest.fn(() => 'pass'),
    getSmtpFrom: jest.fn(() => 'no-reply@example.com'),
  },
}));

import nodemailer from 'nodemailer';
import { EmailService } from '@core/services/email.service';

describe('EmailService', () => {
  it('normalizes recipients and sends email', async () => {
    const sendMail = jest.fn(async () => undefined);
    const verify = jest.fn(async () => true);
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail,
      verify,
    });

    const service = new EmailService();

    await expect(
      service.sendEmail({
        to: ['a@x.com', 'b@x.com'],
        cc: ['c@x.com'],
        bcc: 'd@x.com',
        subject: 'Hello',
        html: '<b>ok</b>',
        text: 'ok',
      } as never)
    ).resolves.toBeUndefined();

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@x.com, b@x.com',
        cc: 'c@x.com',
        bcc: 'd@x.com',
        subject: 'Hello',
      })
    );
  });

  it('verifyConnection returns true and false on exception', async () => {
    const verify = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('smtp down'));

    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: jest.fn(),
      verify,
    });

    const service = new EmailService();

    await expect(service.verifyConnection()).resolves.toBe(true);
    await expect(service.verifyConnection()).resolves.toBe(false);
  });
});
