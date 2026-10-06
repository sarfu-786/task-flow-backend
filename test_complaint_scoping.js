const http = require('http');
const express = require('express');
const { fallbackStore } = require('./config/db');
const User = require('./models/User');
const Task = require('./models/Task');
const Notification = require('./models/Notification');
const Lead = require('./models/Lead');
const Opportunity = require('./models/Opportunity');
const Complaint = require('./models/Complaint');
const { seedDatabase } = require('./seedData');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');

async function testComplaintScoping() {
  console.log('--- Testing Complaint Scoping & Access Control ---');
  fallbackStore.loadFromFile();
  await seedDatabase(true, User, Task, fallbackStore, Notification, Lead, Opportunity, Complaint);

  const app = express();
  app.use(express.json());
  app.use('/api/complaints', require('./routes/complaintRoutes'));

  const server = app.listen(5098, async () => {
    try {
      const superAdminUser = fallbackStore.users.find((u) => u.role === 'Super Admin') || fallbackStore.users[0];
      const regularUser1 = {
        _id: '64e8a1' + '1111111111111111'.substring(0, 16),
        name: 'Peer User Alpha',
        email: 'peer.alpha@taskflow.com',
        username: 'peeralpha',
        role: 'User',
        roles: ['User'],
        reportsTo: null,
      };
      const regularUser2 = {
        _id: '64e8a1' + '2222222222222222'.substring(0, 16),
        name: 'Peer User Beta',
        email: 'peer.beta@taskflow.com',
        username: 'peerbeta',
        role: 'User',
        roles: ['User'],
        reportsTo: null,
      };

      if (!fallbackStore.users.some(u => u._id === regularUser1._id)) fallbackStore.users.push(regularUser1);
      if (!fallbackStore.users.some(u => u._id === regularUser2._id)) fallbackStore.users.push(regularUser2);

      console.log(`Super Admin: ${superAdminUser.name} (${superAdminUser._id})`);
      console.log(`User 1: ${regularUser1.name} (${regularUser1._id})`);
      console.log(`User 2: ${regularUser2.name} (${regularUser2._id})`);

      const makeToken = (u) =>
        jwt.sign(
          { id: u._id, email: u.email, username: u.username, role: u.role, roles: u.roles || [u.role], name: u.name },
          JWT_SECRET,
          { expiresIn: '1d' }
        );

      const superToken = makeToken(superAdminUser);
      const user1Token = makeToken(regularUser1);
      const user2Token = makeToken(regularUser2);

      const request = (path, method = 'GET', body = null, token = superToken) => {
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

      // 1. Create Complaint A assigned to User 1
      const createResA = await request('/api/complaints', 'POST', {
        customerName: 'Acme Corp',
        subject: 'Server latency in Asia region',
        description: 'Response time exceeds 2000ms during peak hours',
        priority: 'High',
        category: 'Technical Glitch',
        assignedTo: regularUser1._id,
        assignedToName: regularUser1.name,
      }, superToken);
      console.log('1. Created Complaint A (assigned to User 1):', createResA.data.complaint?.ticketNumber, 'Status:', createResA.status);
      const ticketA = createResA.data.complaint;

      // 2. Create Complaint B assigned to User 2
      const createResB = await request('/api/complaints', 'POST', {
        customerName: 'Globex Logistics',
        subject: 'Invoice currency calculation issue',
        description: 'Discrepancy in VAT calculation on monthly invoice',
        priority: 'Medium',
        category: 'Billing Query',
        assignedTo: regularUser2._id,
        assignedToName: regularUser2.name,
      }, superToken);
      console.log('2. Created Complaint B (assigned to User 2):', createResB.data.complaint?.ticketNumber, 'Status:', createResB.status);
      const ticketB = createResB.data.complaint;

      // 3. Super Admin list complaints -> must see BOTH
      const saListRes = await request('/api/complaints', 'GET', null, superToken);
      console.log('3. Super Admin complaints count:', saListRes.data.complaints.length, 'Total in DB:', saListRes.data.pagination.total);
      if (saListRes.data.complaints.length < 2) throw new Error('Super Admin should see all complaints');

      // 4. User 1 list complaints -> must ONLY see Complaint A
      const u1ListRes = await request('/api/complaints', 'GET', null, user1Token);
      console.log('4. User 1 complaints count:', u1ListRes.data.complaints.length);
      const u1HasTicketA = u1ListRes.data.complaints.some((c) => c._id === ticketA._id);
      const u1HasTicketB = u1ListRes.data.complaints.some((c) => c._id === ticketB._id);
      console.log(`   User 1 sees Ticket A: ${u1HasTicketA}, sees Ticket B: ${u1HasTicketB}`);
      if (!u1HasTicketA || u1HasTicketB) {
        throw new Error('User 1 should ONLY see Complaint A (assigned to them), not Complaint B');
      }

      // 5. User 2 list complaints -> must ONLY see Complaint B
      const u2ListRes = await request('/api/complaints', 'GET', null, user2Token);
      console.log('5. User 2 complaints count:', u2ListRes.data.complaints.length);
      const u2HasTicketA = u2ListRes.data.complaints.some((c) => c._id === ticketA._id);
      const u2HasTicketB = u2ListRes.data.complaints.some((c) => c._id === ticketB._id);
      console.log(`   User 2 sees Ticket A: ${u2HasTicketA}, sees Ticket B: ${u2HasTicketB}`);
      if (u2HasTicketA || !u2HasTicketB) {
        throw new Error('User 2 should ONLY see Complaint B (assigned to them), not Complaint A');
      }

      // 6. User 1 direct GET /api/complaints/:id for Ticket B (User 2's ticket) -> MUST return 403
      const u1GetBRes = await request(`/api/complaints/${ticketB._id}`, 'GET', null, user1Token);
      console.log('6. User 1 attempting to GET Ticket B -> status:', u1GetBRes.status, 'message:', u1GetBRes.data.message);
      if (u1GetBRes.status !== 403) throw new Error('User 1 should get 403 Forbidden when fetching Ticket B');

      // 7. User 1 direct PUT /api/complaints/:id for Ticket B -> MUST return 403
      const u1PutBRes = await request(`/api/complaints/${ticketB._id}`, 'PUT', { priority: 'Urgent' }, user1Token);
      console.log('7. User 1 attempting to edit Ticket B -> status:', u1PutBRes.status);
      if (u1PutBRes.status !== 403) throw new Error('User 1 should get 403 Forbidden when editing Ticket B');

      // 8. User 1 resolving their OWN Ticket A -> MUST succeed (200)
      const u1ResolveARes = await request(`/api/complaints/${ticketA._id}/resolve`, 'PUT', {
        resolutionNotes: 'Patched server routing cache',
        rootCause: 'BGP misconfiguration',
        csatRating: 5,
      }, user1Token);
      console.log('8. User 1 resolving Ticket A -> status:', u1ResolveARes.status, 'Ticket status:', u1ResolveARes.data.complaint?.status);
      if (u1ResolveARes.status !== 200 || u1ResolveARes.data.complaint?.status !== 'Resolved') {
        throw new Error('User 1 should be able to resolve their assigned ticket');
      }

      // 9. User 1 attempting to delete Ticket A -> MUST return 403 (Only Super Admin can delete)
      const u1DelARes = await request(`/api/complaints/${ticketA._id}`, 'DELETE', null, user1Token);
      console.log('9. User 1 attempting to DELETE Ticket A -> status:', u1DelARes.status);
      if (u1DelARes.status !== 403) throw new Error('User 1 should get 403 Forbidden when trying to delete ticket');

      // 10. Super Admin deleting Ticket A -> MUST succeed (200)
      const saDelARes = await request(`/api/complaints/${ticketA._id}`, 'DELETE', null, superToken);
      console.log('10. Super Admin deleting Ticket A -> status:', saDelARes.status);
      if (saDelARes.status !== 200) throw new Error('Super Admin should be able to delete ticket');

      console.log('\n✅ ALL 10 COMPLAINT SCOPING AND ACCESS CONTROL TESTS PASSED PERFECTLY!\n');
      server.close();
      process.exit(0);
    } catch (err) {
      console.error('❌ Test failed:', err.message);
      server.close();
      process.exit(1);
    }
  });
}

testComplaintScoping();
