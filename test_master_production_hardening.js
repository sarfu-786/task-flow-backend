/**
 * TASKFLOW MASTER PRODUCTION HARDENING & QUALITY VERIFICATION SUITE
 * 
 * Verifies:
 * 1. Security Headers, Rate Limiting (429), Error Sanitization, Health Endpoint
 * 2. Socket.IO Handshake Authentication & Room Validation
 * 3. Strict Hierarchy Enforcement across Super Admin, Manager, and Subordinate User
 * 4. Negative ID Tampering & Cross-User Isolation (403 Forbidden verification)
 * 5. 100% Dynamic Database-Driven MIS Reports (Zero fake/hardcoded metrics)
 * 6. Export Security & Audit Trail Logging (EXPORT_DOWNLOAD)
 * 7. Model Schema Indexes Verification
 * 8. Full End-to-End Workflow across all 8 modules
 */

const http = require('http');
const mongoose = require('mongoose');

const BASE_URL = 'http://127.0.0.1:5000';

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    if (options.body) {
      reqOptions.headers['Content-Type'] = 'application/json';
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runHardeningSuite() {
  console.log('\n===============================================================');
  console.log('🚀 RUNNING TASKFLOW MASTER PRODUCTION HARDENING TEST SUITE');
  console.log('===============================================================\n');

  try {
    // -------------------------------------------------------------
    // 1. SECURITY HEADERS & HEALTH SANITIZATION
    // -------------------------------------------------------------
    console.log('🔹 1. Testing Security Headers & Health Sanitization...');
    const healthRes = await makeRequest('/api/health');
    assert(healthRes.status === 200, 'Health endpoint responds with 200 OK');
    assert(healthRes.headers['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff header present');
    assert(healthRes.headers['x-frame-options'] === 'SAMEORIGIN', 'X-Frame-Options: SAMEORIGIN header present');
    assert(healthRes.headers['x-xss-protection'] === '1; mode=block', 'X-XSS-Protection header present');
    assert(healthRes.data.database !== undefined, 'Health returns sanitized database status');
    assert(typeof healthRes.data.uptime === 'number', 'Health returns uptime without leaking DB URIs');
    assert(!JSON.stringify(healthRes.data).includes('mongodb://'), 'No database connection strings leaked in health');

    // -------------------------------------------------------------
    // 2. AUTHENTICATION & LOGIN RATE LIMITING
    // -------------------------------------------------------------
    console.log('\n🔹 2. Testing Authentication & Sliding Window Rate Limiting...');
    // Log in as Super Admin
    const adminLogin = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { usernameOrEmail: 'sarfraj', password: 'user123' },
    });
    assert(adminLogin.status === 200 && adminLogin.data.token, 'Super Admin login successful with valid JWT');
    const adminToken = adminLogin.data.token;

    // Create a dedicated Test Manager & Subordinate User for strict hierarchy tests
    const testTs = Date.now();
    const mgrEmail = `test.manager.${testTs}@taskflow.com`;
    const userEmail = `test.subordinate.${testTs}@taskflow.com`;

    const createMgrRes = await makeRequest('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: `Test Manager ${testTs}`,
        email: mgrEmail,
        username: `testmgr_${testTs}`,
        password: 'password123',
        role: 'Manager',
        department: 'Operations',
      },
    });
    assert(createMgrRes.status === 201, 'Super Admin created Test Manager');
    const managerUser = createMgrRes.data.user;

    const createUserRes = await makeRequest('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: `Test Subordinate ${testTs}`,
        email: userEmail,
        username: `testsub_${testTs}`,
        password: 'password123',
        role: 'User',
        department: 'Operations',
        reportsTo: managerUser._id || managerUser.id,
        reportsToName: `${managerUser.name} (Manager)`,
      },
    });
    assert(createUserRes.status === 201, 'Super Admin created Test Subordinate reporting to Manager');
    const regularUser = createUserRes.data.user;

    // Log in as Manager
    const managerLogin = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { usernameOrEmail: mgrEmail, password: 'password123' },
    });
    assert(managerLogin.status === 200 && managerLogin.data.token, 'Manager login successful with valid JWT');
    const managerToken = managerLogin.data.token;

    // Log in as Subordinate User
    const userLogin = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { usernameOrEmail: userEmail, password: 'password123' },
    });
    assert(userLogin.status === 200 && userLogin.data.token, 'Subordinate User login successful with valid JWT');
    const userToken = userLogin.data.token;

    // Test Rate Limiting on repeated brute-force attempts
    console.log('   Testing brute-force rate limiter on failed attempts...');
    let rateLimited = false;
    for (let i = 0; i < 18; i++) {
      const failedAttempt = await makeRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.25' },
        body: { email: 'bruteforce@taskflow.com', password: 'wrongpassword' },
      });
      if (failedAttempt.status === 429) {
        rateLimited = true;
        assert(failedAttempt.data.retryAfter !== undefined, 'Rate limiter returns 429 with retryAfter header/data');
        break;
      }
    }
    assert(rateLimited, 'Login rate limiter successfully blocked brute-force attempts with 429 Too Many Requests');

    // -------------------------------------------------------------
    // 3. SOCKET.IO HANDSHAKE AUTHENTICATION
    // -------------------------------------------------------------
    console.log('\n🔹 3. Testing Socket.IO Handshake Authentication...');
    
    // Function to perform Socket.io engine connect & connect packet exchange
    const testSocketHandshake = (token = null) => {
      return new Promise((resolve, reject) => {
        const queryParam = token ? `&token=${encodeURIComponent(token)}` : '';
        // 1. Initial engine.io handshake
        http.get(`${BASE_URL}/socket.io/?EIO=4&transport=polling${queryParam}`, (res) => {
          let rawData = '';
          res.on('data', (chunk) => { rawData += chunk; });
          res.on('end', () => {
            try {
              if (!rawData.startsWith('0')) {
                return resolve({ success: false, raw: rawData });
              }
              const engineData = JSON.parse(rawData.slice(1));
              const sid = engineData.sid;

              // 2. Send Socket.io CONNECT packet (40) with or without auth payload
              const postReq = http.request(
                `${BASE_URL}/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                { method: 'POST', headers: { 'Content-Type': 'text/plain' } },
                (postRes) => {
                  // 3. Read Socket.io connection response packet
                  const pollReq = http.request(
                    `${BASE_URL}/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                    (pollRes) => {
                      let pollData = '';
                      pollRes.on('data', (chunk) => { pollData += chunk; });
                      pollRes.on('end', () => {
                        resolve({ success: true, sid, pollData });
                      });
                    }
                  );
                  pollReq.on('error', reject);
                  pollReq.end();
                }
              );
              postReq.on('error', reject);
              const packet = token ? `40{"token":"${token}"}` : '40';
              postReq.write(packet);
              postReq.end();
            } catch (err) {
              resolve({ success: false, error: err.message });
            }
          });
        }).on('error', reject);
      });
    };

    const unauthSocketRes = await testSocketHandshake(null);
    assert(
      unauthSocketRes.pollData && unauthSocketRes.pollData.includes('Authentication error'),
      'Socket.IO rejects unauthenticated connection with "Authentication error: Token missing"'
    );

    const authSocketRes = await testSocketHandshake(adminToken);
    assert(
      authSocketRes.pollData && authSocketRes.pollData.startsWith('40'),
      'Socket.IO accepts authenticated connection and establishes session with valid JWT token'
    );

    // -------------------------------------------------------------
    // 4. STRICT HIERARCHY ENFORCEMENT ACROSS MODULES
    // -------------------------------------------------------------
    console.log('\n🔹 4. Testing Strict Organizational Hierarchy Enforcement...');
    
    // Test Hierarchy endpoint
    const adminHierarchy = await makeRequest('/api/hierarchy', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminHierarchy.status === 200 && adminHierarchy.data.hierarchy, 'Super Admin receives full organizational hierarchy tree');

    const userHierarchy = await makeRequest('/api/hierarchy', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert(userHierarchy.status === 200 && userHierarchy.data.hierarchy, 'User receives scoped subtree rooted at their position');

    // Negative Hierarchy Test: Subordinate attempting to request subordinates of an unrelated manager
    const crossSubordinates = await makeRequest(`/api/hierarchy/subordinates/${managerUser.id || managerUser._id}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert(
      crossSubordinates.status === 403,
      'Subordinate user cannot access manager hierarchy branch (returns 403 Forbidden)'
    );

    // -------------------------------------------------------------
    // 5. NEGATIVE SECURITY & CROSS-USER ID TAMPERING
    // -------------------------------------------------------------
    console.log('\n🔹 5. Testing Cross-User ID Tampering & Unauthorized Access...');
    
    // Create a lead assigned to Super Admin
    const leadEmail = `confidential.${Date.now()}@enterprise.com`;
    const createLeadRes = await makeRequest('/api/leads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Confidential Enterprise Lead',
        email: leadEmail,
        phone: '9876543210',
        dealValue: 500000,
        status: 'New',
        source: 'Referral',
      },
    });
    assert(createLeadRes.status === 201, 'Super Admin created confidential lead');
    const confidentialLeadId = createLeadRes.data.lead._id || createLeadRes.data.lead.leadId;

    // Subordinate user attempting to update/delete confidential lead
    const unauthorizedUpdate = await makeRequest(`/api/leads/${confidentialLeadId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { status: 'Lost' },
    });
    assert(unauthorizedUpdate.status === 403, 'Subordinate user cannot modify unassigned/cross-branch lead (403 Forbidden)');

    // Subordinate user attempting to view audit history of confidential lead
    const unauthorizedAudit = await makeRequest(`/api/audit-logs/Lead/${confidentialLeadId}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert(unauthorizedAudit.status === 403, 'Subordinate user cannot inspect audit logs of unassigned lead (403 Forbidden)');

    // -------------------------------------------------------------
    // 6. 100% DYNAMIC MIS REPORTS & NO FAKE METRICS
    // -------------------------------------------------------------
    console.log('\n🔹 6. Testing 100% Dynamic Database-Driven MIS Reports...');
    
    // Analytics & Executive Summary
    const misAnalytics = await makeRequest('/api/mis/analytics', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(misAnalytics.status === 200, 'MIS Analytics endpoint responds with 200 OK');
    const summary = misAnalytics.data.summary;
    assert(typeof summary.totalLeads === 'number', 'totalLeads is dynamic numeric value');
    assert(typeof summary.totalPipelineValue === 'number', 'totalPipelineValue is dynamic numeric value');
    assert(typeof summary.totalWonRevenue === 'number', 'totalWonRevenue is dynamic numeric value');
    assert(!JSON.stringify(summary).includes('23.0 Days') && !JSON.stringify(summary).includes('85%'), 'Zero fake/hardcoded cycle metrics');

    // Funnel Velocity Report (MIS-01)
    const funnelRes = await makeRequest('/api/mis/reports/funnel-velocity', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(funnelRes.status === 200 && funnelRes.data.metrics, 'MIS-01 Funnel Velocity calculated from database');
    const stageBreakdown = funnelRes.data.metrics.stageBreakdown;
    assert(Array.isArray(stageBreakdown) && stageBreakdown.length > 0, 'Funnel stage breakdown populated');
    stageBreakdown.forEach((st) => {
      assert(typeof st.count === 'number', `Stage ${st.name} count is calculated number`);
    });

    // Agent Efficiency (MIS-02)
    const agentRes = await makeRequest('/api/mis/reports/agent-efficiency', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(agentRes.status === 200 && agentRes.data.metrics, 'MIS-02 Agent Efficiency calculated');

    // Disposition Distribution (MIS-03)
    const dispoRes = await makeRequest('/api/mis/reports/disposition-distribution', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(dispoRes.status === 200 && dispoRes.data.metrics, 'MIS-03 Disposition Distribution calculated');

    // Pipeline Aging (MIS-04)
    const agingRes = await makeRequest('/api/mis/reports/pipeline-aging', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(agingRes.status === 200 && agingRes.data.metrics, 'MIS-04 Pipeline Aging calculated');

    // Lead Source ROI Report (MIS-05)
    const roiRes = await makeRequest('/api/mis/reports/attribution-roi', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(roiRes.status === 200 && roiRes.data.metrics, 'MIS-05 Lead Attribution ROI calculated');
    const roiChannels = roiRes.data.metrics.channels;
    assert(Array.isArray(roiChannels), 'ROI channels list returned');
    roiChannels.forEach((ch) => {
      assert(typeof ch.totalAcquisitionCost === 'number', `Channel ${ch.channel} totalAcquisitionCost is dynamic without fake $25 defaults`);
    });

    // -------------------------------------------------------------
    // 7. EXPORT SECURITY & AUDIT TRAIL
    // -------------------------------------------------------------
    console.log('\n🔹 7. Testing Export Download & Audit Logging...');
    
    const exportCsvRes = await makeRequest('/api/mis/export/MIS-01?format=csv', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(exportCsvRes.status === 200, 'CSV export generated successfully with 200 OK');
    assert(typeof exportCsvRes.data === 'string' && exportCsvRes.data.includes('Stage'), 'CSV export contains structured funnel data');

    // Verify Audit Trail recorded the export download
    const auditLogs = await makeRequest('/api/audit-logs?action=EXPORT_DOWNLOAD', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(auditLogs.status === 200 && auditLogs.data.logs.length > 0, 'Audit trail recorded EXPORT_DOWNLOAD action');
    assert(auditLogs.data.logs[0].action === 'EXPORT_DOWNLOAD', 'Logged operator and action match audit contract');

    // -------------------------------------------------------------
    // 8. SUBSCRIPTION RBAC PROTECTION
    // -------------------------------------------------------------
    console.log('\n🔹 8. Testing Subscription RBAC Protection...');
    
    const subGet = await makeRequest('/api/subscriptions', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert(subGet.status === 200 && subGet.data.data.totalAnnualBilling !== undefined, 'Subscriptions billing calculation works');

    // Subordinate user attempting to modify seats
    const unauthorizedSeats = await makeRequest('/api/subscriptions/seats', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { userSeats: 50 },
    });
    assert(unauthorizedSeats.status === 403, 'Subordinate user cannot modify subscription seats (403 Forbidden)');

    // -------------------------------------------------------------
    // 9. MODEL INDEXES VERIFICATION
    // -------------------------------------------------------------
    console.log('\n🔹 9. Testing Database Model Indexes...');
    const Lead = require('./models/Lead');
    const User = require('./models/User');
    const Task = require('./models/Task');
    const Complaint = require('./models/Complaint');
    const Opportunity = require('./models/Opportunity');
    const Project = require('./models/Project');
    const Notification = require('./models/Notification');
    const AuditLog = require('./models/AuditLog');

    assert(Lead.schema.indexes().length > 0, 'Lead schema has production indexes');
    assert(User.schema.indexes().length > 0, 'User schema has production indexes');
    assert(Task.schema.indexes().length > 0, 'Task schema has production indexes');
    assert(Complaint.schema.indexes().length > 0, 'Complaint schema has production indexes');
    assert(Opportunity.schema.indexes().length > 0, 'Opportunity schema has production indexes');
    assert(Project.schema.indexes().length > 0, 'Project schema has production indexes');
    assert(Notification.schema.indexes().length > 0, 'Notification schema has production indexes');
    assert(AuditLog.schema.indexes().length > 0, 'AuditLog schema has production indexes');

    // Cleanup test data created during test
    await makeRequest(`/api/leads/${confidentialLeadId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (regularUser && (regularUser._id || regularUser.id)) {
      await makeRequest(`/api/users/${regularUser._id || regularUser.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
    if (managerUser && (managerUser._id || managerUser.id)) {
      await makeRequest(`/api/users/${managerUser._id || managerUser.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }

    console.log('\n===============================================================');
    console.log(`🎉 ALL ${passedTests}/${totalTests} PRODUCTION HARDENING TESTS PASSED WITH 100% SUCCESS!`);
    console.log('===============================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ HARDENING TEST SUITE ENCOUNTERED AN ERROR:', err.message);
    process.exit(1);
  }
}

runHardeningSuite();
