const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const Lead = require('../models/Lead');
const Opportunity = require('../models/Opportunity');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');
const { logAuditAction } = require('../services/auditService');

// Helper to check if Lead module is active
const isLeadModuleActive = () => {
  const activeMods = fallbackStore.subscription?.activeModules || ['leads', 'complaints', 'projects'];
  return activeMods.includes('leads');
};

const requireLeadModule = (req, res, next) => {
  if (!isLeadModuleActive()) {
    return res.status(403).json({
      success: false,
      moduleDisabled: true,
      message: 'Lead Management module is not activated for your organization.',
    });
  }
  next();
};

router.use(requireLeadModule);

const {
  getAllUsers,
  getUserScopeContext,
  isLeadAccessible,
  isOpportunityAccessible,
} = require('../services/hierarchyService');

/**
 * Fetch all leads, opportunities, and users strictly based on hierarchy role scope (Self + Subordinates)
 */
const getScopedData = async (user) => {
  let leads = [];
  let opportunities = [];
  let users = [];

  if (fallbackStore.isFallback) {
    leads = [...(fallbackStore.leads || [])];
    opportunities = [...(fallbackStore.opportunities || [])];
    users = [...(fallbackStore.users || [])];
  } else {
    leads = await Lead.find({}).lean();
    opportunities = await Opportunity.find({}).lean();
    users = await User.find({}).lean();
  }

  const allUsers = users;
  const scope = getUserScopeContext(user, allUsers);

  if (!scope.isSuperAdmin) {
    leads = leads.filter((l) => isLeadAccessible(scope, l));
    opportunities = opportunities.filter((o) => isOpportunityAccessible(scope, o));
    users = users.filter((u) => {
      const uIdStr = u._id ? u._id.toString() : '';
      return scope.allowedUserIds.has(uIdStr);
    });
  }

  return { leads, opportunities, users };
};

// =============================================================================
// REUSABLE DYNAMIC REPORT CALCULATION ENGINES
// =============================================================================

/**
 * MIS-01: Funnel Velocity & Stage Cycle Time
 * Calculates active leads/deals per stage, average days spent in stage, and stage conversion rates
 */
const calculateFunnelVelocity = (leads, opportunities) => {
  const totalLeads = leads.length;
  const totalOpps = opportunities.length;

  // Stage 1: Ingestion / New
  const newLeads = leads.filter((l) => (l.status || '').toLowerCase() === 'new' || (l.lead_status || '') === 'NEW');
  // Stage 2: In Progress / Outreach
  const inProgressLeads = leads.filter(
    (l) =>
      ['contacted', 'in progress', 'in_progress', 'follow-up', 'follow_up', 'interested', 'nurturing'].includes(
        (l.status || '').toLowerCase()
      ) || (l.lead_status || '') === 'IN_PROGRESS'
  );
  // Stage 3: Qualified Opportunity
  const qualifiedLeads = leads.filter(
    (l) => (l.status || '').toLowerCase() === 'qualified' || (l.opportunity_stage || '') === 'QUALIFICATION'
  );
  const qualifiedOpps = opportunities.filter((o) =>
    ['qualification', 'new opportunity', 'contacted', 'requirement understanding', 'needs analysis'].includes(
      (o.stage || '').toLowerCase()
    )
  );
  // Stage 4: Proposal Formulation
  const proposalOpps = opportunities.filter((o) =>
    ['proposal', 'proposal / quotation', 'proposal/quotation'].includes((o.stage || '').toLowerCase())
  );
  // Stage 5: Commercial Negotiation
  const negotiationOpps = opportunities.filter((o) => (o.stage || '').toLowerCase() === 'negotiation');
  // Stage 6: Closed Won Execution
  const wonOpps = opportunities.filter(
    (o) => ['won', 'closed won'].includes((o.stage || '').toLowerCase()) || (o.opportunity_stage || '') === 'WON'
  );
  const lostOpps = opportunities.filter(
    (o) => ['lost', 'closed lost'].includes((o.stage || '').toLowerCase()) || (o.opportunity_stage || '') === 'LOST'
  );

  // Helper to calculate arithmetic average
  const getAverage = (arr) => {
    if (!arr || arr.length === 0) return null;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Number(avg.toFixed(1));
  };

  // --- Dynamic Stage Durations ---
  // Stage 1 Durations (from lead creation to status change or current time)
  const stage1Durations = [];
  leads.forEach((l) => {
    if (l.createdAt) {
      const enterTime = new Date(l.createdAt).getTime();
      let exitTime = null;
      if (Array.isArray(l.timeline)) {
        const transition = l.timeline.find(
          (t) => t.eventType === 'STATUS_CHANGED' || t.eventType === 'CONVERTED_TO_OPPORTUNITY'
        );
        if (transition && transition.timestamp) {
          exitTime = new Date(transition.timestamp).getTime();
        }
      }
      if (!exitTime && l.convertedAt) {
        exitTime = new Date(l.convertedAt).getTime();
      }
      if (!exitTime && l.lastContactDate) {
        exitTime = new Date(l.lastContactDate).getTime();
      }
      if (!exitTime && (l.status || '').toLowerCase() !== 'new') {
        exitTime = new Date(l.updatedAt || Date.now()).getTime();
      }
      if (!exitTime && (l.status || '').toLowerCase() === 'new') {
        exitTime = Date.now();
      }
      if (exitTime && exitTime >= enterTime) {
        stage1Durations.push((exitTime - enterTime) / (1000 * 60 * 60 * 24));
      }
    }
  });

  // Stage 2 Durations (In Progress / Outreach)
  const stage2Durations = [];
  inProgressLeads.forEach((l) => {
    const enterTime = l.stage_entered_at
      ? new Date(l.stage_entered_at).getTime()
      : l.createdAt
      ? new Date(l.createdAt).getTime()
      : null;
    if (enterTime) {
      const exitTime = l.convertedAt
        ? new Date(l.convertedAt).getTime()
        : l.status === 'Converted'
        ? new Date(l.updatedAt).getTime()
        : Date.now();
      if (exitTime >= enterTime) {
        stage2Durations.push((exitTime - enterTime) / (1000 * 60 * 60 * 24));
      }
    }
  });

  // Stage 3 Durations (Qualified Opportunity)
  const stage3Durations = [];
  [...qualifiedLeads, ...qualifiedOpps].forEach((item) => {
    const enterTime = item.stage_entered_at
      ? new Date(item.stage_entered_at).getTime()
      : item.createdAt
      ? new Date(item.createdAt).getTime()
      : null;
    if (enterTime) {
      const exitTime = item.updatedAt ? new Date(item.updatedAt).getTime() : Date.now();
      if (exitTime >= enterTime) {
        stage3Durations.push((exitTime - enterTime) / (1000 * 60 * 60 * 24));
      }
    }
  });

  // Stage 4 Durations (Proposal)
  const stage4Durations = [];
  proposalOpps.forEach((o) => {
    const enterTime = o.stage_entered_at
      ? new Date(o.stage_entered_at).getTime()
      : o.createdAt
      ? new Date(o.createdAt).getTime()
      : null;
    if (enterTime) {
      const exitTime =
        o.wonAt || o.lostAt || (o.stage !== 'Proposal' ? new Date(o.updatedAt).getTime() : Date.now());
      if (exitTime >= enterTime) {
        stage4Durations.push((exitTime - enterTime) / (1000 * 60 * 60 * 24));
      }
    }
  });

  // Stage 5 Durations (Negotiation)
  const stage5Durations = [];
  negotiationOpps.forEach((o) => {
    const enterTime = o.stage_entered_at
      ? new Date(o.stage_entered_at).getTime()
      : o.createdAt
      ? new Date(o.createdAt).getTime()
      : null;
    if (enterTime) {
      const exitTime =
        o.wonAt || o.lostAt || (o.stage !== 'Negotiation' ? new Date(o.updatedAt).getTime() : Date.now());
      if (exitTime >= enterTime) {
        stage5Durations.push((exitTime - enterTime) / (1000 * 60 * 60 * 24));
      }
    }
  });

  // Stage 6 Durations (Won execution)
  const stage6Durations = [];
  wonOpps.forEach((o) => {
    const enterTime = o.wonAt
      ? new Date(o.wonAt).getTime()
      : o.stage_entered_at
      ? new Date(o.stage_entered_at).getTime()
      : null;
    if (enterTime) {
      const exitTime = o.updatedAt ? new Date(o.updatedAt).getTime() : Date.now();
      if (exitTime >= enterTime) {
        stage6Durations.push((exitTime - enterTime) / (1000 * 60 * 60 * 24));
      }
    }
  });

  // --- Dynamic Conversion Rates ---
  const progressedBeyondNew = totalLeads - newLeads.length;
  const stage1ConvRate =
    totalLeads > 0
      ? Math.min(
          100,
          Math.round(
            (Math.max(progressedBeyondNew, inProgressLeads.length + qualifiedLeads.length + totalOpps) / totalLeads) *
              100
          )
        )
      : null;

  const eligibleStage2 = inProgressLeads.length + qualifiedLeads.length + totalOpps;
  const progressedStage2 = qualifiedLeads.length + totalOpps;
  const stage2ConvRate =
    eligibleStage2 > 0 ? Math.min(100, Math.round((progressedStage2 / eligibleStage2) * 100)) : null;

  const eligibleStage3 = qualifiedLeads.length + totalOpps;
  const progressedStage3 = proposalOpps.length + negotiationOpps.length + wonOpps.length;
  const stage3ConvRate =
    eligibleStage3 > 0 ? Math.min(100, Math.round((progressedStage3 / eligibleStage3) * 100)) : null;

  const eligibleStage4 = proposalOpps.length + negotiationOpps.length + wonOpps.length;
  const progressedStage4 = negotiationOpps.length + wonOpps.length;
  const stage4ConvRate =
    eligibleStage4 > 0 ? Math.min(100, Math.round((progressedStage4 / eligibleStage4) * 100)) : null;

  const eligibleStage5 = negotiationOpps.length + wonOpps.length;
  const progressedStage5 = wonOpps.length;
  const stage5ConvRate =
    eligibleStage5 > 0 ? Math.min(100, Math.round((progressedStage5 / eligibleStage5) * 100)) : null;

  const totalClosed = wonOpps.length + lostOpps.length;
  const stage6ConvRate =
    totalClosed > 0
      ? Math.min(100, Math.round((wonOpps.length / totalClosed) * 100))
      : wonOpps.length > 0
      ? 100
      : null;

  const stages = [
    {
      name: 'Ingestion / New',
      avgDays: getAverage(stage1Durations),
      count: newLeads.length,
      conversionRate: stage1ConvRate,
    },
    {
      name: 'In Progress / Outreach',
      avgDays: getAverage(stage2Durations),
      count: inProgressLeads.length,
      conversionRate: stage2ConvRate,
    },
    {
      name: 'Qualified Opportunity',
      avgDays: getAverage(stage3Durations),
      count: qualifiedLeads.length + qualifiedOpps.length,
      conversionRate: stage3ConvRate,
    },
    {
      name: 'Proposal Formulation',
      avgDays: getAverage(stage4Durations),
      count: proposalOpps.length,
      conversionRate: stage4ConvRate,
    },
    {
      name: 'Commercial Negotiation',
      avgDays: getAverage(stage5Durations),
      count: negotiationOpps.length,
      conversionRate: stage5ConvRate,
    },
    {
      name: 'Closed Won Execution',
      avgDays: getAverage(stage6Durations),
      count: wonOpps.length,
      conversionRate: stage6ConvRate,
    },
  ];

  // --- Total Cycle Velocity (Lead Creation to Won) ---
  const completedCycleTimes = [];
  wonOpps.forEach((o) => {
    const end = o.wonAt ? new Date(o.wonAt).getTime() : o.updatedAt ? new Date(o.updatedAt).getTime() : null;
    const matchedLead = leads.find(
      (l) =>
        (l.opportunityId && l.opportunityId === o.opportunityId) ||
        (l.lead_id && l.lead_id === o.leadId) ||
        (l.convertedOpportunityId && l.convertedOpportunityId.toString() === (o._id ? o._id.toString() : ''))
    );
    const start =
      matchedLead && matchedLead.createdAt
        ? new Date(matchedLead.createdAt).getTime()
        : o.createdAt
        ? new Date(o.createdAt).getTime()
        : null;

    if (start && end && end >= start) {
      completedCycleTimes.push((end - start) / (1000 * 60 * 60 * 24));
    }
  });

  const totalCycleDays =
    completedCycleTimes.length > 0
      ? Number((completedCycleTimes.reduce((a, b) => a + b, 0) / completedCycleTimes.length).toFixed(1))
      : null;

  return {
    totalCycleDays,
    stageBreakdown: stages,
  };
};

/**
 * MIS-02: Agent Efficiency & Outreach Matrix
 * Calculates leads managed, calls made, dispositions logged, pipeline values, and conversion ratios per agent
 */
const calculateAgentEfficiency = (leads, opportunities, users) => {
  const agentEfficiency = users.map((u) => {
    const uName = (u.name || '').toLowerCase();
    const uUsername = (u.username || '').toLowerCase();
    const uIdStr = u._id ? u._id.toString() : '';

    const userLeads = leads.filter((l) => {
      const assigned = (l.assignedTo || l.assignedSalesUser || '').toLowerCase();
      const assignedId = l.assignedToId ? l.assignedToId.toString() : l.user ? l.user.toString() : '';
      return assigned === uName || assigned === uUsername || (uIdStr && assignedId === uIdStr);
    });

    const userOpps = opportunities.filter((o) => {
      const assigned = (o.assignedTo || '').toLowerCase();
      const oppUserId = o.user ? o.user.toString() : o.assignedToId ? o.assignedToId.toString() : '';
      return assigned === uName || assigned === uUsername || (uIdStr && oppUserId === uIdStr);
    });

    let calls = 0;
    let dispoCount = 0;
    let openFollowups = 0;

    userLeads.forEach((l) => {
      if (Array.isArray(l.callLogs)) {
        calls += l.callLogs.length;
      }
      if (Array.isArray(l.disposition_history)) {
        dispoCount += l.disposition_history.length;
        if (!l.callLogs || l.callLogs.length === 0) {
          calls += l.disposition_history.filter((d) =>
            ['CALL_BACK', 'NO_ANSWER', 'BUSY', 'QUALIFIED_OPPORTUNITY'].includes(d.disposition_code)
          ).length;
        }
      }
      if (Array.isArray(l.followups)) {
        openFollowups += l.followups.filter((f) => f.status === 'Pending').length;
      } else if (l.next_followup_at && !['converted', 'lost'].includes((l.status || '').toLowerCase())) {
        openFollowups++;
      }
    });

    const wonOpps = userOpps.filter(
      (o) =>
        (o.stage || '').toLowerCase() === 'won' ||
        (o.stage || '').toLowerCase() === 'closed won' ||
        (o.opportunity_stage || '') === 'WON'
    );
    const wonVal = wonOpps.reduce((acc, o) => acc + Number(o.pipeline_value || o.amount || o.dealValue || 0), 0);
    const totalVal = userOpps.reduce((acc, o) => acc + Number(o.pipeline_value || o.amount || o.dealValue || 0), 0);

    const conversionRatio = userLeads.length > 0 ? Math.round((wonOpps.length / userLeads.length) * 100) : 0;

    return {
      agentId: u._id,
      agentName: u.name,
      role: u.role,
      department: u.department || 'Sales',
      leadsManaged: userLeads.length,
      dispositionsLogged: dispoCount,
      callsMade: calls,
      openFollowups,
      totalPipelineValue: totalVal,
      wonConversionValue: wonVal,
      conversionRatio,
    };
  });

  return {
    totalAgentsActive: agentEfficiency.filter(
      (a) => a.leadsManaged > 0 || a.dispositionsLogged > 0 || a.totalPipelineValue > 0 || a.callsMade > 0
    ).length,
    agents: agentEfficiency,
  };
};

/**
 * MIS-03: Disposition Distribution Across Inbound Sources
 * Calculates volume and % breakdown of call outcomes across genuine marketing sources
 */
const calculateDispositionDistribution = (leads) => {
  const dispositionTotals = {
    NO_ANSWER: 0,
    BUSY: 0,
    CALL_BACK: 0,
    NOT_INTERESTED: 0,
    QUALIFIED_OPPORTUNITY: 0,
    NONE: 0,
  };

  const sourceMap = {};

  leads.forEach((l) => {
    const dCode = l.disposition_code || 'NONE';
    if (dispositionTotals[dCode] !== undefined) {
      dispositionTotals[dCode]++;
    } else {
      dispositionTotals.NONE++;
    }

    const src = (l.campaign_source || l.source || 'Website Direct').trim();
    if (!sourceMap[src]) {
      sourceMap[src] = {
        source: src,
        total: 0,
        NO_ANSWER: 0,
        BUSY: 0,
        CALL_BACK: 0,
        NOT_INTERESTED: 0,
        QUALIFIED_OPPORTUNITY: 0,
        NONE: 0,
      };
    }
    sourceMap[src].total++;
    if (sourceMap[src][dCode] !== undefined) {
      sourceMap[src][dCode]++;
    } else {
      sourceMap[src].NONE++;
    }
  });

  const totalLogged = Object.values(dispositionTotals).reduce((a, b) => a + b, 0);

  return {
    totalLogged,
    dispositionTotals,
    sourceBreakdown: Object.values(sourceMap),
  };
};

/**
 * MIS-04: Pipeline Aging & Stagnant Risk Analysis
 * Calculates opportunities inactive > 14 days and total pipeline value at risk
 */
const calculatePipelineAging = (opportunities) => {
  const activeOpps = opportunities.filter((o) => {
    const st = (o.stage || '').toLowerCase();
    return st !== 'won' && st !== 'closed won' && st !== 'lost' && st !== 'closed lost';
  });

  const atRiskOpps = [];
  let totalAtRiskValue = 0;

  activeOpps.forEach((o) => {
    let days = 0;
    if (o.stage_entered_at) {
      const diff = Date.now() - new Date(o.stage_entered_at).getTime();
      days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    } else if (o.days_in_stage !== undefined && o.days_in_stage !== null) {
      days = Number(o.days_in_stage);
    } else if (o.updatedAt) {
      const diff = Date.now() - new Date(o.updatedAt).getTime();
      days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    } else if (o.createdAt) {
      const diff = Date.now() - new Date(o.createdAt).getTime();
      days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    }

    const val = Number(o.pipeline_value || o.amount || o.dealValue || 0);

    if (days > 14 || o.is_at_risk) {
      totalAtRiskValue += val;
      atRiskOpps.push({
        id: o._id,
        name: o.name || o.opportunityName || 'Unnamed Deal',
        company: o.company || '',
        stage: o.stage || 'Qualification',
        pipeline_value: val,
        daysInStage: days,
        assignedTo: o.assignedTo || 'Unassigned',
        riskTier: days > 30 ? 'CRITICAL' : 'HIGH',
      });
    }
  });

  return {
    activeOpportunitiesCount: activeOpps.length,
    atRiskOpportunitiesCount: atRiskOpps.length,
    totalPipelineAtRiskValue: totalAtRiskValue,
    atRiskList: atRiskOpps.sort((a, b) => b.daysInStage - a.daysInStage),
  };
};

/**
 * MIS-05: Lead Attribution & Multi-Channel Marketing ROI
 * Calculates real CPL, acquisition cost, won deals, revenue, net profit, and ROI % with consistent currency (INR)
 */
const calculateAttributionROI = (leads, opportunities) => {
  const channelMap = {};
  const standardChannels = [
    'Website Direct',
    'Google Ads',
    'LinkedIn Ads',
    'Partner Referral',
    'Inbound Calls',
    'Cold Outreach',
  ];

  standardChannels.forEach((c) => {
    channelMap[c] = {
      channel: c,
      leadsAcquired: 0,
      totalAcquisitionCost: 0,
      hasCostData: false,
      dealsWonCount: 0,
      revenueGenerated: 0,
    };
  });

  leads.forEach((l) => {
    const src = (l.campaign_source || l.source || 'Website Direct').trim();
    let matchedChannel =
      standardChannels.find((c) => c.toLowerCase() === src.toLowerCase()) ||
      standardChannels.find(
        (c) => c.toLowerCase().includes(src.toLowerCase()) || src.toLowerCase().includes(c.toLowerCase())
      );

    if (!matchedChannel) {
      matchedChannel = src;
      if (!channelMap[matchedChannel]) {
        channelMap[matchedChannel] = {
          channel: matchedChannel,
          leadsAcquired: 0,
          totalAcquisitionCost: 0,
          hasCostData: false,
          dealsWonCount: 0,
          revenueGenerated: 0,
        };
      }
    }

    channelMap[matchedChannel].leadsAcquired++;
    if (l.cost_per_lead !== undefined && l.cost_per_lead !== null && Number(l.cost_per_lead) > 0) {
      channelMap[matchedChannel].totalAcquisitionCost += Number(l.cost_per_lead);
      channelMap[matchedChannel].hasCostData = true;
    }
  });

  opportunities.forEach((o) => {
    const st = (o.stage || '').toLowerCase();
    const isWon = st === 'won' || st === 'closed won' || (o.opportunity_stage || '') === 'WON';
    if (isWon) {
      const src = (o.campaign_source || o.leadSource || 'Website Direct').trim();
      let matchedChannel =
        standardChannels.find((c) => c.toLowerCase() === src.toLowerCase()) ||
        standardChannels.find(
          (c) => c.toLowerCase().includes(src.toLowerCase()) || src.toLowerCase().includes(c.toLowerCase())
        );

      if (!matchedChannel) {
        matchedChannel = src;
        if (!channelMap[matchedChannel]) {
          channelMap[matchedChannel] = {
            channel: matchedChannel,
            leadsAcquired: 0,
            totalAcquisitionCost: 0,
            hasCostData: false,
            dealsWonCount: 0,
            revenueGenerated: 0,
          };
        }
      }

      const rev = Number(o.pipeline_value || o.amount || o.dealValue || 0);
      channelMap[matchedChannel].dealsWonCount++;
      channelMap[matchedChannel].revenueGenerated += rev;
    }
  });

  const channels = Object.values(channelMap).map((ch) => {
    const avgCPL =
      ch.hasCostData && ch.leadsAcquired > 0 ? Number((ch.totalAcquisitionCost / ch.leadsAcquired).toFixed(2)) : null;
    const netProfit =
      ch.hasCostData || ch.totalAcquisitionCost > 0
        ? ch.revenueGenerated - ch.totalAcquisitionCost
        : ch.revenueGenerated;
    const roiPercentage =
      ch.totalAcquisitionCost > 0
        ? Math.round(((ch.revenueGenerated - ch.totalAcquisitionCost) / ch.totalAcquisitionCost) * 100)
        : null;

    return {
      channel: ch.channel,
      leadsAcquired: ch.leadsAcquired,
      avgCPL,
      totalAcquisitionCost: ch.totalAcquisitionCost,
      dealsWonCount: ch.dealsWonCount,
      revenueGenerated: ch.revenueGenerated,
      netProfit,
      roiPercentage,
    };
  });

  return {
    channels,
  };
};

/**
 * Consolidated Executive Analytics & 4 Major Graphical Widgets Data
 */
const calculateExecutiveAnalytics = (leads, opportunities, users) => {
  const totalLeads = leads.length;
  const totalOpps = opportunities.length;

  // 1. Executive Funnel Stages Graphic
  const newLeadsCount = leads.filter(
    (l) => (l.status || '').toLowerCase() === 'new' || (l.lead_status || '') === 'NEW'
  ).length;
  const inProgressCount = leads.filter(
    (l) =>
      ['contacted', 'in progress', 'in_progress', 'follow-up', 'follow_up', 'interested', 'nurturing'].includes(
        (l.status || '').toLowerCase()
      ) || (l.lead_status || '') === 'IN_PROGRESS'
  ).length;
  const qualifiedCount = leads.filter(
    (l) => (l.status || '').toLowerCase() === 'qualified' || (l.opportunity_stage || '') === 'QUALIFICATION'
  ).length;
  const proposalCount = opportunities.filter((o) =>
    ['proposal', 'proposal / quotation', 'proposal/quotation'].includes((o.stage || '').toLowerCase())
  ).length;
  const negotiationCount = opportunities.filter((o) => (o.stage || '').toLowerCase() === 'negotiation').length;
  const wonCount = opportunities.filter(
    (o) => ['won', 'closed won'].includes((o.stage || '').toLowerCase()) || (o.opportunity_stage || '') === 'WON'
  ).length;
  const lostCount =
    leads.filter((l) => (l.status || '').toLowerCase() === 'lost' || (l.lead_status || '') === 'LOST').length +
    opportunities.filter((o) => ['lost', 'closed lost'].includes((o.stage || '').toLowerCase()) || (o.opportunity_stage || '') === 'LOST').length;

  const stage1Count = totalLeads;
  const stage2Count = qualifiedCount + inProgressCount + totalOpps;
  const stage3Count = proposalCount + negotiationCount + wonCount;
  const stage4Count = negotiationCount + wonCount;
  const stage5Count = wonCount;

  const dropOff1 = stage1Count > 0 ? Math.max(0, Math.round(((stage1Count - stage2Count) / stage1Count) * 100)) : 0;
  const dropOff2 = stage2Count > 0 ? Math.max(0, Math.round(((stage2Count - stage3Count) / stage2Count) * 100)) : 0;
  const dropOff3 = stage3Count > 0 ? Math.max(0, Math.round(((stage3Count - stage4Count) / stage3Count) * 100)) : 0;
  const dropOff4 = stage4Count > 0 ? Math.max(0, Math.round(((stage4Count - stage5Count) / stage4Count) * 100)) : 0;

  const funnelStages = [
    {
      id: 'ingestion',
      label: 'Lead Ingestion',
      count: stage1Count,
      conversionRate: 100,
      color: '#3b82f6',
      dropOff: dropOff1,
    },
    {
      id: 'qualification',
      label: 'Qualification',
      count: stage2Count,
      conversionRate: totalLeads > 0 ? Math.round((stage2Count / totalLeads) * 100) : 0,
      color: '#06b6d4',
      dropOff: dropOff2,
    },
    {
      id: 'proposal',
      label: 'Proposal Sent',
      count: stage3Count,
      conversionRate: totalLeads > 0 ? Math.round((stage3Count / totalLeads) * 100) : 0,
      color: '#8b5cf6',
      dropOff: dropOff3,
    },
    {
      id: 'negotiation',
      label: 'Negotiation',
      count: stage4Count,
      conversionRate: totalLeads > 0 ? Math.round((stage4Count / totalLeads) * 100) : 0,
      color: '#f59e0b',
      dropOff: dropOff4,
    },
    {
      id: 'won',
      label: 'Closed Won',
      count: stage5Count,
      conversionRate: totalLeads > 0 ? Math.round((stage5Count / totalLeads) * 100) : 0,
      color: '#10b981',
      dropOff: 0,
    },
  ];

  // 2. Real-Time Activity Leaderboard
  const agentEfficiency = calculateAgentEfficiency(leads, opportunities, users);
  const leaderboard = agentEfficiency.agents
    .filter((a) => a.leadsManaged > 0 || a.dispositionsLogged > 0 || a.wonConversionValue > 0 || a.callsMade > 0)
    .map((a) => ({
      name: a.agentName,
      role: a.role,
      avatar: '',
      callsMade: a.callsMade,
      dispositionsLogged: a.dispositionsLogged,
      openFollowups: a.openFollowups,
      wonValue: a.wonConversionValue,
      leadsAssigned: a.leadsManaged,
    }))
    .sort((a, b) => b.wonValue - a.wonValue || b.dispositionsLogged - a.dispositionsLogged);

  // 3. Stage-wise Aging Heatmap
  const agingMatrix = {
    Qualification: { under7: 0, days7to14: 0, days14to30: 0, over30: 0, totalVal: 0 },
    Proposal: { under7: 0, days7to14: 0, days14to30: 0, over30: 0, totalVal: 0 },
    Negotiation: { under7: 0, days7to14: 0, days14to30: 0, over30: 0, totalVal: 0 },
    Won: { under7: 0, days7to14: 0, days14to30: 0, over30: 0, totalVal: 0 },
    Lost: { under7: 0, days7to14: 0, days14to30: 0, over30: 0, totalVal: 0 },
  };

  opportunities.forEach((opp) => {
    let stageKey = 'Qualification';
    const st = (opp.stage || '').toLowerCase();
    if (['proposal', 'proposal / quotation', 'proposal/quotation'].includes(st)) stageKey = 'Proposal';
    else if (st === 'negotiation') stageKey = 'Negotiation';
    else if (st === 'won' || st === 'closed won') stageKey = 'Won';
    else if (st === 'lost' || st === 'closed lost') stageKey = 'Lost';

    const val = Number(opp.pipeline_value || opp.amount || opp.dealValue || 0);
    agingMatrix[stageKey].totalVal += val;

    let days = 0;
    if (opp.stage_entered_at) {
      days = Math.max(0, Math.floor((Date.now() - new Date(opp.stage_entered_at).getTime()) / (1000 * 60 * 60 * 24)));
    } else if (opp.days_in_stage !== undefined && opp.days_in_stage !== null) {
      days = Number(opp.days_in_stage);
    } else if (opp.updatedAt) {
      days = Math.max(0, Math.floor((Date.now() - new Date(opp.updatedAt).getTime()) / (1000 * 60 * 60 * 24)));
    }

    if (days < 7) agingMatrix[stageKey].under7++;
    else if (days <= 14) agingMatrix[stageKey].days7to14++;
    else if (days <= 30) agingMatrix[stageKey].days14to30++;
    else agingMatrix[stageKey].over30++;
  });

  // 4. Dynamic Volume Trends
  const channels = [
    'Website Direct',
    'Google Ads',
    'LinkedIn Ads',
    'Partner Referral',
    'Inbound Calls',
    'Cold Outreach',
  ];
  const trendMap = {};

  leads.forEach((l) => {
    const d = new Date(l.createdAt || Date.now());
    const monthYear = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    if (!trendMap[monthYear]) {
      trendMap[monthYear] = { period: monthYear, total: 0 };
      channels.forEach((c) => (trendMap[monthYear][c] = 0));
    }
    const ch = (l.campaign_source || l.source || 'Website Direct').trim();
    const matchedChannel = channels.find((c) => c.toLowerCase().includes(ch.toLowerCase())) || 'Website Direct';
    trendMap[monthYear][matchedChannel] = (trendMap[monthYear][matchedChannel] || 0) + 1;
    trendMap[monthYear].total++;
  });

  const volumeTrends = Object.values(trendMap);

  // Financial Summaries
  const totalPipelineValue = opportunities.reduce(
    (acc, o) => acc + Number(o.pipeline_value || o.amount || o.dealValue || 0),
    0
  );
  const totalWonRevenue = opportunities
    .filter((o) => ['won', 'closed won'].includes((o.stage || '').toLowerCase()) || (o.opportunity_stage || '') === 'WON')
    .reduce((acc, o) => acc + Number(o.pipeline_value || o.amount || o.dealValue || 0), 0);

  const totalCost = leads.reduce((acc, l) => acc + (l.cost_per_lead ? Number(l.cost_per_lead) : 0), 0);
  const netROI = totalCost > 0 ? Math.round(((totalWonRevenue - totalCost) / totalCost) * 100) : 0;
  const closedCount = wonCount + lostCount;
  const winRate =
    closedCount > 0
      ? Math.round((wonCount / closedCount) * 100)
      : totalOpps > 0
      ? Math.round((wonCount / totalOpps) * 100)
      : 0;

  return {
    summary: {
      totalLeads,
      totalOpportunities: totalOpps,
      totalPipelineValue,
      totalWonRevenue,
      totalCost,
      netROI,
      winRate,
      activeSlaBreaches: leads.filter((l) => (l.sla_tier || 0) > 0).length,
    },
    widgets: {
      funnelGraphic: funnelStages,
      activityLeaderboard: leaderboard,
      stageAgingHeatmap: agingMatrix,
      dynamicVolumeTrends: volumeTrends,
    },
  };
};

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

// @route   GET /api/mis/analytics
// @desc    Consolidated Executive Analytics & 4 Major Graphical Widgets Data
// @access  Private
router.get('/analytics', protect, async (req, res) => {
  try {
    const { leads, opportunities, users } = await getScopedData(req.user);
    const analytics = calculateExecutiveAnalytics(leads, opportunities, users);

    res.json({
      success: true,
      ...analytics,
    });
  } catch (error) {
    console.error('MIS Analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate MIS analytics', error: error.message });
  }
});

// @route   GET /api/mis/reports/funnel-velocity (MIS-01)
// @desc    Funnel Velocity: Conversion rate % per stage, Avg days spent in each stage
// @access  Private
router.get('/reports/funnel-velocity', protect, async (req, res) => {
  try {
    const { leads, opportunities } = await getScopedData(req.user);
    const metrics = calculateFunnelVelocity(leads, opportunities);

    res.json({
      success: true,
      reportId: 'MIS-01',
      title: 'MIS-01: Funnel Velocity & Stage Cycle Time',
      targetStakeholders: 'VP of Sales, CRO',
      frequency: 'Weekly Automated Trigger',
      metrics,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   GET /api/mis/reports/agent-efficiency (MIS-02)
// @desc    Agent Efficiency: Calls made, dispositions logged, conversion value per agent
// @access  Private
router.get('/reports/agent-efficiency', protect, async (req, res) => {
  try {
    const { leads, opportunities, users } = await getScopedData(req.user);
    const metrics = calculateAgentEfficiency(leads, opportunities, users);

    res.json({
      success: true,
      reportId: 'MIS-02',
      title: 'MIS-02: Agent Efficiency & Outreach Matrix',
      targetStakeholders: 'Sales Managers, Supervisors',
      frequency: 'Daily End of Day (EOD)',
      metrics,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   GET /api/mis/reports/disposition-distribution (MIS-03)
// @desc    Disposition Distribution: Volume & % breakdown of dispo outcomes across sources
// @access  Private
router.get('/reports/disposition-distribution', protect, async (req, res) => {
  try {
    const { leads } = await getScopedData(req.user);
    const metrics = calculateDispositionDistribution(leads);

    res.json({
      success: true,
      reportId: 'MIS-03',
      title: 'MIS-03: Disposition Distribution Across Inbound Sources',
      targetStakeholders: 'Marketing Analysts, Operations',
      frequency: 'Weekly / Monthly Summary',
      metrics,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   GET /api/mis/reports/pipeline-aging (MIS-04)
// @desc    Pipeline Aging & Risk: Opportunities with zero activity > 14 days, pipeline at risk value
// @access  Private
router.get('/reports/pipeline-aging', protect, async (req, res) => {
  try {
    const { opportunities } = await getScopedData(req.user);
    const metrics = calculatePipelineAging(opportunities);

    res.json({
      success: true,
      reportId: 'MIS-04',
      title: 'MIS-04: Pipeline Aging & Stagnant Risk Analysis',
      targetStakeholders: 'Sales Leaders, Risk Desk',
      frequency: 'Real-time Daily Alert',
      metrics,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   GET /api/mis/reports/attribution-roi (MIS-05)
// @desc    Lead Attribution ROI: Cost per Lead (CPL) versus closed-won revenue generated per channel
// @access  Private
router.get('/reports/attribution-roi', protect, async (req, res) => {
  try {
    const { leads, opportunities } = await getScopedData(req.user);
    const metrics = calculateAttributionROI(leads, opportunities);

    res.json({
      success: true,
      reportId: 'MIS-05',
      title: 'MIS-05: Lead Attribution & Multi-Channel Marketing ROI',
      targetStakeholders: 'CMO, CFO, Executive Board',
      frequency: 'Monthly Fiscal Review',
      metrics,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   GET /api/mis/export/:reportId
// @desc    Export MIS Report as Excel (.xlsx) or CSV with immutable Audit Trail
// @access  Private
router.get('/export/:reportId', protect, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { format = 'xlsx' } = req.query;

    const { leads, opportunities, users } = await getScopedData(req.user);

    let filename = `${reportId}_${new Date().toISOString().slice(0, 10)}`;
    let rows = [];
    let sheetName = 'MIS Report';

    if (reportId === 'MIS-01' || reportId === 'funnel-velocity') {
      filename += '_Funnel_Cycle_Time';
      sheetName = 'Funnel Velocity';
      const metrics = calculateFunnelVelocity(leads, opportunities);
      rows = metrics.stageBreakdown.map((s) => ({
        'Stage': s.name,
        'Active Leads / Deals': s.count,
        'Avg Days in Stage': s.avgDays !== null && s.avgDays !== undefined ? `${s.avgDays} Days` : 'N/A',
        'Stage Conversion Rate': s.conversionRate !== null && s.conversionRate !== undefined ? `${s.conversionRate}%` : 'N/A',
      }));
    } else if (reportId === 'MIS-02' || reportId === 'agent-efficiency') {
      filename += '_Agent_Performance';
      sheetName = 'Agent Efficiency';
      const metrics = calculateAgentEfficiency(leads, opportunities, users);
      rows = metrics.agents
        .filter((a) => a.leadsManaged > 0 || a.dispositionsLogged > 0 || a.wonConversionValue > 0 || a.callsMade > 0)
        .map((a) => ({
          'Agent / Representative': a.agentName,
          'Role': a.role,
          'Leads Assigned': a.leadsManaged,
          'Calls Made': a.callsMade,
          'Dispositions Logged': a.dispositionsLogged,
          'Won Value (INR)': a.wonConversionValue,
          'Conversion Ratio': `${a.conversionRatio}%`,
        }));
      if (rows.length === 0) {
        rows = metrics.agents.map((a) => ({
          'Agent / Representative': a.agentName,
          'Role': a.role,
          'Leads Assigned': 0,
          'Calls Made': 0,
          'Dispositions Logged': 0,
          'Won Value (INR)': 0,
          'Conversion Ratio': '0%',
        }));
      }
    } else if (reportId === 'MIS-03' || reportId === 'disposition-distribution') {
      filename += '_Call_Outcomes_Dispositions';
      sheetName = 'Call Dispositions';
      const metrics = calculateDispositionDistribution(leads);
      rows = metrics.sourceBreakdown.map((src) => ({
        'Inbound Source': src.source,
        'Total Leads': src.total,
        'No Answer': src.NO_ANSWER,
        'Busy': src.BUSY,
        'Callback': src.CALL_BACK,
        'Not Interested': src.NOT_INTERESTED,
        'Qualified': src.QUALIFIED_OPPORTUNITY,
      }));
      if (rows.length === 0) {
        rows = [
          {
            'Inbound Source': 'No leads logged',
            'Total Leads': 0,
            'No Answer': 0,
            'Busy': 0,
            'Callback': 0,
            'Not Interested': 0,
            'Qualified': 0,
          },
        ];
      }
    } else if (reportId === 'MIS-04' || reportId === 'pipeline-aging') {
      filename += '_Pipeline_Aging_Risk';
      sheetName = 'Pipeline Risk';
      const metrics = calculatePipelineAging(opportunities);
      rows = metrics.atRiskList.map((opp) => ({
        'Opportunity': opp.name,
        'Company': opp.company || '',
        'Stage': opp.stage,
        'Pipeline Value (INR)': opp.pipeline_value,
        'Days Inactive': `${opp.daysInStage} Days`,
        'Owner': opp.assignedTo,
        'Risk Level': opp.riskTier,
      }));
      if (rows.length === 0) {
        rows = [{ 'Status': 'No opportunities currently stagnated beyond 14 days threshold' }];
      }
    } else if (reportId === 'MIS-05' || reportId === 'attribution-roi') {
      filename += '_Lead_Source_ROI';
      sheetName = 'Channel ROI';
      const metrics = calculateAttributionROI(leads, opportunities);
      rows = metrics.channels.map((ch) => ({
        'Marketing Channel': ch.channel,
        'Leads': ch.leadsAcquired,
        'Avg CPL (INR)': ch.avgCPL !== null && ch.avgCPL !== undefined ? ch.avgCPL : 'N/A',
        'Acquisition Cost (INR)': ch.totalAcquisitionCost,
        'Won Revenue (INR)': ch.revenueGenerated,
        'Net Profit (INR)': ch.netProfit,
        'Channel ROI': ch.roiPercentage !== null && ch.roiPercentage !== undefined ? `${ch.roiPercentage}%` : 'N/A',
      }));
    } else {
      filename += '_Lead_Registry';
      sheetName = 'Leads';
      rows = leads.map((l) => ({
        'Lead ID': l.lead_id || l._id,
        'Name': l.name,
        'Company': l.company || '',
        'Email': l.email || '',
        'Phone': l.phone || '',
        'Status': l.status || l.lead_status || 'New',
        'Disposition': l.disposition_code || 'NONE',
        'Pipeline Value (INR)': l.pipeline_value || l.dealValue || 0,
        'Assigned To': l.assignedTo || '',
        'Created Date': new Date(l.createdAt).toISOString().slice(0, 10),
      }));
    }

    await logAuditAction({
      entity_type: 'Export',
      entity_id: reportId,
      action: 'EXPORT_DOWNLOAD',
      operator: req.user,
      delta: `Downloaded ${filename} (${format.toUpperCase()})`,
      req,
    });

    if (format === 'csv') {
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.status(200).send('\uFEFF' + csv);
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    return res.status(200).send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Export failed', error: err.message });
  }
});

module.exports = router;
