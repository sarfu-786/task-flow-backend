const net = require('net');
const tls = require('tls');
const Notification = require('../models/Notification');
const { fallbackStore } = require('../config/db');

/**
 * Pure Node.js Socket SMTP Sender
 * Works without external npm packages (no nodemailer required).
 */
function extractBareEmail(str) {
  if (!str) return '';
  const match = str.match(/<([^>]+)>/);
  return (match ? match[1] : str).trim();
}

function sendViaSmtpSocket({ host, port, secure, user, pass, from, to, subject, html, text }) {
  return new Promise((resolve, reject) => {
    const isSecure = secure || port === 465;
    const cleanUser = (user || '').trim();
    const cleanPass = (pass || '').replace(/\s+/g, '');
    const cleanFrom = extractBareEmail(from || user);
    const cleanTo = extractBareEmail(to);

    const socket = isSecure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false })
      : net.connect({ host, port });

    let step = 0;
    let buffer = '';
    const timeoutMs = 12000;

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`SMTP connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const send = (cmd) => {
      socket.write(cmd + '\r\n');
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop(); // keep remainder

      for (const line of lines) {
        if (!line.trim()) continue;
        const code = parseInt(line.substring(0, 3), 10);
        const isLastLine = line.charAt(3) === ' ';

        if (!isLastLine) continue;

        if (code >= 400) {
          clearTimeout(timer);
          socket.end();
          return reject(new Error(`SMTP Error (${code}): ${line}`));
        }

        if (step === 0 && code === 220) {
          step = 1;
          send(`EHLO ${host}`);
        } else if (step === 1 && code === 250) {
          if (cleanUser && cleanPass) {
            step = 2;
            send('AUTH LOGIN');
          } else {
            step = 4;
            send(`MAIL FROM:<${cleanFrom}>`);
          }
        } else if (step === 2 && code === 334) {
          step = 3;
          send(Buffer.from(cleanUser).toString('base64'));
        } else if (step === 3 && code === 334) {
          step = 4;
          send(Buffer.from(cleanPass).toString('base64'));
        } else if (step === 4 && code === 235) {
          step = 5;
          send(`MAIL FROM:<${cleanFrom}>`);
        } else if (step === 5 && code === 250) {
          step = 6;
          send(`RCPT TO:<${cleanTo}>`);
        } else if (step === 6 && code === 250) {
          step = 7;
          send('DATA');
        } else if (step === 7 && code === 354) {
          step = 8;
          const mimeMessage = [
            `From: ${from}`,
            `To: ${to}`,
            `Subject: ${subject}`,
            `Date: ${new Date().toUTCString()}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            '',
            html || text,
            '.',
          ].join('\r\n');
          send(mimeMessage);
        } else if (step === 8 && code === 250) {
          clearTimeout(timer);
          send('QUIT');
          socket.end();
          return resolve({ success: true, messageId: line });
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Dispatch an individual email message
 */
async function sendEmail({ to, subject, html, text }) {
  if (!to || !to.includes('@')) {
    return {
      success: false,
      status: 'Failed',
      error: 'Invalid or missing recipient email address',
    };
  }

  const smtpHost = process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '465', 10);
  const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
  const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '');
  const fromAddress = process.env.EMAIL_FROM || process.env.SMTP_FROM || (smtpUser ? `TaskFlow Support <${smtpUser}>` : 'support@taskflow.com');

  const isSimulated =
    process.env.EMAIL_DELIVERY_MODE === 'simulated' ||
    process.env.NODE_ENV === 'test' ||
    process.env.SIMULATE_EMAIL === 'true';

  // If simulated mode is enabled, safely log and report success (support simulation of delivery failure)
  if (isSimulated) {
    if (to.toLowerCase().includes('fail')) {
      return {
        success: false,
        status: 'Failed',
        error: 'Simulated delivery failure: mailbox rejected',
        recipient: to,
      };
    }
    console.log(`[Email Simulation] To: ${to} | Subject: ${subject}`);
    return {
      success: true,
      status: 'Sent Successfully',
      sentAt: new Date().toISOString(),
      recipient: to,
    };
  }

  // If SMTP credentials are provided, attempt delivery via socket client
  if (smtpHost && smtpUser) {
    try {
      await sendViaSmtpSocket({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        user: smtpUser,
        pass: smtpPass,
        from: fromAddress,
        to,
        subject,
        html,
        text,
      });

      return {
        success: true,
        status: 'Sent Successfully',
        sentAt: new Date().toISOString(),
        recipient: to,
      };
    } catch (err) {
      console.warn(`[SMTP Delivery Failed to ${to}]`, err.message);
      return {
        success: false,
        status: 'Failed',
        error: err.message || 'SMTP delivery failed',
        recipient: to,
      };
    }
  }

  // If no SMTP host is configured, accurately report Failed without false success
  return {
    success: false,
    status: 'Failed',
    error: 'SMTP service not configured on server (missing SMTP_HOST/SMTP_USER)',
    recipient: to,
  };
}

/**
 * Resolve Assigned Manager or Admin dynamically based on organizational hierarchy
 */
function resolveAssignedManagerOrAdmin(complaint, creator, allUsers = []) {
  if (!allUsers || allUsers.length === 0) {
    allUsers = fallbackStore.users || [];
  }

  const findUserByIdOrName = (idOrName) => {
    if (!idOrName) return null;
    const str = idOrName.toString().trim().toLowerCase();
    return allUsers.find(
      (u) =>
        (u._id && u._id.toString() === str) ||
        (u.name && u.name.trim().toLowerCase() === str) ||
        (u.email && u.email.trim().toLowerCase() === str)
    );
  };

  let assignedUser = null;
  if (complaint.assignedTo) {
    assignedUser = findUserByIdOrName(complaint.assignedTo);
  }
  if (!assignedUser && complaint.assignedToName && complaint.assignedToName !== 'Unassigned') {
    assignedUser = findUserByIdOrName(complaint.assignedToName);
  }

  // If assigned user is already a Manager or Admin, they are the recipient
  if (assignedUser && ['Manager', 'Admin', 'Super Admin'].includes(assignedUser.role)) {
    if (assignedUser.email && assignedUser.email.includes('@')) {
      return {
        resolved: true,
        recipient: assignedUser.email.trim().toLowerCase(),
        recipientName: assignedUser.name,
        role: assignedUser.role,
        userId: assignedUser._id,
      };
    }
  }

  // If assigned user is a regular User, resolve their reporting manager
  if (assignedUser && assignedUser.reportsTo) {
    const mgr = findUserByIdOrName(assignedUser.reportsTo) || findUserByIdOrName(assignedUser.reportsToName);
    if (mgr && mgr.email && mgr.email.includes('@')) {
      return {
        resolved: true,
        recipient: mgr.email.trim().toLowerCase(),
        recipientName: mgr.name,
        role: mgr.role,
        userId: mgr._id,
      };
    }
  }

  // If ticket creator has a reporting manager, use creator's manager
  if (creator && creator.reportsTo) {
    const mgr = findUserByIdOrName(creator.reportsTo) || findUserByIdOrName(creator.reportsToName);
    if (mgr && mgr.email && mgr.email.includes('@')) {
      return {
        resolved: true,
        recipient: mgr.email.trim().toLowerCase(),
        recipientName: mgr.name,
        role: mgr.role,
        userId: mgr._id,
      };
    }
  }

  // Fallback to active Manager or Admin within the organization
  const activeManagerOrAdmin = allUsers.find(
    (u) =>
      ['Manager', 'Admin'].includes(u.role) &&
      u.email &&
      u.email.includes('@') &&
      (!u.status || u.status === 'Active')
  );
  if (activeManagerOrAdmin) {
    return {
      resolved: true,
      recipient: activeManagerOrAdmin.email.trim().toLowerCase(),
      recipientName: activeManagerOrAdmin.name,
      role: activeManagerOrAdmin.role,
      userId: activeManagerOrAdmin._id,
    };
  }

  // Fallback to Super Admin
  const superAdmin = allUsers.find(
    (u) => u.role === 'Super Admin' && u.email && u.email.includes('@')
  );
  if (superAdmin) {
    return {
      resolved: true,
      recipient: superAdmin.email.trim().toLowerCase(),
      recipientName: superAdmin.name,
      role: superAdmin.role,
      userId: superAdmin._id,
    };
  }

  return {
    resolved: false,
    recipient: '',
    recipientName: '',
    error: 'No manager or admin record with a valid email found in database',
  };
}

/**
 * Dispatch complaint customer confirmation email
 */
async function sendComplaintCustomerEmail(complaint) {
  const customerEmail = (complaint.customerEmail || '').trim().toLowerCase();
  if (!customerEmail || !customerEmail.includes('@')) {
    return {
      status: 'Failed',
      recipient: customerEmail,
      error: 'Customer record has no registered email address in database',
    };
  }

  const subject = `Complaint Registered Successfully – [${complaint.ticketNumber}]`;
  const submissionDate = complaint.createdAt
    ? new Date(complaint.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString();

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 20px; border-radius: 8px; color: #ffffff; text-align: center;">
        <h1 style="margin: 0; font-size: 20px; font-weight: 700;">Complaint Registration Confirmation</h1>
        <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">Ticket Number: <strong>${complaint.ticketNumber}</strong></p>
      </div>

      <div style="padding: 20px 0;">
        <p style="font-size: 15px; color: #334155; margin-top: 0;">
          Dear <strong>${complaint.customerName}</strong>,
        </p>
        <p style="font-size: 14px; color: #475569; line-height: 1.6;">
          Your complaint has been successfully registered with TaskFlow. Our technical and customer support team has initiated review of your grievance in accordance with our SLA commitment.
        </p>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <h2 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 700; color: #1e293b; text-transform: uppercase; letter-spacing: 0.05em;">Ticket Details</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 140px;">Ticket Number:</td>
              <td style="padding: 6px 0; font-weight: 700; color: #0f172a;">${complaint.ticketNumber}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Subject:</td>
              <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${complaint.subject}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Category:</td>
              <td style="padding: 6px 0; color: #334155;">${complaint.category || 'General'} (${complaint.subCategory || 'Standard'})</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Current Status:</td>
              <td style="padding: 6px 0;"><span style="background: #eff6ff; color: #2563eb; padding: 2px 8px; border-radius: 4px; font-weight: 600;">${complaint.status || 'Logged'}</span></td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Submission Date:</td>
              <td style="padding: 6px 0; color: #334155;">${submissionDate}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">SLA Target:</td>
              <td style="padding: 6px 0; color: #334155;">${complaint.slaHours || 24} Hours</td>
            </tr>
          </table>
        </div>

        <div style="margin: 20px 0;">
          <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 4px;">Description:</div>
          <div style="font-size: 13px; color: #334155; line-height: 1.6; background: #ffffff; border: 1px solid #f1f5f9; padding: 12px; border-radius: 6px;">
            ${complaint.description}
          </div>
        </div>

        <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
          You can quote ticket number <strong>${complaint.ticketNumber}</strong> in any follow-up communication.
        </p>
      </div>

      <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
        TaskFlow Support Team • Automated Notification • Please do not reply directly to this email
      </div>
    </div>
  `;

  const text = `
Complaint Registered Successfully – [${complaint.ticketNumber}]

Dear ${complaint.customerName},

Your complaint has been successfully registered with TaskFlow.

Ticket Number: ${complaint.ticketNumber}
Subject: ${complaint.subject}
Category: ${complaint.category || 'General'}
Current Status: ${complaint.status || 'Logged'}
Submission Date: ${submissionDate}
SLA Target: ${complaint.slaHours || 24} Hours

Description:
${complaint.description}

Thank you,
TaskFlow Support Team
  `.trim();

  const res = await sendEmail({ to: customerEmail, subject, html, text });
  return {
    status: res.status,
    recipient: customerEmail,
    sentAt: res.sentAt || null,
    error: res.error || '',
  };
}

/**
 * Dispatch assigned manager or admin complaint notification email
 */
async function sendComplaintManagerEmail(complaint, creator, allUsers) {
  const managerResolution = resolveAssignedManagerOrAdmin(complaint, creator, allUsers);
  if (!managerResolution.resolved || !managerResolution.recipient) {
    return {
      status: 'Failed',
      recipient: '',
      recipientName: '',
      error: managerResolution.error || 'No manager email resolved from hierarchy',
    };
  }

  const managerEmail = managerResolution.recipient;
  const managerName = managerResolution.recipientName || 'Manager';
  const subject = `[Action Required] New Complaint Ticket Logged – ${complaint.ticketNumber} (${complaint.priority} Priority)`;

  const submissionDate = complaint.createdAt
    ? new Date(complaint.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString();

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 20px; border-radius: 8px; color: #ffffff;">
        <h1 style="margin: 0; font-size: 18px; font-weight: 700;">New Customer Complaint Assigned</h1>
        <p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8;">Ticket: <strong style="color: #ffffff;">${complaint.ticketNumber}</strong> | Priority: <strong style="color: #f59e0b;">${complaint.priority}</strong></p>
      </div>

      <div style="padding: 20px 0;">
        <p style="font-size: 15px; color: #334155; margin-top: 0;">
          Hello <strong>${managerName}</strong>,
        </p>
        <p style="font-size: 14px; color: #475569; line-height: 1.6;">
          A new complaint has been filed and routed to your department / organizational scope. Please review the ticket details below and coordinate resolution within the allocated SLA deadline.
        </p>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 18px 0;">
          <h2 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #1e293b; text-transform: uppercase;">Customer & Incident Summary</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 140px;">Customer Name:</td>
              <td style="padding: 5px 0; font-weight: 700; color: #0f172a;">${complaint.customerName}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Organization:</td>
              <td style="padding: 5px 0; color: #334155;">${complaint.organization || complaint.account || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Customer Email:</td>
              <td style="padding: 5px 0; color: #334155;">${complaint.customerEmail || 'No email registered'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Customer Phone:</td>
              <td style="padding: 5px 0; color: #334155;">${complaint.customerPhone || 'No contact number'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Subject:</td>
              <td style="padding: 5px 0; font-weight: 600; color: #0f172a;">${complaint.subject}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Severity / Priority:</td>
              <td style="padding: 5px 0; font-weight: 600; color: #dc2626;">${complaint.severity} / ${complaint.priority}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Assigned Owner:</td>
              <td style="padding: 5px 0; color: #334155;">${complaint.assignedToName || 'Unassigned'} (${complaint.team || 'Technical Support'})</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Submission Date:</td>
              <td style="padding: 5px 0; color: #334155;">${submissionDate}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">SLA Target:</td>
              <td style="padding: 5px 0; color: #334155;">${complaint.slaHours || 24} Hours</td>
            </tr>
          </table>
        </div>

        <div style="margin: 18px 0;">
          <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 4px;">Incident Description:</div>
          <div style="font-size: 13px; color: #334155; line-height: 1.6; background: #ffffff; border: 1px solid #f1f5f9; padding: 12px; border-radius: 6px;">
            ${complaint.description}
          </div>
        </div>
      </div>

      <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
        TaskFlow Organizational Escalation Engine • Logged by ${complaint.createdByName || 'Staff'}
      </div>
    </div>
  `;

  const text = `
[Action Required] New Complaint Ticket Logged – ${complaint.ticketNumber}

Hello ${managerName},

A new customer complaint has been registered and routed to your scope:

Ticket Number: ${complaint.ticketNumber}
Customer: ${complaint.customerName} (${complaint.organization || 'N/A'})
Contact: ${complaint.customerEmail || 'No email'} | ${complaint.customerPhone || 'No phone'}
Subject: ${complaint.subject}
Priority: ${complaint.priority} (${complaint.slaHours || 24}h SLA)
Assigned To: ${complaint.assignedToName || 'Unassigned'}
Team: ${complaint.team || 'Support'}
Submission Date: ${submissionDate}

Description:
${complaint.description}

TaskFlow Escalation Engine
  `.trim();

  const res = await sendEmail({ to: managerEmail, subject, html, text });

  // Create in-app Notification record for manager
  try {
    const notifObj = {
      user: managerResolution.userId || null,
      recipientUser: managerResolution.userId || null,
      recipientName: managerName || '',
      type: 'complaint_created',
      title: `New Ticket: ${complaint.ticketNumber}`,
      message: `${complaint.customerName}: ${complaint.subject} (${complaint.priority} priority)`,
      entityId: complaint._id ? complaint._id.toString() : complaint.ticketNumber,
      forRole: managerResolution.userId ? 'DirectRecipientOnly' : 'Manager',
      isRead: false,
      createdAt: new Date(),
    };

    if (fallbackStore.isFallback) {
      if (!fallbackStore.notifications) fallbackStore.notifications = [];
      fallbackStore.notifications.unshift({ ...notifObj, _id: 'notif_' + Date.now() });
      fallbackStore.saveToFile();
    } else {
      await Notification.create(notifObj);
    }
  } catch (err) {
    console.warn('[In-App Notification Creation Warning]', err.message);
  }

  return {
    status: res.status,
    recipient: managerEmail,
    recipientName: managerName,
    sentAt: res.sentAt || null,
    error: res.error || '',
  };
}

/**
 * Main coordinator to send all notifications independently with Promise.allSettled
 * Ensures failure of one email does not block or fail the other.
 */
async function sendComplaintNotifications({ complaint, creator, allUsers, io }) {
  const [customerResult, managerResult] = await Promise.allSettled([
    sendComplaintCustomerEmail(complaint),
    sendComplaintManagerEmail(complaint, creator, allUsers),
  ]);

  const customerStatus =
    customerResult.status === 'fulfilled'
      ? customerResult.value
      : {
          status: 'Failed',
          recipient: complaint.customerEmail || '',
          error: customerResult.reason ? customerResult.reason.message : 'Unknown customer email error',
        };

  const managerStatus =
    managerResult.status === 'fulfilled'
      ? managerResult.value
      : {
          status: 'Failed',
          recipient: '',
          recipientName: '',
          error: managerResult.reason ? managerResult.reason.message : 'Unknown manager email error',
        };

  return {
    customer: customerStatus,
    manager: managerStatus,
  };
}

/**
 * Dispatch assigned user notification email when a ticket is assigned or reassigned
 */
async function sendComplaintAssignmentEmail({
  complaint,
  assignedUser,
  assignedBy,
  reason = '',
  isReassignment = false,
}) {
  if (!assignedUser || !assignedUser.email || !assignedUser.email.includes('@')) {
    return {
      status: 'Skipped',
      recipient: assignedUser?.email || '',
      recipientName: assignedUser?.name || '',
      error: 'Assigned user does not have a registered email address in database',
    };
  }

  const userEmail = assignedUser.email.trim().toLowerCase();
  const userName = assignedUser.name || 'Team Member';
  const assignerName = assignedBy?.name || 'Super Admin';
  const assignerRole = assignedBy?.role || 'Administrator';

  const actionVerb = isReassignment ? 'Reassigned' : 'Assigned';
  const subject = `[Ticket ${actionVerb}] ${complaint.ticketNumber}: ${complaint.subject} (${complaint.priority} Priority)`;

  const submissionDate = complaint.createdAt
    ? new Date(complaint.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString();

  const priorityColor =
    complaint.priority === 'Critical'
      ? '#dc2626'
      : complaint.priority === 'High'
      ? '#ea580c'
      : complaint.priority === 'Medium'
      ? '#d97706'
      : '#2563eb';

  let locationHtml = '';
  let locationText = '';
  if (complaint.location && (complaint.location.city || complaint.location.latitude)) {
    const loc = complaint.location;
    const locParts = [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
    const mapUrl =
      loc.googleMapsUrl ||
      (loc.latitude && loc.longitude ? `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}` : '');
    locationHtml = `
      <tr>
        <td style="padding: 5px 0; color: #64748b;">Complainant Location:</td>
        <td style="padding: 5px 0; color: #0f172a;">
          ${locParts || 'Live Coordinates Recorded'}
          ${mapUrl ? `&nbsp;(<a href="${mapUrl}" target="_blank" style="color: #2563eb; text-decoration: underline; font-weight: 600;">Open in Google Maps</a>)` : ''}
        </td>
      </tr>
    `;
    locationText = locParts ? `Location: ${locParts} ${mapUrl ? `(${mapUrl})` : ''}` : '';
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 20px; border-radius: 8px; color: #ffffff;">
        <h1 style="margin: 0; font-size: 18px; font-weight: 700;">Complaint Ticket ${actionVerb} to You</h1>
        <p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8;">
          Ticket: <strong style="color: #ffffff;">${complaint.ticketNumber}</strong> | Priority: <strong style="color: ${priorityColor};">${complaint.priority}</strong>
        </p>
      </div>

      <div style="padding: 20px 0;">
        <p style="font-size: 15px; color: #334155; margin-top: 0;">
          Hello <strong>${userName}</strong>,
        </p>
        <p style="font-size: 14px; color: #475569; line-height: 1.6;">
          You have been ${actionVerb.toLowerCase()} customer complaint ticket <strong>${complaint.ticketNumber}</strong> by <strong>${assignerName}</strong> (${assignerRole}). Please review the incident details and coordinate resolution within the allocated SLA deadline.
        </p>

        ${
          reason
            ? `<div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 14px; border-radius: 4px; margin: 16px 0; font-size: 13px; color: #1e40af;">
                <strong>Assignment Note / Reason:</strong> ${reason}
              </div>`
            : ''
        }

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 18px 0;">
          <h2 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #1e293b; text-transform: uppercase;">Ticket Summary</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 140px;">Customer Name:</td>
              <td style="padding: 5px 0; font-weight: 700; color: #0f172a;">${complaint.customerName}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Organization:</td>
              <td style="padding: 5px 0; color: #334155;">${complaint.organization || complaint.account || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Customer Email:</td>
              <td style="padding: 5px 0; color: #334155;">${complaint.customerEmail || 'No email registered'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Customer Phone:</td>
              <td style="padding: 5px 0; color: #334155;">${complaint.customerPhone || 'No contact number'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Subject:</td>
              <td style="padding: 5px 0; font-weight: 600; color: #0f172a;">${complaint.subject}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Category / Type:</td>
              <td style="padding: 5px 0; color: #334155;">${complaint.category || 'General'} / ${complaint.complaintType || 'Complaint'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Severity / Priority:</td>
              <td style="padding: 5px 0; font-weight: 600; color: ${priorityColor};">${complaint.severity} / ${complaint.priority}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Assigned Team:</td>
              <td style="padding: 5px 0; color: #334155;">${complaint.team || 'Technical Support'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Submission Date:</td>
              <td style="padding: 5px 0; color: #334155;">${submissionDate}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">SLA Target:</td>
              <td style="padding: 5px 0; font-weight: 700; color: #059669;">${complaint.slaHours || 24} Hours SLA</td>
            </tr>
            ${locationHtml}
          </table>
        </div>

        <div style="margin: 18px 0;">
          <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 4px;">Incident Description:</div>
          <div style="font-size: 13px; color: #334155; line-height: 1.6; background: #ffffff; border: 1px solid #f1f5f9; padding: 12px; border-radius: 6px;">
            ${complaint.description}
          </div>
        </div>

        <p style="font-size: 13px; color: #64748b; line-height: 1.6; margin-bottom: 0;">
          Please open your <strong>TaskFlow Workspace</strong> to inspect the customer record, post follow-up logs, or resolve the ticket.
        </p>
      </div>

      <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
        TaskFlow Support & Incident Management • Assigned by ${assignerName}
      </div>
    </div>
  `;

  const text = `
Ticket ${actionVerb} to You: [${complaint.ticketNumber}]

Hello ${userName},

You have been ${actionVerb.toLowerCase()} complaint ticket ${complaint.ticketNumber} by ${assignerName} (${assignerRole}).

${reason ? `Assignment Note: ${reason}\n` : ''}
Customer: ${complaint.customerName} (${complaint.organization || 'N/A'})
Contact: ${complaint.customerEmail || 'No email'} | ${complaint.customerPhone || 'No phone'}
Subject: ${complaint.subject}
Priority: ${complaint.priority} (${complaint.slaHours || 24}h SLA)
Team: ${complaint.team || 'Support'}
Submission Date: ${submissionDate}
${locationText ? `${locationText}\n` : ''}

Description:
${complaint.description}

Please log in to your TaskFlow workspace to coordinate and resolve.
  `.trim();

  const res = await sendEmail({ to: userEmail, subject, html, text });
  return {
    status: res.status,
    recipient: userEmail,
    recipientName: userName,
    sentAt: res.sentAt || null,
    error: res.error || '',
  };
}

module.exports = {
  sendEmail,
  sendViaSmtpSocket,
  resolveAssignedManagerOrAdmin,
  sendComplaintCustomerEmail,
  sendComplaintManagerEmail,
  sendComplaintAssignmentEmail,
  sendComplaintNotifications,
};

