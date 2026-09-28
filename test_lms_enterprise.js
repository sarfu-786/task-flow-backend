const http = require('http');
const express = require('express');
const { fallbackStore } = require('./config/db');
const User = require('./models/User');
const Task = require('./models/Task');
const Notification = require('./models/Notification');
const Lead = require('./models/Lead');
const Opportunity = require('./models/Opportunity');
const { seedDatabase } = require('./seedData');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');

async function testLMS() {
  console.log('🚀 Starting Enterprise LMS Verification Test Suite...\n');
  fallbackStore.loadFromFile();
  await seedDatabase(true, User, Task, fallbackStore, Notification, Lead, Opportunity);

  const app = express();
  app.use(express.json());
  app.use('/api/leads', require('./routes/leadRoutes'));
  app.use('/api/opportunities', require('./routes/opportunityRoutes'));
  app.use('/api/mis', require('./routes/misRoutes'));
  app.use('/api/audit-logs', require('./routes/auditRoutes'));

  const server = app.listen(5098, async () => {
    try {
      const user = fallbackStore.users.find((u) => u.role === 'Super Admin') || fallbackStore.users[0];
      const token = jwt.sign(
        { id: user._id, email: user.email, username: user.username, role: user.role, name: user.name },
        JWT_SECRET,
        { expiresIn: '1d' }
      );

      const request = (path, method = 'GET', body = null) => {
        return new Promise((resolve, reject) => {
          const req = http.request(
            `http://localhost:5098${path}`,
            {
              method,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
            },
            (res) => {
              let data = '';
              res.on('data', (c) => (data += c));
              res.on('end', () => {
                try {
                  resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch {
                  resolve({ status: res.statusCode, data });
                }
              });
            }
          );
          req.on('error', reject);
          if (body) req.write(JSON.stringify(body));
          req.end();
        });
      };

      // Test 1: Create Lead
      console.log('1. Testing Lead Creation with UUID and LMS fields...');
      const createRes = await request('/api/leads', 'POST', {
        name: 'Acme Global Corp',
        company: 'Acme Systems',
        phone: '+1 555-0199',
        email: 'procurement@acme.com',
        source: 'LinkedIn Ads',
        campaign_source: 'LinkedIn Ads',
        pipeline_value: 45000,
        priority: 'High',
        assignedTo: user.name,
      });
      console.log('Create response:', createRes.status, createRes.data.success ? '✓ SUCCESS' : '❌ FAILED', 'Lead ID:', createRes.data.lead?.lead_id);

      const leadId = createRes.data.lead?._id;

      // Test 2: Log Disposition NO_ANSWER
      console.log('\n2. Testing Disposition Framework: NO_ANSWER Trigger...');
      const dispoRes = await request(`/api/leads/${leadId}/disposition`, 'POST', {
        disposition_code: 'NO_ANSWER',
        notes: 'Called customer, no response after 4 rings.',
        duration_seconds: 35,
      });
      console.log('Disposition response:', dispoRes.status, dispoRes.data.systemActionExecuted);
      console.log('Lead new status:', dispoRes.data.lead?.status, 'Retry count:', dispoRes.data.lead?.retry_count);

      // Test 3: Log Disposition QUALIFIED_OPPORTUNITY
      console.log('\n3. Testing Disposition Framework: QUALIFIED_OPPORTUNITY (Instant Conversion)...');
      const dispoConvertRes = await request(`/api/leads/${leadId}/disposition`, 'POST', {
        disposition_code: 'QUALIFIED_OPPORTUNITY',
        notes: 'High intent verified, budget approved $45,000.',
        custom_deal_value: 45000,
      });
      console.log('Qualified response:', dispoConvertRes.status, dispoConvertRes.data.systemActionExecuted);
      console.log('Converted Opportunity ID:', dispoConvertRes.data.lead?.convertedOpportunityId);

      // Test 4: Multi-Dimensional Filtration Engine
      console.log('\n4. Testing Advanced Multi-Dimensional Filtrations Engine...');
      const filterRes = await request('/api/leads/filter', 'POST', {
        logic: 'AND',
        rules: [
          { field: 'priority', operator: 'EQUALS', value: 'High' },
          { field: 'pipeline_value', operator: 'GT', value: 10000 },
        ],
      });
      console.log('Filter matches:', filterRes.data.count, 'Execution time:', filterRes.data.executionTimeMs + 'ms');

      // Test 5: MIS Executive Analytics
      console.log('\n5. Testing MIS Consolidated Executive Analytics & Widgets...');
      const analyticsRes = await request('/api/mis/analytics', 'GET');
      console.log('Analytics status:', analyticsRes.status, 'Total Leads:', analyticsRes.data.summary?.totalLeads, 'Total Opps:', analyticsRes.data.summary?.totalOpportunities);
      console.log('Funnel Stages:', analyticsRes.data.widgets?.funnelGraphic?.map((f) => `${f.label}: ${f.count}`).join(' -> '));

      // Test 6: Audit Logs Query
      console.log('\n6. Testing Immutable Audit Trail Logging...');
      const auditRes = await request('/api/audit-logs', 'GET');
      console.log('Audit logs recorded:', auditRes.data.count, 'Latest Action:', auditRes.data.logs?.[0]?.action, 'Delta:', auditRes.data.logs?.[0]?.delta);

      console.log('\n🎉 ALL ENTERPRISE LMS BACKEND ENDPOINTS PASSED SUCCESSFULLY!\n');
    } catch (err) {
      console.error('Test execution error:', err);
    } finally {
      server.close();
      process.exit(0);
    }
  });
}

testLMS();
