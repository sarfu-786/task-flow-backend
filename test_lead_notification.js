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

async function testLeadNotifications() {
  console.log('🧪 Starting Instant Lead Notification Integration Test...\n');

  try {
    // 1. Authenticate as Super Admin / Manager
    console.log('1. Logging in as Admin/Manager (sarfraj)...');
    const adminLogin = await request('POST', '/auth/login', {
      usernameOrEmail: 'sarfraj',
      password: 'user123',
    });

    if (adminLogin.status !== 200 || !adminLogin.data.token) {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLogin.data)}`);
    }
    const adminToken = adminLogin.data.token;
    const adminUser = adminLogin.data.user;
    console.log(`✅ Admin logged in: ${adminUser.name} (${adminUser.role})\n`);

    // 2. Fetch users to get a sales rep user
    const usersRes = await request('GET', '/users', null, adminToken);
    const usersList = usersRes.data.users || usersRes.data.data || [];
    const salesUser = usersList.find(u => u.name && u.name !== adminUser.name) || adminUser;
    console.log(`2. Target assigned sales user for lead: ${salesUser.name} (${salesUser.username})\n`);

    // 3. Create a New Lead assigned to the user
    const testLeadEmail = `lead_${Date.now()}@nexustech.io`;
    console.log(`3. Creating new lead assigned to "${salesUser.name}"...`);
    const createLeadRes = await request(
      'POST',
      '/leads',
      {
        contactPerson: 'Aditi Sharma',
        company: 'Nexus Tech Global',
        mobileNumber: '+91 98765 43210',
        email: testLeadEmail,
        source: 'Website',
        requirement: 'ERP & Lead Tracking Suite with 50 Sales Licenses',
        status: 'New',
        priority: 'High',
        estimatedValue: 850000,
        assignedSalesUser: salesUser.name,
        assignedTo: salesUser.name,
        remarks: 'Urgent enterprise lead from pricing contact form',
        nextFollowUpDate: '2026-10-01',
        nextFollowUpTime: '11:00 AM',
      },
      adminToken
    );

    console.log('Lead Creation Status:', createLeadRes.status);
    console.log('Lead Created:', {
      leadId: createLeadRes.data.lead?.leadId,
      name: createLeadRes.data.lead?.name,
      assignedTo: createLeadRes.data.lead?.assignedTo,
    });

    if (createLeadRes.status !== 201) {
      throw new Error(`Lead creation failed: ${JSON.stringify(createLeadRes.data)}`);
    }
    console.log('✅ Lead created successfully.\n');

    // 4. Log in as the assigned user or check their notification center
    let userToken = adminToken;
    if (salesUser._id !== adminUser._id) {
      const userLogin = await request('POST', '/auth/login', {
        usernameOrEmail: salesUser.username || salesUser.email,
        password: 'user123',
      });
      if (userLogin.status === 200 && userLogin.data.token) {
        userToken = userLogin.data.token;
      }
    }

    console.log('4. Fetching notifications from Notification Center for assigned user...');
    const notifsRes = await request('GET', '/notifications', null, userToken);
    console.log('Notifications Status:', notifsRes.status);
    console.log('Unread Count:', notifsRes.data.unreadCount);
    console.log('Total Notifications:', notifsRes.data.count);

    const leadNotifs = (notifsRes.data.notifications || []).filter(
      n => n.type === 'lead_assigned' || (n.title && n.title.includes('Lead')) || (n.message && n.message.includes('Nexus Tech Global'))
    );

    console.log(`Found ${leadNotifs.length} lead notification(s) in inbox:`);
    if (leadNotifs.length > 0) {
      const latest = leadNotifs[0];
      console.log('--- Latest Lead Notification ---');
      console.log('Title:', latest.title);
      console.log('Message:', latest.message);
      console.log('Recipient:', latest.recipientName);
      console.log('Assigned By:', latest.assignedBy);
      console.log('Remark:', latest.remark);
      console.log('isRead:', latest.isRead);
      console.log('Type:', latest.type);
      console.log('--------------------------------');

      // 5. Test marking notification as read
      console.log('\n5. Testing PATCH /api/notifications/:id/read...');
      const readRes = await request('PATCH', `/notifications/${latest._id}/read`, null, userToken);
      console.log('Mark Read Status:', readRes.status);
      console.log('Mark Read Message:', readRes.data.message);
      if (readRes.status !== 200) throw new Error('Mark read failed');
      console.log('✅ Lead notification marked as read successfully.');
    } else {
      throw new Error('❌ Expected lead notification was not found in user inbox!');
    }

    console.log('\n🎉 ALL LEAD NOTIFICATION INTEGRATION TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  }
}

testLeadNotifications();
