const bcrypt = require('bcryptjs');

const initialUsers = [
  {
    _id: '64e8a1000000000000000001',
    name: 'Sarfaraj Ahmad',
    email: 'sarfrajahamad068@gmail.com',
    username: 'sarfraj',
    password: 'user123',
    role: 'Super Admin',
    roles: ['Super Admin'],
    department: 'Executive Leadership',
    avatar: '',
    reportsTo: null,
    reportsToName: '',
    status: 'Approved',
    createdAt: new Date('2026-01-15T09:00:00Z'),
  },
];

const initialTasks = [];

const initialLeads = [
  {
    _id: '64e8a1000000000000000011',
    lead_id: 'lead_acme_enterprise_001',
    leadId: 'LD-001',
    name: 'Rohan Sharma',
    contactPerson: 'Rohan Sharma',
    company: 'Acme Enterprise Solutions',
    phone: '+91 98200 45678',
    mobileNumber: '+91 98200 45678',
    email: 'rohan.sharma@acme-solutions.com',
    source: 'Website',
    campaign_source: 'Google Search Ads',
    requirement: 'Enterprise Lead Management System with Call Logging, Follow-Up Daemon, and 50 user seats.',
    status: 'Interested',
    lead_status: 'IN_PROGRESS',
    priority: 'High',
    estimatedValue: 450000,
    dealValue: 450000,
    pipeline_value: 450000,
    currency: 'INR',
    assignedTo: 'Sarfaraj Ahmad',
    assignedSalesUser: 'Sarfaraj Ahmad',
    assignedManager: 'Executive Leadership',
    assignedManagerName: 'Sarfaraj Ahmad',
    lastContactDate: new Date('2026-09-26T15:30:00Z'),
    last_contacted_at: new Date('2026-09-26T15:30:00Z'),
    nextFollowUpDate: new Date('2026-09-27T11:00:00Z'),
    nextFollowUpTime: '11:00 AM',
    remarks: 'Customer is very interested in the LMS workflow. Send pricing proposal before tomorrow 11 AM.',
    notes: 'Customer is very interested in the LMS workflow. Send pricing proposal before tomorrow 11 AM.',
    opportunityId: null,
    convertedOpportunityId: null,
    convertedAt: null,
    callLogs: [
      {
        activityId: 'ACT-1001',
        leadId: 'LD-001',
        salesUser: 'Sarfaraj Ahmad',
        date: '2026-09-26',
        time: '10:00 AM',
        callType: 'Outgoing',
        callStatus: 'No Answer',
        duration: '35s',
        callOutcome: 'No Response',
        leadResponse: 'Ringing but no answer from client.',
        remarks: 'First contact attempt after website inquiry.',
        nextAction: 'Call Again',
        nextFollowUpDate: '2026-09-26',
        nextFollowUpTime: '11:30 AM',
        timestamp: new Date('2026-09-26T10:00:00Z'),
      },
      {
        activityId: 'ACT-1002',
        leadId: 'LD-001',
        salesUser: 'Sarfaraj Ahmad',
        date: '2026-09-26',
        time: '11:30 AM',
        callType: 'Outgoing',
        callStatus: 'Call Received',
        duration: '1m 15s',
        callOutcome: 'Call Later',
        leadResponse: 'Abhi busy hoon, 4 ghante baad call kijiye.',
        remarks: 'Client was in an executive meeting and requested immediate callback at 3:30 PM.',
        nextAction: 'Call Back',
        nextFollowUpDate: '2026-09-26',
        nextFollowUpTime: '03:30 PM',
        timestamp: new Date('2026-09-26T11:30:00Z'),
      },
      {
        activityId: 'ACT-1003',
        leadId: 'LD-001',
        salesUser: 'Sarfaraj Ahmad',
        date: '2026-09-26',
        time: '03:30 PM',
        callType: 'Outgoing',
        callStatus: 'Connected Successfully',
        duration: '6m 40s',
        callOutcome: 'Interested',
        leadResponse: 'Product demo looks exactly what we need. Please share detailed pricing for 50 seats.',
        remarks: 'Lead is interested in the product and wants pricing details.',
        nextAction: 'Send Proposal',
        nextFollowUpDate: '2026-09-27',
        nextFollowUpTime: '11:00 AM',
        timestamp: new Date('2026-09-26T15:30:00Z'),
      },
    ],
    followups: [
      {
        followUpId: 'FLW-1001',
        followUpDate: new Date('2026-09-26T15:30:00Z'),
        followUpTime: '03:30 PM',
        reason: 'Lead requested callback after 4 hours',
        assignedTo: 'Sarfaraj Ahmad',
        remarks: 'Completed successfully at 3:30 PM. Lead is interested.',
        status: 'Completed',
        completedAt: new Date('2026-09-26T15:30:00Z'),
        completedBy: 'Sarfaraj Ahmad',
        createdAt: new Date('2026-09-26T11:30:00Z'),
      },
      {
        followUpId: 'FLW-1002',
        followUpDate: new Date('2026-09-27T11:00:00Z'),
        followUpTime: '11:00 AM',
        reason: 'Proposal discussion and contract negotiation review',
        assignedTo: 'Sarfaraj Ahmad',
        remarks: 'Walkthrough commercial proposal with VP of Sales',
        status: 'Pending',
        createdAt: new Date('2026-09-26T15:30:00Z'),
      },
    ],
    timeline: [
      {
        eventId: 'EVT-1001',
        eventType: 'LEAD_CREATED',
        title: 'Lead Ingested from Website',
        description: 'New inquiry registered for 50 User Seats Enterprise LMS.',
        author: 'System',
        timestamp: new Date('2026-09-26T09:15:00Z'),
      },
      {
        eventId: 'EVT-1002',
        eventType: 'CALL_LOGGED',
        title: 'Call Attempt #1 — No Answer',
        description: 'Outgoing call placed by Sarfaraj Ahmad. Next Action: Call Again.',
        author: 'Sarfaraj Ahmad',
        timestamp: new Date('2026-09-26T10:00:00Z'),
      },
      {
        eventId: 'EVT-1003',
        eventType: 'CALL_LOGGED',
        title: 'Call Attempt #2 — Callback Requested (4 Hours)',
        description: 'Customer responded: "Abhi busy hoon, 4 ghante baad call kijiye." Scheduled callback for 3:30 PM.',
        author: 'Sarfaraj Ahmad',
        timestamp: new Date('2026-09-26T11:30:00Z'),
      },
      {
        eventId: 'EVT-1004',
        eventType: 'FOLLOWUP_UPDATED',
        title: 'Follow-Up Completed',
        description: '3:30 PM Callback executed on schedule.',
        author: 'Sarfaraj Ahmad',
        timestamp: new Date('2026-09-26T15:30:00Z'),
      },
      {
        eventId: 'EVT-1005',
        eventType: 'CALL_LOGGED',
        title: 'Call Attempt #3 — Connected Successfully (Interested)',
        description: 'Customer expressed high interest in LMS. Next Action: Send Proposal.',
        author: 'Sarfaraj Ahmad',
        timestamp: new Date('2026-09-26T15:30:00Z'),
      },
    ],
    createdAt: new Date('2026-09-26T09:15:00Z'),
    updatedAt: new Date('2026-09-26T15:30:00Z'),
  },
  {
    _id: '64e8a1000000000000000012',
    lead_id: 'lead_nexus_techworks_002',
    leadId: 'LD-002',
    name: 'Priya Patel',
    contactPerson: 'Priya Patel',
    company: 'Nexus Techworks India',
    phone: '+91 98111 22334',
    mobileNumber: '+91 98111 22334',
    email: 'priya.patel@nexustech.io',
    source: 'LinkedIn',
    campaign_source: 'B2B Sales Outreach',
    requirement: 'Multi-department organizational hierarchy and task SLA escalation engine.',
    status: 'Qualified',
    lead_status: 'IN_PROGRESS',
    priority: 'Urgent',
    estimatedValue: 720000,
    dealValue: 720000,
    pipeline_value: 720000,
    currency: 'INR',
    assignedTo: 'Sarfaraj Ahmad',
    assignedSalesUser: 'Sarfaraj Ahmad',
    assignedManager: 'Executive Leadership',
    assignedManagerName: 'Sarfaraj Ahmad',
    lastContactDate: new Date('2026-09-26T14:00:00Z'),
    last_contacted_at: new Date('2026-09-26T14:00:00Z'),
    nextFollowUpDate: new Date('2026-09-27T14:00:00Z'),
    nextFollowUpTime: '02:00 PM',
    remarks: 'Budget approved by CTO. Ready to convert to formal Opportunity proposal.',
    notes: 'Budget approved by CTO. Ready to convert to formal Opportunity proposal.',
    opportunityId: null,
    convertedOpportunityId: null,
    convertedAt: null,
    callLogs: [
      {
        activityId: 'ACT-1004',
        leadId: 'LD-002',
        salesUser: 'Sarfaraj Ahmad',
        date: '2026-09-26',
        time: '02:00 PM',
        callType: 'Outgoing',
        callStatus: 'Connected Successfully',
        duration: '12m 10s',
        callOutcome: 'Qualified',
        leadResponse: 'We have approved budget for Q4 deployment. Ready for commercial negotiation.',
        remarks: 'Technical qualification complete.',
        nextAction: 'Convert to Opportunity',
        nextFollowUpDate: '2026-09-27',
        nextFollowUpTime: '02:00 PM',
        timestamp: new Date('2026-09-26T14:00:00Z'),
      },
    ],
    followups: [
      {
        followUpId: 'FLW-1003',
        followUpDate: new Date('2026-09-27T14:00:00Z'),
        followUpTime: '02:00 PM',
        reason: 'Commercial contract sign-off meeting',
        assignedTo: 'Sarfaraj Ahmad',
        status: 'Pending',
        createdAt: new Date('2026-09-26T14:00:00Z'),
      },
    ],
    timeline: [
      {
        eventId: 'EVT-1006',
        eventType: 'LEAD_CREATED',
        title: 'Lead Ingested from LinkedIn',
        description: 'Direct outbound B2B prospect registered.',
        author: 'System',
        timestamp: new Date('2026-09-26T11:00:00Z'),
      },
      {
        eventId: 'EVT-1007',
        eventType: 'CALL_LOGGED',
        title: 'Technical Qualification Call — Qualified',
        description: 'Budget verified by client CTO. Lead marked as Qualified.',
        author: 'Sarfaraj Ahmad',
        timestamp: new Date('2026-09-26T14:00:00Z'),
      },
    ],
    createdAt: new Date('2026-09-26T11:00:00Z'),
    updatedAt: new Date('2026-09-26T14:00:00Z'),
  },
  {
    _id: '64e8a1000000000000000013',
    lead_id: 'lead_apex_healthcare_003',
    leadId: 'LD-003',
    name: 'Dr. Amit Verma',
    contactPerson: 'Dr. Amit Verma',
    company: 'Apex Healthcare Hospitals',
    phone: '+91 98333 44556',
    mobileNumber: '+91 98333 44556',
    email: 'dr.verma@apexhealth.org',
    source: 'Referral',
    campaign_source: 'Executive Referral',
    requirement: 'Complaint resolution & hospital equipment ticket management.',
    status: 'Converted',
    lead_status: 'CONVERTED',
    priority: 'High',
    estimatedValue: 1200000,
    dealValue: 1200000,
    pipeline_value: 1200000,
    currency: 'INR',
    assignedTo: 'Sarfaraj Ahmad',
    assignedSalesUser: 'Sarfaraj Ahmad',
    assignedManager: 'Executive Leadership',
    assignedManagerName: 'Sarfaraj Ahmad',
    lastContactDate: new Date('2026-09-25T16:00:00Z'),
    last_contacted_at: new Date('2026-09-25T16:00:00Z'),
    nextFollowUpDate: null,
    nextFollowUpTime: '',
    remarks: 'Lead successfully qualified and converted into formal Opportunity OP-001.',
    notes: 'Lead successfully qualified and converted into formal Opportunity OP-001.',
    opportunityId: 'OP-001',
    convertedOpportunityId: '64e8a1000000000000000021',
    convertedAt: new Date('2026-09-25T17:00:00Z'),
    convertedByName: 'Sarfaraj Ahmad',
    callLogs: [
      {
        activityId: 'ACT-1005',
        leadId: 'LD-003',
        salesUser: 'Sarfaraj Ahmad',
        date: '2026-09-25',
        time: '04:00 PM',
        callType: 'Outgoing',
        callStatus: 'Connected Successfully',
        duration: '15m 00s',
        callOutcome: 'Proposal Requested',
        leadResponse: 'Send formal RFP commercial proposal.',
        remarks: 'Lead converted directly to Opportunity OP-001.',
        nextAction: 'Send Proposal',
        timestamp: new Date('2026-09-25T16:00:00Z'),
      },
    ],
    followups: [],
    timeline: [
      {
        eventId: 'EVT-1008',
        eventType: 'LEAD_CREATED',
        title: 'Lead Created from Executive Referral',
        description: 'Hospital chain management system requirement.',
        author: 'System',
        timestamp: new Date('2026-09-25T12:00:00Z'),
      },
      {
        eventId: 'EVT-1009',
        eventType: 'CONVERTED_TO_OPPORTUNITY',
        title: 'Converted to Opportunity OP-001',
        description: 'Successfully converted to Opportunity OP-001 with deal value of ₹12,00,000.',
        author: 'Sarfaraj Ahmad',
        timestamp: new Date('2026-09-25T17:00:00Z'),
      },
    ],
    createdAt: new Date('2026-09-25T12:00:00Z'),
    updatedAt: new Date('2026-09-25T17:00:00Z'),
  },
];

const initialComplaints = [
  {
    _id: '64e8a1000000000000000031',
    ticketNumber: 'CMP-0001',
    complaintId: 'CMP-0001',
    customerName: 'Ananya Deshmukh',
    customerEmail: 'ananya.d@fintechglobal.in',
    customerPhone: '+91 98450 11223',
    organization: 'FinTech Global Systems',
    account: 'FinTech Global Systems',
    subject: 'High latency and timeout on webhook dispatch queue',
    description: 'During peak morning hours, outgoing webhooks experience >5000ms latency resulting in delayed payment status notifications to end-users.',
    category: 'Technical Glitch',
    subCategory: 'API Timeout',
    complaintType: 'Bug',
    productOrService: 'Payment Gateway API',
    source: 'Web Portal',
    priority: 'Urgent',
    severity: 'Critical',
    status: 'In Progress',
    slaHours: 4,
    slaDeadline: new Date(Date.now() + 2 * 60 * 60 * 1000),
    firstResponseDeadline: new Date(Date.now() - 1 * 60 * 60 * 1000),
    firstResponseAt: new Date(Date.now() - 1.5 * 60 * 60 * 1000),
    firstResponseSlaStatus: 'Met',
    slaStatus: 'At Risk',
    assignedTo: '64e8a1000000000000000001',
    assignedToName: 'Sarfaraj Ahmad',
    team: 'Technical Support',
    createdBy: '64e8a1000000000000000001',
    createdByName: 'Sarfaraj Ahmad',
    nextFollowUpDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    nextFollowUpTime: '03:00 PM',
    nextFollowUpPurpose: 'Review load balancer metrics with DevOps engineer',
    investigationNotes: 'Identified Redis buffer overflow under high concurrency. Connection pool exhausted during 9:30 AM spike.',
    rootCause: 'Redis connection pool maxClients set to default (50), while peak connections exceed 200.',
    correctiveAction: 'Increase Redis connection pool size to 500 and enable horizontal worker queue scaling.',
    preventiveAction: 'Add automated Prometheus alert for Redis connection saturation > 70%.',
    resolutionSummary: '',
    resolutionNotes: '',
    resolutionCode: '',
    closureReason: '',
    csatRating: null,
    activities: [
      {
        activityId: 'act_101',
        type: 'Call',
        author: '64e8a1000000000000000001',
        authorName: 'Sarfaraj Ahmad',
        date: new Date().toISOString().slice(0, 10),
        time: '10:15 AM',
        subject: 'Investigation Update Call with Client CTO',
        content: 'Explained Redis buffer saturation issue. Client acknowledged temporary queue drain is active.',
        outcome: 'Client satisfied with current triage progress',
        nextAction: 'Deploy connection pool hotfix before 2 PM',
        timestamp: new Date(),
      },
    ],
    assignmentHistory: [
      {
        fromUser: 'Unassigned',
        fromUserName: 'Unassigned',
        toUser: '64e8a1000000000000000001',
        toUserName: 'Sarfaraj Ahmad',
        assignedBy: '64e8a1000000000000000001',
        assignedByName: 'Sarfaraj Ahmad',
        reason: 'Critical severity ticket assigned to lead architect',
        timestamp: new Date(),
      },
    ],
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    updatedAt: new Date(),
  },
  {
    _id: '64e8a1000000000000000032',
    ticketNumber: 'CMP-0002',
    complaintId: 'CMP-0002',
    customerName: 'Vikram Malhotra',
    customerEmail: 'vikram.m@horizonlogistics.com',
    customerPhone: '+91 98220 99887',
    organization: 'Horizon Logistics Logistics Pvt Ltd',
    account: 'Horizon Logistics Logistics Pvt Ltd',
    subject: 'Incorrect GST tax computation on monthly SaaS invoice',
    description: 'Invoice #INV-2026-09 applied 28% GST instead of standard 18% software SaaS rate for Maharashtra state.',
    category: 'Billing Query',
    subCategory: 'Tax Discrepancy',
    complaintType: 'Billing',
    productOrService: 'TaskFlow Pro Enterprise',
    source: 'Email',
    priority: 'High',
    severity: 'Major',
    status: 'Resolved',
    slaHours: 12,
    slaDeadline: new Date(Date.now() - 4 * 60 * 60 * 1000),
    slaStatus: 'Met',
    assignedTo: '64e8a1000000000000000001',
    assignedToName: 'Sarfaraj Ahmad',
    team: 'Billing & Accounts',
    createdBy: '64e8a1000000000000000001',
    createdByName: 'Sarfaraj Ahmad',
    resolutionSummary: 'Issued revised Credit Note CN-8812 and re-generated invoice with correct 18% IGST.',
    resolutionNotes: 'Billing portal tax master updated for HSN 997331.',
    resolutionCode: 'Configuration Changed',
    closureReason: 'Resolved to Satisfaction',
    csatRating: 5,
    csatFeedback: 'Prompt and accurate correction of tax invoice within 3 hours.',
    resolvedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    activities: [
      {
        activityId: 'act_102',
        type: 'Email',
        author: '64e8a1000000000000000001',
        authorName: 'Sarfaraj Ahmad',
        date: new Date().toISOString().slice(0, 10),
        time: '11:30 AM',
        subject: 'Corrected Invoice & Credit Note Shared',
        content: 'Attached revised invoice #INV-2026-09R and Credit Note. Client confirmed receipt.',
        timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000),
      },
    ],
    createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
  },
  {
    _id: '64e8a1000000000000000033',
    ticketNumber: 'CMP-0003',
    complaintId: 'CMP-0003',
    customerName: 'Pooja Nair',
    customerEmail: 'pooja.n@clouddrive.co',
    customerPhone: '+91 98190 33445',
    organization: 'CloudDrive Technologies',
    account: 'CloudDrive Technologies',
    subject: 'SSO SAML authentication loop on Chrome browser',
    description: 'Users on Chrome version 128+ are redirected back to login page after successful Okta authentication.',
    category: 'Account Access',
    subCategory: 'SSO Failure',
    complaintType: 'Incident',
    productOrService: 'User Workspace & SSO',
    source: 'Chat',
    priority: 'Medium',
    severity: 'Moderate',
    status: 'Logged',
    slaHours: 24,
    slaDeadline: new Date(Date.now() + 18 * 60 * 60 * 1000),
    slaStatus: 'On Track',
    assignedTo: '64e8a1000000000000000001',
    assignedToName: 'Sarfaraj Ahmad',
    team: 'Customer Success',
    createdBy: '64e8a1000000000000000001',
    createdByName: 'Sarfaraj Ahmad',
    nextFollowUpDate: new Date(Date.now() + 12 * 60 * 60 * 1000),
    nextFollowUpTime: '11:00 AM',
    nextFollowUpPurpose: 'Collect SAML tracer logs from user workstation',
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
  },
];

const initialProjects = [
  {
    _id: '64e8a1000000000000000041',
    projectCode: 'PRJ-0001',
    name: 'NextGen Cloud CRM & AI Workflow Suite',
    clientName: 'Acme Enterprise Solutions',
    leadId: 'LD-001',
    description: 'Scalable CRM workflow automation system with interactive dashboards, live notifications, and multi-tenant billing.',
    category: 'Enterprise Software',
    projectType: 'Client Deliverable',
    department: 'Engineering & Operations',
    status: 'In Progress',
    priority: 'High',
    budget: 45000,
    plannedCost: 45000,
    actualCost: 18500,
    budgetedHours: 240,
    actualHours: 98,
    currency: 'USD',
    billingType: 'Fixed Cost',
    billingMethod: 'Milestone Based',
    estimatedCost: 45000,
    startDate: new Date('2026-09-01T00:00:00Z'),
    targetDate: new Date('2026-11-15T00:00:00Z'),
    progress: 50,
    ownerName: 'Sarfaraj Ahmad',
    managerName: 'Sarfaraj Ahmad',
    teamMembers: [
      { name: 'Sarfaraj Ahmad', role: 'Project Manager / Lead Architect' },
      { name: 'Vivek', role: 'Full Stack Engineer' },
      { name: 'Abhay', role: 'QA & Automation Engineer' },
    ],
    phases: [
      { phaseId: 'PH-01', name: 'Scope Alignment & Architecture', order: 1, status: 'Completed', progress: 100 },
      { phaseId: 'PH-02', name: 'Core Engine & REST APIs', order: 2, status: 'In Progress', progress: 65 },
      { phaseId: 'PH-03', name: 'Interactive UI & Mobile Views', order: 3, status: 'In Progress', progress: 40 },
      { phaseId: 'PH-04', name: 'UAT & Client Handover', order: 4, status: 'Upcoming', progress: 0 },
    ],
    milestones: [
      { milestoneId: 'MS-01', title: 'Scope Definition & Architecture Sign-Off', phaseName: 'Scope Alignment & Architecture', isCompleted: true, completedAt: new Date('2026-09-10T00:00:00Z'), status: 'Completed', weight: 1 },
      { milestoneId: 'MS-02', title: 'Database Schema & Auth Services Live', phaseName: 'Core Engine & REST APIs', isCompleted: true, completedAt: new Date('2026-09-22T00:00:00Z'), status: 'Completed', weight: 1 },
      { milestoneId: 'MS-03', title: 'Zoho-Style Project Hub & Timeline Gantt', phaseName: 'Interactive UI & Mobile Views', isCompleted: false, status: 'In Progress', weight: 2 },
      { milestoneId: 'MS-04', title: 'Final Production Deployment & UAT', phaseName: 'UAT & Client Handover', isCompleted: false, status: 'Upcoming', weight: 1 },
    ],
    tasks: [
      {
        taskId: 'TSK-101',
        title: 'Design high-concurrency database models and indexes',
        phaseName: 'Core Engine & REST APIs',
        milestoneTitle: 'Database Schema & Auth Services Live',
        assignedTo: 'Vivek',
        priority: 'High',
        status: 'Completed',
        estimatedHours: 20,
        actualHours: 18,
        progress: 100,
        tags: ['Database', 'Architecture'],
        subtasks: [
          { subtaskId: 'sub_1', title: 'Define Project, Task and Timesheet schema', isCompleted: true, status: 'Completed' },
          { subtaskId: 'sub_2', title: 'Add indexes for search & hierarchy lookups', isCompleted: true, status: 'Completed' },
        ],
      },
      {
        taskId: 'TSK-102',
        title: 'Implement Interactive Gantt Chart and Timeline View',
        phaseName: 'Interactive UI & Mobile Views',
        milestoneTitle: 'Zoho-Style Project Hub & Timeline Gantt',
        assignedTo: 'Sarfaraj Ahmad',
        priority: 'High',
        status: 'In Progress',
        estimatedHours: 32,
        actualHours: 24,
        progress: 75,
        tags: ['Frontend', 'Gantt', 'UI/UX'],
        dependencies: [{ taskId: 'TSK-101', taskTitle: 'Design high-concurrency database models', type: 'Finish-to-Start' }],
        subtasks: [
          { subtaskId: 'sub_3', title: 'Phase bars and milestone diamond markers', isCompleted: true, status: 'Completed' },
          { subtaskId: 'sub_4', title: 'Dependency arrows and zoom level controls', isCompleted: false, status: 'In Progress' },
        ],
      },
      {
        taskId: 'TSK-103',
        title: 'Build Kanban Board with Drag & Drop status syncing',
        phaseName: 'Interactive UI & Mobile Views',
        milestoneTitle: 'Zoho-Style Project Hub & Timeline Gantt',
        assignedTo: 'Abhay',
        priority: 'Medium',
        status: 'In Progress',
        estimatedHours: 24,
        actualHours: 16,
        progress: 60,
        tags: ['Kanban', 'Board'],
        subtasks: [
          { subtaskId: 'sub_5', title: 'Column state transitions & status validation', isCompleted: true, status: 'Completed' },
        ],
      },
      {
        taskId: 'TSK-104',
        title: 'End-to-End Regression & Accessibility Testing',
        phaseName: 'UAT & Client Handover',
        milestoneTitle: 'Final Production Deployment & UAT',
        assignedTo: 'Abhay',
        priority: 'High',
        status: 'To Do',
        estimatedHours: 20,
        actualHours: 0,
        progress: 0,
        tags: ['QA', 'Testing'],
      },
    ],
    issues: [
      {
        issueId: 'ISS-101',
        title: 'Gantt timeline horizontal scrollbar padding glitch on iPad Safari',
        severity: 'Minor',
        priority: 'Low',
        status: 'Resolved',
        reportedBy: 'Abhay',
        assignedTo: 'Sarfaraj Ahmad',
        resolution: 'Added webkit-overflow-scrolling touch style and min-width constraint.',
      },
      {
        issueId: 'ISS-102',
        title: 'Timesheet total hours rounding error on fractional minutes',
        severity: 'Moderate',
        priority: 'Medium',
        status: 'In Progress',
        reportedBy: 'Vivek',
        assignedTo: 'Vivek',
      },
    ],
    risks: [
      {
        riskId: 'RSK-101',
        title: 'Third-party notification webhook gateway rate limiting',
        probability: 'Medium',
        impact: 'High',
        riskLevel: 'High',
        owner: 'Sarfaraj Ahmad',
        mitigationPlan: 'Implement Redis backed token-bucket throttle and exponential backoff retry queue.',
        status: 'Mitigating',
      },
    ],
    timesheets: [
      {
        timesheetId: 'TS-101',
        date: new Date('2026-09-15T00:00:00Z'),
        taskTitle: 'Design high-concurrency database models and indexes',
        userName: 'Vivek',
        totalHours: 8,
        isBillable: true,
        status: 'Approved',
        approvedBy: 'Sarfaraj Ahmad',
        notes: 'Completed Mongoose schema definitions and validation hooks.',
      },
      {
        timesheetId: 'TS-102',
        date: new Date('2026-09-20T00:00:00Z'),
        taskTitle: 'Implement Interactive Gantt Chart and Timeline View',
        userName: 'Sarfaraj Ahmad',
        totalHours: 7.5,
        isBillable: true,
        status: 'Approved',
        approvedBy: 'Sarfaraj Ahmad',
        notes: 'Developed Gantt chart rendering engine with phase groups and drag handles.',
      },
    ],
    documents: [
      { docId: 'doc_1', name: 'Software_Architecture_Design_v1.pdf', url: '#', type: 'application/pdf', size: 1048576, category: 'Specification', version: 'v1.2' },
      { docId: 'doc_2', name: 'Client_Requirements_SRS.docx', url: '#', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 524288, category: 'Contract', version: 'v1.0' },
    ],
    comments: [
      { commentId: 'cmt_1', text: 'Kickoff meeting completed with client stakeholders. Sprint 1 targets approved.', authorName: 'Sarfaraj Ahmad', authorRole: 'Super Admin', createdAt: new Date('2026-09-02T10:00:00Z') },
    ],
    activityHistory: [
      { eventId: 'evt_1', action: 'CREATED', description: 'Project created with Agile Software Product Delivery template', performedByName: 'Sarfaraj Ahmad', timestamp: new Date('2026-09-01T09:00:00Z') },
    ],
    createdAt: new Date('2026-09-01T09:00:00Z'),
    updatedAt: new Date(),
  },
  {
    _id: '64e8a1000000000000000042',
    projectCode: 'PRJ-0002',
    name: 'Apex Healthcare Multi-Hospital Portal',
    clientName: 'Apex Healthcare Hospitals',
    opportunityId: 'OP-001',
    leadId: 'LD-003',
    description: 'Centralized patient scheduling, doctor roster management, and OPD queue tracking across 4 hospital facilities.',
    category: 'Web Application',
    projectType: 'Client Deliverable',
    department: 'Healthcare Solutions',
    status: 'Planning',
    priority: 'Urgent',
    budget: 60000,
    plannedCost: 60000,
    actualCost: 6000,
    budgetedHours: 320,
    actualHours: 24,
    currency: 'USD',
    billingType: 'Fixed Cost',
    billingMethod: 'Milestone Based',
    estimatedCost: 60000,
    startDate: new Date('2026-09-20T00:00:00Z'),
    targetDate: new Date('2026-12-31T00:00:00Z'),
    progress: 25,
    ownerName: 'Sarfaraj Ahmad',
    managerName: 'Sarfaraj Ahmad',
    teamMembers: [
      { name: 'Sarfaraj Ahmad', role: 'Project Director' },
      { name: 'Vivek', role: 'Integration Specialist' },
    ],
    phases: [
      { phaseId: 'PH-01', name: 'HIPAA & Compliance Alignment', order: 1, status: 'In Progress', progress: 60 },
      { phaseId: 'PH-02', name: 'Hospital EHR System Connectors', order: 2, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-03', name: 'Patient Booking & Portal UI', order: 3, status: 'Upcoming', progress: 0 },
    ],
    milestones: [
      { milestoneId: 'MS-01', title: 'HIPAA Compliance & Data Governance Review', isCompleted: true, completedAt: new Date('2026-09-28T00:00:00Z'), status: 'Completed', weight: 1 },
      { milestoneId: 'MS-02', title: 'EHR HL7/FHIR Protocol Integration', isCompleted: false, status: 'In Progress', weight: 2 },
      { milestoneId: 'MS-03', title: 'Multi-Facility Go-Live', isCompleted: false, status: 'Upcoming', weight: 1 },
    ],
    tasks: [
      { taskId: 'TSK-201', title: 'Complete FHIR protocol data mapping specs', phaseName: 'HIPAA & Compliance Alignment', priority: 'Urgent', status: 'In Progress', estimatedHours: 28, actualHours: 18, progress: 65 },
      { taskId: 'TSK-202', title: 'Build doctor consultation calendar grid', phaseName: 'Patient Booking & Portal UI', priority: 'High', status: 'To Do', estimatedHours: 32, actualHours: 0, progress: 0 },
    ],
    issues: [],
    risks: [
      { riskId: 'RSK-201', title: 'Delay in hospital legacy database API access credentials', probability: 'High', impact: 'High', riskLevel: 'High', owner: 'Sarfaraj Ahmad', mitigationPlan: 'Coordinate weekly executive escalation calls with Hospital IT Director.', status: 'Identified' },
    ],
    timesheets: [],
    documents: [],
    comments: [],
    activityHistory: [],
    createdAt: new Date('2026-09-20T00:00:00Z'),
    updatedAt: new Date(),
  },
  {
    _id: '64e8a1000000000000000043',
    projectCode: 'PRJ-0003',
    name: 'FinTech Payment Webhook High-Throughput Engine',
    clientName: 'FinTech Global Systems',
    description: 'Ultra-low latency webhook delivery queue with Redis clustering and zero packet loss guarantee.',
    category: 'Infrastructure & DevOps',
    projectType: 'Client Deliverable',
    department: 'Core Infrastructure',
    status: 'Completed',
    priority: 'Medium',
    budget: 28000,
    plannedCost: 28000,
    actualCost: 24500,
    budgetedHours: 160,
    actualHours: 148,
    currency: 'USD',
    billingType: 'Time & Material',
    billingMethod: 'Hourly Rate',
    estimatedCost: 28000,
    startDate: new Date('2026-08-01T00:00:00Z'),
    targetDate: new Date('2026-09-30T00:00:00Z'),
    actualStartDate: new Date('2026-08-01T00:00:00Z'),
    actualEndDate: new Date('2026-09-29T00:00:00Z'),
    progress: 100,
    ownerName: 'Sarfaraj Ahmad',
    managerName: 'Sarfaraj Ahmad',
    teamMembers: [
      { name: 'Sarfaraj Ahmad', role: 'DevOps Lead' },
    ],
    phases: [
      { phaseId: 'PH-01', name: 'Architecture & Load Modeling', order: 1, status: 'Completed', progress: 100 },
      { phaseId: 'PH-02', name: 'Cluster Deployment & Stress Testing', order: 2, status: 'Completed', progress: 100 },
    ],
    milestones: [
      { milestoneId: 'MS-01', title: '10,000 req/sec benchmark achieved', isCompleted: true, completedAt: new Date('2026-09-15T00:00:00Z'), status: 'Completed', weight: 1 },
      { milestoneId: 'MS-02', title: 'Production Cutover & Client Acceptance', isCompleted: true, completedAt: new Date('2026-09-29T00:00:00Z'), status: 'Completed', weight: 1 },
    ],
    tasks: [
      { taskId: 'TSK-301', title: 'Deploy Redis cluster with sentinel failover', priority: 'High', status: 'Completed', estimatedHours: 40, actualHours: 36, progress: 100 },
    ],
    issues: [],
    risks: [],
    timesheets: [],
    documents: [],
    comments: [],
    activityHistory: [],
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date(),
  },
];

const initialOpportunities = [
  {
    _id: '64e8a1000000000000000021',
    opportunity_id: 'opp_apex_healthcare_001',
    opportunityId: 'OP-001',
    name: 'Apex Healthcare Enterprise Implementation',
    opportunityName: 'Apex Healthcare Enterprise Implementation',
    company: 'Apex Healthcare Hospitals',
    leadId: 'LD-003',
    relatedLead: '64e8a1000000000000000013',
    relatedLeadName: 'Dr. Amit Verma',
    sourceLeadName: 'Dr. Amit Verma',
    amount: 1200000,
    dealValue: 1200000,
    pipeline_value: 1200000,
    stage: 'Proposal',
    opportunity_stage: 'PROPOSAL',
    probability: 60,
    expectedCloseDate: new Date('2026-10-31T00:00:00Z'),
    priority: 'High',
    assignedTo: 'Sarfaraj Ahmad',
    assignedBy: 'Manager (Admin)',
    notes: 'Converted from Source Lead LD-003. Commercial proposal currently under board review.',
    remarks: 'Converted from Source Lead LD-003. Commercial proposal currently under board review.',
    createdAt: new Date('2026-09-25T17:00:00Z'),
    updatedAt: new Date('2026-09-25T17:00:00Z'),
  },
];

const initialNotifications = [];

const initialSubscription = {
  organizationName: 'TaskFlow Enterprise Client',
  activeModules: ['leads', 'complaints', 'tasks', 'projects'],
  userSeats: 12,
  currency: 'INR',
  billingCycle: 'Annual',
  status: 'Active',
  renewalDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
};

const seedDatabase = async (
  isFallback,
  User,
  Task,
  fallbackStore,
  Notification,
  Lead,
  Opportunity,
  Complaint,
  Project,
  SubscriptionModel
) => {
  try {
    const salt = await bcrypt.genSalt(10);
    const defaultHashedPassword = await bcrypt.hash('user123', salt);

    if (isFallback) {
      if (!fallbackStore.users) fallbackStore.users = [];

      for (const u of initialUsers) {
        const existingIdx = fallbackStore.users.findIndex(
          (ex) =>
            (ex.email && ex.email.toLowerCase() === u.email.toLowerCase()) ||
            (ex.username && ex.username.toLowerCase() === u.username.toLowerCase()) ||
            (ex._id && ex._id.toString() === u._id.toString())
        );

        const hashed = defaultHashedPassword;
        const userObj = {
          ...u,
          password: hashed,
          roles: Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role || 'User'],
          status: 'Approved',
        };

        if (existingIdx >= 0) {
          fallbackStore.users[existingIdx] = {
            ...fallbackStore.users[existingIdx],
            ...userObj,
          };
        } else {
          fallbackStore.users.unshift(userObj);
        }
      }

      if (!fallbackStore.tasks) {
        fallbackStore.tasks = initialTasks;
      }

      // Seed initialLeads if empty or refresh demo leads
      if (!fallbackStore.leads || fallbackStore.leads.length === 0) {
        fallbackStore.leads = initialLeads;
      } else {
        // Ensure initial demo leads exist
        for (const initL of initialLeads) {
          const exIdx = fallbackStore.leads.findIndex((l) => l.leadId === initL.leadId || l._id === initL._id);
          if (exIdx === -1) {
            fallbackStore.leads.unshift(initL);
          } else {
            // Keep callLogs and timeline updated if missing
            if (!fallbackStore.leads[exIdx].callLogs || fallbackStore.leads[exIdx].callLogs.length === 0) {
              fallbackStore.leads[exIdx].callLogs = initL.callLogs;
            }
            if (!fallbackStore.leads[exIdx].timeline || fallbackStore.leads[exIdx].timeline.length === 0) {
              fallbackStore.leads[exIdx].timeline = initL.timeline;
            }
            if (!fallbackStore.leads[exIdx].leadId) {
              fallbackStore.leads[exIdx].leadId = initL.leadId;
            }
          }
        }
      }

      if (!fallbackStore.complaints) {
        fallbackStore.complaints = initialComplaints;
      }
      if (!fallbackStore.projects || fallbackStore.projects.length === 0) {
        fallbackStore.projects = initialProjects;
      } else {
        for (const initP of initialProjects) {
          const exIdx = fallbackStore.projects.findIndex((p) => p.projectCode === initP.projectCode || p._id === initP._id);
          if (exIdx === -1) {
            fallbackStore.projects.push(initP);
          }
        }
      }
      if (!fallbackStore.opportunities || fallbackStore.opportunities.length === 0) {
        fallbackStore.opportunities = initialOpportunities;
      } else {
        for (const initOpp of initialOpportunities) {
          const exIdx = fallbackStore.opportunities.findIndex((o) => o.opportunityId === initOpp.opportunityId || o._id === initOpp._id);
          if (exIdx === -1) {
            fallbackStore.opportunities.unshift(initOpp);
          }
        }
      }

      if (!fallbackStore.subscription) {
        fallbackStore.subscription = initialSubscription;
      }

      fallbackStore.saveToFile();
      console.log(
        `[Storage] Seeded persistent store: ${fallbackStore.users.length} users, ${fallbackStore.leads.length} leads.`
      );
    } else {
      // MongoDB Seeding
      if (User) {
        const count = await User.countDocuments();
        if (count === 0) {
          for (const u of initialUsers) {
            await User.create({
              ...u,
              password: 'user123',
              roles: u.roles || [u.role || 'User'],
            });
          }
        }
      }

      if (fallbackStore && typeof fallbackStore.syncWithMongoDB === 'function') {
        await fallbackStore.syncWithMongoDB(
          User,
          Task,
          Notification,
          Lead,
          Opportunity,
          Complaint,
          Project,
          SubscriptionModel
        );
      }
    }
  } catch (err) {
    console.error('[Seed Database Error]', err);
  }
};

module.exports = {
  seedDatabase,
  initialUsers,
  initialTasks,
  initialLeads,
  initialComplaints,
  initialProjects,
  initialSubscription,
  initialOpportunities,
  initialNotifications,
};
