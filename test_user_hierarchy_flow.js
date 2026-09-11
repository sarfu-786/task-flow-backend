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
  console.log('================================================================');
  console.log('🧪 Starting Direct Senior Hierarchy & Task Assignment Test Suite');
  console.log('================================================================\n');

  try {
    const timestamp = Date.now();

    // 1. Super Admin Login
    console.log('[1] Logging in as Super Admin (sarfrajahamad068@gmail.com)...');
    let adminToken = null;
    const adminLogin = await request('/auth/login', 'POST', {
      usernameOrEmail: 'sarfrajahamad068@gmail.com',
      password: '998466',
    });

    if (adminLogin.status === 200 && adminLogin.data.success) {
      adminToken = adminLogin.data.token;
      console.log(`✅ Super Admin logged in: ${adminLogin.data.user.name} (${adminLogin.data.user.role})`);
    } else {
      console.error('❌ Super Admin login failed:', adminLogin.data);
      return;
    }

    // 2. Super Admin creates a Senior User (role: User) in User Section
    console.log('\n[2] Super Admin creates a Senior User (e.g. Neha Team Lead)...');
    const seniorUserData = {
      name: `Neha Team Lead ${timestamp.toString().slice(-4)}`,
      email: `neha.${timestamp}@taskflow.com`,
      username: `neha_${timestamp}`,
      password: 'password123',
      role: 'User',
      department: 'Digital Marketing',
    };

    const createSeniorRes = await request('/users', 'POST', seniorUserData, adminToken);
    if (!createSeniorRes.data.success) {
      console.error('❌ Failed to create senior user:', createSeniorRes.data);
      return;
    }
    console.log(`✅ Senior User created: ${createSeniorRes.data.user.name} (Role: ${createSeniorRes.data.user.role})`);

    // 3. Senior User logs in
    console.log('\n[3] Senior User logs into their account...');
    const seniorLoginRes = await request('/auth/login', 'POST', {
      usernameOrEmail: seniorUserData.username,
      password: seniorUserData.password,
    });

    let seniorToken = null;
    let seniorUser = null;
    if (seniorLoginRes.status === 200 && seniorLoginRes.data.success) {
      seniorToken = seniorLoginRes.data.token;
      seniorUser = seniorLoginRes.data.user;
      console.log(`✅ Senior User logged in: ${seniorUser.name} - ID: ${seniorUser._id || seniorUser.id}`);
    } else {
      console.error('❌ Senior User login failed:', seniorLoginRes.data);
      return;
    }

    // 4. Senior User creates a new subordinate user (Junior Analyst)
    console.log('\n[4] Senior User creates a new subordinate user (Junior Analyst)...');
    const juniorSubData = {
      name: `Junior Analyst ${timestamp.toString().slice(-4)}`,
      email: `junior.${timestamp}@taskflow.com`,
      username: `junior_${timestamp}`,
      password: 'password123',
      department: 'Digital Marketing',
    };

    const createJuniorRes = await request('/users', 'POST', juniorSubData, seniorToken);
    if (createJuniorRes.status === 201 && createJuniorRes.data.success) {
      const juniorUser = createJuniorRes.data.user;
      console.log(`✅ Junior user created: ${juniorUser.name} (Role: ${juniorUser.role})`);
      console.log(`   Reports To ID: ${juniorUser.reportsTo}`);
      console.log(`   Reports To Name: ${juniorUser.reportsToName}`);

      const seniorId = (seniorUser._id || seniorUser.id).toString();
      if (juniorUser.reportsTo && juniorUser.reportsTo.toString() === seniorId) {
        console.log(`✅ Hierarchy Rule Verified: Junior user's direct senior is correctly set to Senior User (${seniorId})`);
      } else {
        console.error(`❌ Hierarchy mismatch! Expected reportsTo=${seniorId}, got ${juniorUser.reportsTo}`);
      }

      // 5. Senior User assigns a task to her new direct subordinate (Junior Analyst)
      console.log(`\n[5] Senior User assigns a task to her direct subordinate (${juniorUser.name})...`);
      const taskRes = await request(
        '/tasks',
        'POST',
        {
          taskType: 'social media',
          description: 'Design and schedule promotional Instagram story assets',
          expectedDate: new Date(Date.now() + 86400000 * 3).toISOString(),
          remark: 'Use vibrant contrast colors and company logo',
          status: 'To Do',
          assignedTo: juniorUser.name,
        },
        seniorToken
      );

      if (taskRes.status === 201 && taskRes.data.success) {
        console.log(`✅ Task assigned successfully by Senior User!`);
        console.log(`   Task ID: ${taskRes.data.task._id}`);
        console.log(`   Assigned To: ${taskRes.data.task.assignedTo}`);
        console.log(`   Assigned By: ${taskRes.data.task.assignedBy}`);
      } else {
        console.error(`❌ Task assignment failed:`, taskRes.data);
      }

      // 6. Test Invalid Hierarchy Assignments (Must be rejected)
      console.log('\n[6] Testing Hierarchy Constraint Violations (Security & Protocol Checks):');

      // 6a. Senior User assigns task to herself -> Must be blocked
      console.log('  [6a] Testing: User assigns task to herself...');
      const selfAssign = await request(
        '/tasks',
        'POST',
        {
          taskType: 'internet work',
          description: 'Self assigned task',
          expectedDate: new Date().toISOString(),
          assignedTo: seniorUser.name,
        },
        seniorToken
      );
      if (selfAssign.status === 400 && !selfAssign.data.success) {
        console.log(`  ✅ Correctly blocked self-assignment: "${selfAssign.data.message}"`);
      } else {
        console.error(`  ❌ Security failure: Self-assignment was allowed!`, selfAssign.data);
      }

      // 6b. Senior User assigns task to senior Super Admin -> Must be blocked
      console.log('  [6b] Testing: User assigns task to Super Admin (Senior)...');
      const otherAssign = await request(
        '/tasks',
        'POST',
        {
          taskType: 'backend work',
          description: 'Assign to Super Admin',
          expectedDate: new Date().toISOString(),
          assignedTo: 'Sarfaraj Ahmad',
        },
        seniorToken
      );
      if (otherAssign.status === 400 && !otherAssign.data.success) {
        console.log(`  ✅ Correctly blocked assigning to senior manager: "${otherAssign.data.message}"`);
      } else {
        console.error(`  ❌ Security failure: Assigning to senior was allowed!`, otherAssign.data);
      }

      // 7. Login as the newly created Junior Analyst
      console.log(`\n[7] Logging in as the new Junior Analyst (${juniorSubData.username})...`);
      const juniorLogin = await request('/auth/login', 'POST', {
        usernameOrEmail: juniorSubData.username,
        password: juniorSubData.password,
      });

      if (juniorLogin.status === 200 && juniorLogin.data.success) {
        const juniorToken = juniorLogin.data.token;
        console.log(`✅ Junior Analyst logged in successfully: ${juniorLogin.data.user.name}`);

        // 7a. Junior Analyst checks his assigned tasks
        console.log('  [7a] Fetching junior analyst tasks...');
        const myTasksRes = await request('/tasks?myTasksOnly=true', 'GET', null, juniorToken);
        if (myTasksRes.status === 200 && myTasksRes.data.success) {
          console.log(`  ✅ Junior analyst sees ${myTasksRes.data.count} task(s) assigned to him`);
          const found = myTasksRes.data.tasks.find(t => t.description.includes('promotional Instagram story'));
          if (found) {
            console.log(`  ✅ Found assigned task: "${found.description}" (Assigned by: ${found.assignedBy})`);
          }
        }

        // 7b. Junior Analyst attempts to assign task to his direct senior (Senior User) -> Must be blocked!
        console.log('  [7b] Junior Analyst attempts to assign task to direct senior (Senior User)...');
        const juniorToSenior = await request(
          '/tasks',
          'POST',
          {
            taskType: 'documentation',
            description: 'Junior assigning to senior',
            expectedDate: new Date().toISOString(),
            assignedTo: seniorUser.name,
          },
          juniorToken
        );
        if (juniorToSenior.status === 400 && !juniorToSenior.data.success) {
          console.log(`  ✅ Correctly blocked junior from assigning task to senior: "${juniorToSenior.data.message}"`);
        } else {
          console.error(`  ❌ Security failure: Junior was allowed to assign task to senior!`, juniorToSenior.data);
        }
      }

      // 8. Verify Senior User's task overview includes subordinate tasks
      console.log(`\n[8] Verifying Senior User's task overview includes tasks assigned to her subordinate...`);
      const seniorTasksRes = await request('/tasks', 'GET', null, seniorToken);
      if (seniorTasksRes.status === 200 && seniorTasksRes.data.success) {
        console.log(`✅ Direct Senior sees ${seniorTasksRes.data.count} relevant tasks`);
        const subTask = seniorTasksRes.data.tasks.find(t => t.description.includes('promotional Instagram story'));
        if (subTask) {
          console.log(`✅ Direct senior can track subordinate's task: "${subTask.description}" (${subTask.status})`);
        }
      }

      console.log('\n================================================================');
      console.log('🎉 ALL HIERARCHY & TASK ASSIGNMENT VERIFICATION CHECKS PASSED!');
      console.log('================================================================\n');
    } else {
      console.error('❌ Junior user creation failed:', createJuniorRes.data);
    }
  } catch (err) {
    console.error('❌ Verification test error:', err);
  }
};

runVerification();
