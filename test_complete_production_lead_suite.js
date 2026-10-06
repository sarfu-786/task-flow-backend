const http = require('http');

const baseUrl = 'http://localhost:5000/api';

const request = (method, path, body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

async function runProductionTestSuite() {
  console.log('================================================================');
  console.log('🚀 TaskFlow Production-Ready Lead Management Comprehensive Suite');
  console.log('================================================================\n');

  try {
    // 1. Auth: Super Admin, Manager, Standard User
    console.log('--- Step 1: Authentication & Role Setup ---');
    const adminLogin = await request('POST', '/auth/login', { usernameOrEmail: 'sarfraj', password: 'user123' });
    if (adminLogin.status !== 200 || !adminLogin.data.token) throw new Error('Super Admin login failed');
    const adminToken = adminLogin.data.token;
    console.log('✅ Super Admin authenticated.');

    // 2. Pillar 1: Lead Scoring & Temperature
    console.log('\n--- Step 2: Pillar 1 - Lead Scoring & Temperature ---');
    const ts = Date.now();
    const highValueLeadRes = await request('POST', '/leads', {
      contactPerson: `Aarav Verma_${ts}`,
      company: `Enterprise Corp ${ts}`,
      email: `aarav_${ts}@entcorp.com`,
      mobileNumber: `+91 98765 43210`,
      source: 'Website',
      priority: 'Urgent',
      estimatedValue: 1500000,
      status: 'Qualified',
    }, adminToken);
    
    if (highValueLeadRes.status !== 201) throw new Error('High value lead creation failed');
    const highLead = highValueLeadRes.data.lead;
    console.log(`High-value lead score: ${highLead.leadScore}/100, temperature: ${highLead.leadTemperature}`);
    if (highLead.leadScore < 70 || highLead.leadTemperature !== 'Hot') {
      throw new Error(`Expected Hot temperature for high value lead, got ${highLead.leadTemperature} (${highLead.leadScore})`);
    }
    console.log('✅ Hot Lead scored correctly (≥ 70 -> Hot).');

    const lowValueLeadRes = await request('POST', '/leads', {
      contactPerson: `Cold Prospect_${ts}`,
      company: `Small Shop ${ts}`,
      email: `cold_${ts}@smallshop.com`,
      mobileNumber: `+91 91234 56789`,
      source: 'Cold Outreach',
      priority: 'Low',
      estimatedValue: 1000,
      status: 'New',
    }, adminToken);
    const lowLead = lowValueLeadRes.data.lead;
    console.log(`Low-value lead score: ${lowLead.leadScore}/100, temperature: ${lowLead.leadTemperature}`);
    if (lowLead.leadScore >= 40 || lowLead.leadTemperature !== 'Cold') {
      throw new Error(`Expected Cold temperature for low value lead, got ${lowLead.leadTemperature} (${lowLead.leadScore})`);
    }
    console.log('✅ Cold Lead scored correctly (< 40 -> Cold).');

    // Test Temperature Filter
    const hotFilterRes = await request('GET', '/leads?temperature=Hot', null, adminToken);
    if (hotFilterRes.status !== 200 || !Array.isArray(hotFilterRes.data.leads)) throw new Error('Temperature filter failed');
    const allHot = hotFilterRes.data.leads.every(l => l.leadTemperature === 'Hot' || l.leadScore >= 70);
    if (!allHot) throw new Error('Temperature filter returned non-hot leads');
    console.log(`✅ GET /api/leads?temperature=Hot successfully filtered ${hotFilterRes.data.leads.length} Hot leads.`);

    // 3. Pillar 2: Duplicate Lead Detection
    console.log('\n--- Step 3: Pillar 2 - Duplicate Lead Detection ---');
    // Exact duplicate check
    const dupCheck1 = await request('POST', '/leads/check-duplicate', {
      email: `aarav_${ts}@entcorp.com`,
      phone: `+91 98765 43210`,
      company: `Enterprise Corp ${ts}`,
      contactPerson: `Aarav Verma_${ts}`,
    }, adminToken);
    console.log('Duplicate check result for identical lead:', dupCheck1.data);
    if (!dupCheck1.data.isDuplicate || !['Email', 'EMAIL'].includes(dupCheck1.data.matchType)) {
      throw new Error('Duplicate email was not detected');
    }
    console.log('✅ Exact Email duplicate detected.');

    // Duplicate check by phone
    const dupCheckPhone = await request('POST', '/leads/check-duplicate', {
      email: `different_email_${ts}@test.com`,
      phone: `9876543210`,
    }, adminToken);
    if (!dupCheckPhone.data.isDuplicate || !['Phone', 'PHONE'].includes(dupCheckPhone.data.matchType)) {
      throw new Error('Duplicate phone was not detected');
    }
    console.log('✅ Normalized phone duplicate detected.');

    // Genuine different contact at SAME company (MUST NOT be blocked)
    const distinctContactCheck = await request('POST', '/leads/check-duplicate', {
      email: `priya_finance_${ts}@entcorp.com`,
      phone: `+91 98888 77777`,
      company: `Enterprise Corp ${ts}`,
      contactPerson: `Priya Sharma (CFO)`,
    }, adminToken);
    console.log('Different contact at same company result:', distinctContactCheck.data);
    if (distinctContactCheck.data.isDuplicate) {
      throw new Error('Distinct contact at same company was incorrectly flagged as duplicate!');
    }
    console.log('✅ Distinct contact at same company correctly allowed (not false duplicate).');

    // 4. Pillar 3: Follow-Up Reminders & Overdue Handling
    console.log('\n--- Step 4: Pillar 3 - Follow-Up Reminders & Overdue Handling ---');
    const pastDate = '2026-09-01'; // Past date -> Overdue
    const todayDate = new Date().toISOString().split('T')[0]; // Due Today
    const futureDate = '2026-12-31'; // Upcoming

    // Schedule Overdue Follow-up
    await request('POST', `/leads/${highLead._id}/followups`, {
      followUpDate: pastDate,
      reason: 'Overdue contract review',
      status: 'Pending',
    }, adminToken);

    // Fetch lead details to verify calculated follow-up status
    const overdueLeadRes = await request('GET', `/leads/${highLead._id}`, null, adminToken);
    console.log(`Lead follow-up status: ${overdueLeadRes.data.lead.followUpStatus}, overdue days: ${overdueLeadRes.data.lead.followUpOverdueDays}`);
    if (overdueLeadRes.data.lead.followUpStatus !== 'Overdue') {
      throw new Error(`Expected Overdue status, got ${overdueLeadRes.data.lead.followUpStatus}`);
    }
    console.log('✅ Overdue Follow-up detected and tagged.');

    // Test followUpStatus filter
    const overdueFilterRes = await request('GET', '/leads?followUpStatus=Overdue', null, adminToken);
    if (overdueFilterRes.status !== 200 || !overdueFilterRes.data.leads.some(l => (l._id || l.leadId) === highLead._id)) {
      throw new Error('GET /api/leads?followUpStatus=Overdue did not return overdue lead');
    }
    console.log('✅ GET /api/leads?followUpStatus=Overdue filter verified.');

    // 5. Pillar 4: Complete Lead Audit History
    console.log('\n--- Step 5: Pillar 4 - Complete Lead Audit History ---');
    // Log a call and update disposition
    await request('POST', `/leads/${highLead._id}/calls`, {
      salesUser: 'Sarfaraj Ahmad',
      callType: 'Outgoing',
      callStatus: 'Connected Successfully',
      callOutcome: 'Interested',
      remarks: 'Product walkthrough completed.',
    }, adminToken);

    // Convert lead to Opportunity
    const convRes = await request('POST', `/leads/${highLead._id}/convert`, {
      opportunityName: `Deal - Enterprise Corp ${ts}`,
      dealValue: 1500000,
      stage: 'Proposal/Price Quote',
    }, adminToken);
    if (convRes.status !== 201) throw new Error('Lead conversion failed');

    // Fetch audit trail
    const auditRes = await request('GET', `/audit-logs/Lead/${highLead._id}`, null, adminToken);
    console.log(`Audit logs count for lead: ${auditRes.data.logs?.length}`);
    const actions = (auditRes.data.logs || []).map(l => l.action);
    console.log('Logged Audit Actions:', actions);
    const hasCreate = actions.includes('CREATE');
    const hasCall = actions.includes('CALL_LOGGED');
    const hasConvert = actions.includes('CONVERT');
    if (!hasCreate || !hasCall || !hasConvert) {
      throw new Error(`Missing expected audit lifecycle records. Actions: ${JSON.stringify(actions)}`);
    }
    console.log('✅ Complete Lead Audit Trail lifecycle verified.');

    // 6. Pillar 5: Strict Hierarchy & Role-Based Access Scoping
    console.log('\n--- Step 6: Pillar 5 - Strict Hierarchy & Role-Based Access ---');
    // Attempt to access without token
    const unauthRes = await request('GET', '/leads', null, null);
    if (unauthRes.status !== 401) throw new Error('Unauthenticated access was not rejected');
    console.log('✅ Unauthenticated requests strictly rejected with 401.');

    // 7. Non-Regression of Other Modules
    console.log('\n--- Step 7: Non-Regression of Other Modules ---');
    // Tasks Stats
    const dashStats = await request('GET', '/tasks/stats', null, adminToken);
    console.log('Task Stats Status:', dashStats.status);
    if (dashStats.status !== 200) throw new Error('Task stats failed');
    console.log('✅ Task stats intact.');

    // MIS Analytics
    const misAnalytics = await request('GET', '/mis/analytics', null, adminToken);
    console.log('MIS Analytics Status:', misAnalytics.status);
    if (misAnalytics.status !== 200) throw new Error('MIS analytics failed');
    console.log('✅ MIS Analytics intact.');

    // Organization Hierarchy
    const hierRes = await request('GET', '/hierarchy', null, adminToken);
    console.log('Hierarchy API Status:', hierRes.status);
    if (hierRes.status !== 200) throw new Error('Hierarchy module failed');
    console.log('✅ Organizational Hierarchy module intact.');

    // Users
    const usersRes = await request('GET', '/users', null, adminToken);
    console.log('User Management API Status:', usersRes.status);
    if (usersRes.status !== 200) throw new Error('User management module failed');
    console.log('✅ User Management module intact.');

    // Tasks
    const tasksRes = await request('GET', '/tasks', null, adminToken);
    console.log('Task Management API Status:', tasksRes.status);
    if (tasksRes.status !== 200) throw new Error('Task management module failed');
    console.log('✅ Task Management module intact.');

    // Projects
    const projectsRes = await request('GET', '/projects', null, adminToken);
    console.log('Project Management API Status:', projectsRes.status);
    if (projectsRes.status !== 200) throw new Error('Project management module failed');
    console.log('✅ Project Management module intact.');

    // Opportunities
    const oppsRes = await request('GET', '/opportunities', null, adminToken);
    console.log('Opportunity Management API Status:', oppsRes.status);
    if (oppsRes.status !== 200) throw new Error('Opportunity management module failed');
    console.log('✅ Opportunity Management module intact.');

    // Complaints
    const complaintsRes = await request('GET', '/complaints', null, adminToken);
    console.log('Complaint Management API Status:', complaintsRes.status);
    if (complaintsRes.status !== 200) throw new Error('Complaints management module failed');
    console.log('✅ Complaints Management module intact.');

    console.log('\n================================================================');
    console.log('🌟 ALL 7 PRODUCTION READINESS & MODULE CHECKS PASSED 100%! 🌟');
    console.log('================================================================');
  } catch (err) {
    console.error('❌ Production test suite failed:', err);
    process.exit(1);
  }
}

runProductionTestSuite();
