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

const initialComplaints = [];
const initialProjects = [];

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
      if (!fallbackStore.projects) {
        fallbackStore.projects = initialProjects;
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
