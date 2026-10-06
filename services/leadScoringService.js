/**
 * Lead Scoring, Duplicate Detection, and Follow-Up Intelligence Service
 * Provides consistent scoring (0-100), temperature ('Hot' | 'Warm' | 'Cold'),
 * duplicate detection, and follow-up status calculations.
 */

// Helper to normalize email
const normalizeEmail = (email) => (email ? email.toString().trim().toLowerCase() : '');

// Helper to normalize phone numbers (digits only)
const normalizePhone = (phone) => (phone ? phone.toString().replace(/\D/g, '') : '');

// Helper to normalize text (lowercase, trimmed, collapse spaces)
const normalizeText = (text) => (text ? text.toString().trim().toLowerCase().replace(/\s+/g, ' ') : '');

/**
 * Calculates Lead Score (0 - 100) and Temperature ('Hot' | 'Warm' | 'Cold')
 * @param {Object} lead - Lead document or plain object
 * @returns {{ score: number, temperature: 'Hot' | 'Warm' | 'Cold', breakdown: Object }}
 */
const calculateLeadScore = (lead) => {
  if (!lead) {
    return {
      score: 50,
      temperature: 'Warm',
      breakdown: {
        statusScore: 10,
        priorityScore: 10,
        valueScore: 0,
        engagementScore: 0,
        followUpScore: 0,
        completenessScore: 30,
      },
    };
  }

  let statusScore = 0;
  let priorityScore = 0;
  let valueScore = 0;
  let engagementScore = 0;
  let followUpScore = 0;
  let completenessScore = 0;

  // 1. Status / Qualification Stage (Max: 30 pts)
  const status = (lead.status || '').trim();
  const leadStatusUpper = (lead.lead_status || '').toUpperCase();
  const isConverted = status === 'Converted' || !!lead.opportunityId || !!lead.convertedOpportunityId;

  if (isConverted) {
    statusScore = 30;
  } else if (status === 'Qualified') {
    statusScore = 26;
  } else if (status === 'Interested') {
    statusScore = 22;
  } else if (status === 'Follow-Up' || status === 'Follow_Up') {
    statusScore = 18;
  } else if (['Contacted', 'In Progress'].includes(status) || leadStatusUpper === 'IN_PROGRESS') {
    statusScore = 15;
  } else if (status === 'New' || leadStatusUpper === 'NEW') {
    statusScore = 10;
  } else if (['Not Interested', 'Lost', 'Invalid', 'LOST'].includes(status)) {
    statusScore = 0;
  } else {
    statusScore = 10;
  }

  // 2. Priority Urgency (Max: 20 pts)
  const priority = (lead.priority || 'Medium').trim();
  if (priority === 'Urgent') {
    priorityScore = 20;
  } else if (priority === 'High') {
    priorityScore = 15;
  } else if (priority === 'Medium') {
    priorityScore = 10;
  } else if (priority === 'Low') {
    priorityScore = 5;
  } else {
    priorityScore = 10;
  }

  // 3. Deal Value / Pipeline Size (Max: 20 pts)
  const val = Number(lead.estimatedValue || lead.dealValue || lead.pipeline_value || 0);
  if (val >= 500000) {
    valueScore = 20;
  } else if (val >= 200000) {
    valueScore = 15;
  } else if (val >= 50000) {
    valueScore = 10;
  } else if (val > 0) {
    valueScore = 5;
  } else {
    valueScore = 0;
  }

  // 4. Engagement & Call History (Max: 15 pts)
  const callLogs = Array.isArray(lead.callLogs) ? lead.callLogs : [];
  if (callLogs.length > 0) {
    engagementScore += 5; // Base points for communication activity
    const connectedCount = callLogs.filter(
      (c) =>
        c.callStatus === 'Connected Successfully' ||
        ['Interested', 'Meeting Requested', 'Proposal Requested', 'Qualified'].includes(c.callOutcome)
    ).length;
    engagementScore += Math.min(10, connectedCount * 3);
  }

  // 5. Follow-up Activity & Timeliness (Max: 10 pts)
  const followups = Array.isArray(lead.followups) ? lead.followups : [];
  const completedFollowups = followups.filter((f) => f.status === 'Completed').length;
  if (completedFollowups > 0) {
    followUpScore += Math.min(6, completedFollowups * 2);
  }

  const nextDate = lead.nextFollowUpDate || lead.next_followup_at;
  if (nextDate) {
    const d = new Date(nextDate);
    if (!isNaN(d.getTime())) {
      const now = new Date();
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      if (d.getTime() >= endOfToday.getTime() - 24 * 60 * 60 * 1000) {
        // Scheduled for today or future
        followUpScore += 4;
      } else {
        // Overdue follow-up penalty
        followUpScore -= 5;
      }
    }
  }

  // 6. Data Completeness & Source Quality (Max: 5 pts)
  if (lead.email && lead.email.includes('@')) completenessScore += 2;
  if (lead.phone || lead.mobileNumber) completenessScore += 2;
  if (lead.company && lead.company.trim().length > 1) completenessScore += 1;

  const source = (lead.source || lead.campaign_source || '').toLowerCase();
  if (['referral', 'inbound', 'partner', 'direct'].some((s) => source.includes(s))) {
    completenessScore += 2;
  }

  // Sum total score and constrain to [0, 100]
  let totalScore = statusScore + priorityScore + valueScore + engagementScore + followUpScore + completenessScore;
  totalScore = Math.max(0, Math.min(100, Math.round(totalScore)));

  // Determine Temperature:
  // Hot: >= 70
  // Warm: >= 40 and < 70
  // Cold: < 40
  let temperature = 'Warm';
  if (totalScore >= 70) {
    temperature = 'Hot';
  } else if (totalScore < 40) {
    temperature = 'Cold';
  }

  return {
    score: totalScore,
    temperature,
    breakdown: {
      statusScore,
      priorityScore,
      valueScore,
      engagementScore,
      followUpScore,
      completenessScore,
    },
  };
};

/**
 * Calculates Follow-Up Status for a given date or follow-up object
 * @param {Date|string} followUpDate
 * @param {string} [status] - 'Pending' | 'Completed' | etc.
 * @returns {'Completed' | 'Overdue' | 'Due Today' | 'Upcoming' | 'None'}
 */
const getFollowUpStatus = (followUpDate, status = 'Pending') => {
  if (status === 'Completed') return 'Completed';
  if (!followUpDate) return 'None';

  const d = new Date(followUpDate);
  if (isNaN(d.getTime())) return 'None';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(d);
  target.setHours(0, 0, 0, 0);

  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return 'Overdue';
  } else if (diffDays === 0) {
    return 'Due Today';
  } else {
    return 'Upcoming';
  }
};

/**
 * Computes complete follow-up summary for a lead
 * @param {Object} lead
 * @returns {{ status: 'Completed' | 'Overdue' | 'Due Today' | 'Upcoming' | 'None', date: Date|null, time: string, overdueDays: number }}
 */
const getLeadFollowUpSummary = (lead) => {
  if (!lead) {
    return { status: 'None', date: null, time: '', overdueDays: 0 };
  }

  const nextDate = lead.nextFollowUpDate || lead.next_followup_at;
  const nextTime = lead.nextFollowUpTime || '';

  if (!nextDate) {
    // Check if there are completed follow-ups
    const followups = Array.isArray(lead.followups) ? lead.followups : [];
    if (followups.length > 0 && followups.every((f) => f.status === 'Completed')) {
      return { status: 'Completed', date: null, time: '', overdueDays: 0 };
    }
    return { status: 'None', date: null, time: '', overdueDays: 0 };
  }

  const d = new Date(nextDate);
  if (isNaN(d.getTime())) {
    return { status: 'None', date: null, time: nextTime, overdueDays: 0 };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(d);
  target.setHours(0, 0, 0, 0);

  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  let status = 'Upcoming';
  let overdueDays = 0;

  if (diffDays < 0) {
    status = 'Overdue';
    overdueDays = Math.abs(diffDays);
  } else if (diffDays === 0) {
    status = 'Due Today';
  } else {
    status = 'Upcoming';
  }

  return {
    status,
    date: d,
    time: nextTime,
    overdueDays,
  };
};

/**
 * Searches for duplicate leads based on Email, Phone, or Company + Contact Name
 * @param {Object} leadData - Incoming lead payload
 * @param {Array} existingLeads - List of existing leads
 * @param {string|null} [excludeLeadId] - ID to ignore (for edit operations)
 * @returns {{ isDuplicate: boolean, matchType: string|null, matchValue: string|null, matchingLead: Object|null, reason: string }}
 */
const findDuplicateLead = (leadData, existingLeads = [], excludeLeadId = null) => {
  if (!leadData || !Array.isArray(existingLeads)) {
    return { isDuplicate: false, matchType: null, matchValue: null, matchingLead: null, reason: '' };
  }

  const normEmail = normalizeEmail(leadData.email);
  const normPhone = normalizePhone(leadData.phone || leadData.mobileNumber);
  const normCompany = normalizeText(leadData.company);
  const normName = normalizeText(leadData.name || leadData.contactPerson);

  const cleanExcludeId = excludeLeadId ? excludeLeadId.toString().trim() : null;

  for (const lead of existingLeads) {
    if (!lead || lead.is_deleted) continue;

    const currentLeadId = (lead._id ? lead._id.toString() : (lead.leadId || lead.lead_id || '')).trim();
    if (cleanExcludeId && (currentLeadId === cleanExcludeId || (lead.leadId && lead.leadId === cleanExcludeId) || (lead.lead_id && lead.lead_id === cleanExcludeId))) {
      continue;
    }

    // 1. Exact Email Match
    if (normEmail && lead.email && normalizeEmail(lead.email) === normEmail) {
      return {
        isDuplicate: true,
        matchType: 'Email',
        matchValue: lead.email,
        matchingLead: lead,
        reason: `Matches existing lead ${lead.leadId || lead.name} with identical email: ${lead.email}`,
      };
    }

    // 2. Exact Phone Match (Minimum 7 normalized digits)
    if (normPhone && normPhone.length >= 7) {
      const existingPhone = normalizePhone(lead.phone || lead.mobileNumber);
      if (
        existingPhone &&
        existingPhone.length >= 7 &&
        (existingPhone === normPhone ||
          (normPhone.length >= 10 && existingPhone.endsWith(normPhone.slice(-10))) ||
          (existingPhone.length >= 10 && normPhone.endsWith(existingPhone.slice(-10))))
      ) {
        return {
          isDuplicate: true,
          matchType: 'Phone',
          matchValue: lead.phone || lead.mobileNumber,
          matchingLead: lead,
          reason: `Matches existing lead ${lead.leadId || lead.name} with identical phone: ${lead.phone || lead.mobileNumber}`,
        };
      }
    }

    // 3. Company + Contact Person Name Match (both fields non-empty & matching)
    if (normCompany && normCompany.length > 2 && normName && normName.length > 2) {
      const existingComp = normalizeText(lead.company);
      const existingName = normalizeText(lead.name || lead.contactPerson);
      if (existingComp === normCompany && existingName === normName) {
        return {
          isDuplicate: true,
          matchType: 'Company and Contact',
          matchValue: `${lead.company} - ${lead.contactPerson || lead.name}`,
          matchingLead: lead,
          reason: `Matches existing lead ${lead.leadId || lead.name} with identical Company "${lead.company}" and Contact "${lead.contactPerson || lead.name}"`,
        };
      }
    }
  }

  return { isDuplicate: false, matchType: null, matchValue: null, matchingLead: null, reason: '' };
};

/**
 * Enriches a lead object with dynamic score, temperature, and follow-up status
 * @param {Object} lead
 * @returns {Object} Enriched lead object
 */
const enrichLeadWithScoringAndFollowUp = (lead) => {
  if (!lead) return lead;

  const scoring = calculateLeadScore(lead);
  const followUpSummary = getLeadFollowUpSummary(lead);

  const enriched = typeof lead.toObject === 'function' ? lead.toObject() : { ...lead };

  enriched.leadScore = lead.leadScore !== undefined ? lead.leadScore : scoring.score;
  enriched.leadTemperature = lead.leadTemperature || scoring.temperature;
  enriched.scoreBreakdown = scoring.breakdown;
  enriched.followUpStatus = followUpSummary.status;
  enriched.followUpSummary = followUpSummary;

  return enriched;
};

module.exports = {
  calculateLeadScore,
  getFollowUpStatus,
  getLeadFollowUpSummary,
  findDuplicateLead,
  enrichLeadWithScoringAndFollowUp,
  normalizeEmail,
  normalizePhone,
  normalizeText,
};
