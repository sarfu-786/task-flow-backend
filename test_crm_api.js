const http = require('http');
const express = require('express');
const cors = require('cors');
const { fallbackStore } = require('./config/db');
const User = require('./models/User');
const Task = require('./models/Task');
const Notification = require('./models/Notification');
const Lead = require('./models/Lead');
const Opportunity = require('./models/Opportunity');
const { seedDatabase } = require('./seedData');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');

async function testCRM() {
  console.log('Testing CRM Endpoints...');
  fallbackStore.loadFromFile();
  await seedDatabase(true, User, Task, fallbackStore, Notification, Lead, Opportunity);

  const app = express();
  app.use(express.json());
  app.use('/api/leads', require('./routes/leadRoutes'));
  app.use('/api/opportunities', require('./routes/opportunityRoutes'));

  const server = app.listen(5099, async () => {
    try {
      // Generate token for Super Admin
      const user = fallbackStore.users.find((u) => u.role === 'Super Admin') || fallbackStore.users[0];
      const token = jwt.sign(
        { id: user._id, email: user.email, username: user.username, role: user.role, name: user.name },
        JWT_SECRET,
        { expiresIn: '1d' }
      );

      const request = (path, method = 'GET', body = null) => {
        return new Promise((resolve, reject) => {
          const req = http.request(
            `http://localhost:5099${path}`,
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

      // 1. GET /api/leads
      const getLeadsRes = await request('/api/leads');
      console.log('1. GET /api/leads -> count:', getLeadsRes.data.count, 'status:', getLeadsRes.status);
      if (getLeadsRes.status !== 200 || !getLeadsRes.data.success) throw new Error('GET /api/leads failed');

      // 2. GET /api/leads/stats
      const leadStatsRes = await request('/api/leads/stats');
      console.log('2. GET /api/leads/stats -> total:', leadStatsRes.data.stats.total, 'qualified:', leadStatsRes.data.stats.qualified);
      if (leadStatsRes.status !== 200 || !leadStatsRes.data.success) throw new Error('GET /api/leads/stats failed');

      // 3. POST /api/leads
      const createLeadRes = await request('/api/leads', 'POST', {
        name: 'Sunil Gavaskar',
        company: 'Sunny Enterprises',
        phone: '+91 98200 11223',
        email: 'sunil@sunnyent.in',
        source: 'Website',
        status: 'Qualified',
        priority: 'High',
        notes: 'Interested in enterprise task hierarchy system.',
      });
      console.log('3. POST /api/leads -> created lead id:', createLeadRes.data.lead._id);
      if (createLeadRes.status !== 201) throw new Error('POST /api/leads failed');

      const createdLeadId = createLeadRes.data.lead._id;

      // 4. POST /api/leads/:id/convert
      const convertRes = await request(`/api/leads/${createdLeadId}/convert`, 'POST', {
        opportunityName: 'Sunny Enterprises Multi-Seat License',
        amount: 500000,
        stage: 'Proposal',
        probability: 50,
      });
      console.log('4. POST /api/leads/:id/convert -> opp name:', convertRes.data.opportunity.name, 'lead status:', convertRes.data.lead.status);
      if (convertRes.status !== 201 || convertRes.data.lead.status !== 'Converted') throw new Error('Lead conversion failed');

      // 5. GET /api/opportunities
      const getOppsRes = await request('/api/opportunities');
      console.log('5. GET /api/opportunities -> count:', getOppsRes.data.count);
      if (getOppsRes.status !== 200) throw new Error('GET /api/opportunities failed');

      // 6. GET /api/opportunities/stats
      const oppStatsRes = await request('/api/opportunities/stats');
      console.log('6. GET /api/opportunities/stats -> totalPipelineValue:', oppStatsRes.data.stats.totalPipelineValue, 'winRate:', oppStatsRes.data.stats.winRate);
      if (oppStatsRes.status !== 200) throw new Error('GET /api/opportunities/stats failed');

      // 7. PATCH /api/opportunities/:id/stage
      const oppId = convertRes.data.opportunity._id;
      const stageUpdateRes = await request(`/api/opportunities/${oppId}/stage`, 'PATCH', {
        stage: 'Won',
      });
      console.log('7. PATCH /api/opportunities/:id/stage -> stage:', stageUpdateRes.data.opportunity.stage, 'prob:', stageUpdateRes.data.opportunity.probability);
      if (stageUpdateRes.status !== 200 || stageUpdateRes.data.opportunity.stage !== 'Won') throw new Error('Stage update failed');

      console.log('\n✅ ALL CRM BACKEND ENDPOINTS PASSED PERFECTLY!\n');
      server.close();
      process.exit(0);
    } catch (err) {
      console.error('❌ CRM Test failed:', err);
      server.close();
      process.exit(1);
    }
  });
}

testCRM();
