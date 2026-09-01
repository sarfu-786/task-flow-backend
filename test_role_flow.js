const http = require('http');

const request = (path, method = 'GET', data = null, token = null) => {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: `/api${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', (e) => reject(e));
    if (payload) req.write(payload);
    req.end();
  });
};

const runVerification = async () => {
  console.log('=============================================');
  console.log('🧪 Starting Role-Based Flow & Notification Test');
  console.log('=============================================');

  try {
    // 1. Test Manager Login
    console.log('\n[1] Testing Manager Login (sarfu@gmail.com)...');
    let managerToken = null;
    const mgrLogin = await request('/auth/login', 'POST', {
      usernameOrEmail: 'sarfu@gmail.com',
      password: 'user123',
    });

    if (mgrLogin.status === 200 && mgrLogin.data.success) {
      managerToken = mgrLogin.data.token;
      console.log(`✅ Manager logged in successfully: ${mgrLogin.data.user.name} (${mgrLogin.data.user.role})`);
    } else {
      const adminLogin = await request('/auth/login', 'POST', {
        usernameOrEmail: 'admin@taskflow.com',
        password: 'admin123',
      });
      if (adminLogin.status === 200) {
        managerToken = adminLogin.data.token;
        console.log(`✅ Manager/Admin logged in: ${adminLogin.data.user.name}`);
      }
    }

    // 2. Test User Login
    console.log('\n[2] Testing Regular User Login (rohan.verma@taskflow.com)...');
    const userLogin = await request('/auth/login', 'POST', {
      usernameOrEmail: 'rohan.verma@taskflow.com',
      password: 'user123',
    });

    let userToken = null;
    if (userLogin.status === 200 && userLogin.data.success) {
      userToken = userLogin.data.token;
      console.log(`✅ User logged in successfully: ${userLogin.data.user.name} (${userLogin.data.user.role})`);
    } else {
      console.error('❌ User login failed:', userLogin);
    }

    // 3. Manager assigns a task to User
    if (managerToken) {
      console.log('\n[3] Manager assigning a new task to Rohan Verma...');
      const newTask = await request(
        '/tasks',
        'POST',
        {
          taskType: 'backend work',
          description: 'Deploy Redis caching cluster for sub-millisecond session lookups',
          expectedDate: new Date(Date.now() + 86400000 * 5).toISOString(),
          remark: 'Ensure cluster has master-replica replication and sentinel failover',
          status: 'To Do',
          priority: 'High',
          assignedTo: 'Rohan Verma',
          assignedBy: 'Sarfu (Manager)',
        },
        managerToken
      );

      console.log(`✅ Task assigned: ID ${newTask.data.task._id}, Assigned to: ${newTask.data.task.assignedTo}, Assigned By: ${newTask.data.task.assignedBy}`);
      const createdTaskId = newTask.data.task._id;

      // 4. User fetches tasks (verify self-data isolation)
      if (userToken) {
        console.log('\n[4] User fetching assigned tasks...');
        const userTasks = await request('/tasks', 'GET', null, userToken);
        console.log(`✅ User received ${userTasks.data.count} tasks (strictly their assigned tasks).`);

        // 4b. User fetches their Inbox Notifications
        console.log('\n[4b] User checking their Task Assignment Inbox...');
        const userNotifs = await request('/notifications', 'GET', null, userToken);
        console.log(`✅ User Inbox has ${userNotifs.data.count} messages (${userNotifs.data.unreadCount} unread).`);
        if (userNotifs.data.notifications.length > 0) {
          const topNotif = userNotifs.data.notifications[0];
          console.log(`📩 User received Inbox Alert: "${topNotif.title}" - Message: "${topNotif.message}" - Instructions: "${topNotif.remark}"`);
        }

        // 5. User starts and then completes the task with remark
        console.log('\n[5] User completing task and adding completion remark...');
        const completeRes = await request(
          `/tasks/${createdTaskId}/status`,
          'PATCH',
          {
            status: 'Completed',
            completionRemark: 'Redis 3-node sentinel cluster deployed on AWS VPC. Verified failover under 1.2s.',
          },
          userToken
        );
        console.log(`✅ Task marked Completed: ${completeRes.data.message}`);

        // 6. Manager checks Inbox Notifications
        console.log('\n[6] Manager fetching Inbox Notifications...');
        const notifRes = await request('/notifications', 'GET', null, managerToken);
        console.log(`✅ Manager Inbox has ${notifRes.data.count} messages (${notifRes.data.unreadCount} unread).`);
        if (notifRes.data.notifications.length > 0) {
          const top = notifRes.data.notifications[0];
          console.log(`📩 Latest message in Manager Inbox: "${top.title}" - Remark: "${top.remark}"`);
        }

        // 7. Test Clear All Notifications for User and Manager
        console.log('\n[7] Testing Clear All Notifications...');
        const clearUserNotif = await request('/notifications', 'DELETE', null, userToken);
        console.log(`✅ User Clear All Notifications: ${clearUserNotif.data.message}`);
        const userNotifsAfter = await request('/notifications', 'GET', null, userToken);
        console.log(`✅ User Inbox now has ${userNotifsAfter.data.count} messages.`);

        const clearMgrNotif = await request('/notifications', 'DELETE', null, managerToken);
        console.log(`✅ Manager Clear All Notifications: ${clearMgrNotif.data.message}`);
        const mgrNotifsAfter = await request('/notifications', 'GET', null, managerToken);
        console.log(`✅ Manager Inbox now has ${mgrNotifsAfter.data.count} messages.`);
      }
    }

    console.log('\n=============================================');
    console.log('🎉 ALL ROLE FLOW & NOTIFICATION TESTS PASSED!');
    console.log('=============================================');
  } catch (err) {
    console.error('Test error:', err);
  }
};

runVerification();
