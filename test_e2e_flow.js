const express = require('express');
const cors = require('cors');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Create isolated Express test app
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const taskRoutes = require('./routes/taskRoutes');
const { connectDB, fallbackStore } = require('./config/db');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);

async function runTests() {
  await connectDB();
  const server = app.listen(5099, async () => {
    console.log('=== Starting Profile Update Functional Tests (Port 5099) ===\n');
    const baseUrl = 'http://localhost:5099/api';

    try {
      // 1. Login as Manager (Sarfaraj Ahmad)
      console.log('1. Testing Manager Login...');
      const mgrLoginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail: 'sarfrajahamad068@gmail.com', password: '998466' }),
      });
      const mgrLoginData = await mgrLoginRes.json();
      assert.strictEqual(mgrLoginRes.status, 200);
      assert.ok(mgrLoginData.token, 'Token must be received');
      assert.strictEqual(mgrLoginData.user.role, 'Manager');
      console.log(`✓ Manager logged in: ${mgrLoginData.user.name} (${mgrLoginData.user.email})`);
      const mgrToken = mgrLoginData.token;

      // 2. Manager edits own profile (PUT /api/auth/profile)
      console.log('\n2. Testing Manager Profile Update (Name, Department, Username)...');
      const mgrUpdateRes = await fetch(`${baseUrl}/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mgrToken}`,
        },
        body: JSON.stringify({
          name: 'Sarfaraj Ahmad (Updated)',
          department: 'Executive Management',
          username: 'sarfraj',
        }),
      });
      const mgrUpdateData = await mgrUpdateRes.json();
      assert.strictEqual(mgrUpdateRes.status, 200);
      assert.strictEqual(mgrUpdateData.success, true);
      assert.strictEqual(mgrUpdateData.user.name, 'Sarfaraj Ahmad (Updated)');
      assert.strictEqual(mgrUpdateData.user.department, 'Executive Management');
      console.log('✓ Manager profile updated successfully:', mgrUpdateData.user.name, mgrUpdateData.user.department);

      // 3. Verify updated profile with GET /api/auth/me
      console.log('\n3. Testing GET /api/auth/me for updated profile verification...');
      const meRes = await fetch(`${baseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${mgrUpdateData.token || mgrToken}` },
      });
      const meData = await meRes.json();
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meData.user.name, 'Sarfaraj Ahmad (Updated)');
      console.log('✓ Verified GET /api/auth/me reflects updated profile data');

      // 4. Test Email / Username collision protection
      console.log('\n4. Testing duplicate email collision validation...');
      const duplicateRes = await fetch(`${baseUrl}/auth/profile`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${mgrUpdateData.token || mgrToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'asif@gmail.com', // already belongs to Asif
        }),
      });
      const duplicateData = await duplicateRes.json();
      assert.strictEqual(duplicateRes.status, 400);
      assert.strictEqual(duplicateData.success, false);
      console.log('✓ Duplicate email successfully blocked with error:', duplicateData.message);

      // 5. Manager creates a test employee user with known password
      console.log('\n5. Creating dedicated employee user (Test Employee)...');
      const createEmpRes = await fetch(`${baseUrl}/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mgrUpdateData.token || mgrToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Employee',
          email: 'test.emp@taskflow.com',
          username: 'testemp',
          password: 'user123',
          role: 'User',
          department: 'Engineering',
        }),
      });
      const createEmpData = await createEmpRes.json();
      assert.strictEqual(createEmpRes.status, 201);
      console.log(`✓ Test employee created: ${createEmpData.user.name} (${createEmpData.user.email})`);

      // 6. Login as regular Employee (Test Employee)
      console.log('\n6. Testing Employee Login (Test Employee)...');
      const empLoginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail: 'test.emp@taskflow.com', password: 'user123' }),
      });
      const empLoginData = await empLoginRes.json();
      assert.strictEqual(empLoginRes.status, 200);
      assert.strictEqual(empLoginData.user.role, 'User');
      console.log(`✓ Employee logged in: ${empLoginData.user.name} (${empLoginData.user.role})`);
      const empToken = empLoginData.token;

      // 7. Employee updates own profile (Name, Department, Password)
      console.log('\n7. Testing Employee Profile Update (Name, Department, Password)...');
      const empUpdateRes = await fetch(`${baseUrl}/auth/profile`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Employee (Promoted)',
          department: 'Backend & Cloud',
          newPassword: 'newpassword123',
        }),
      });
      const empUpdateData = await empUpdateRes.json();
      assert.strictEqual(empUpdateRes.status, 200);
      assert.strictEqual(empUpdateData.success, true);
      assert.strictEqual(empUpdateData.user.name, 'Test Employee (Promoted)');
      assert.strictEqual(empUpdateData.user.department, 'Backend & Cloud');
      console.log('✓ Employee profile and password updated successfully');

      // 8. Verify login with employee's new password
      console.log('\n8. Testing login with new password...');
      const empNewLoginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail: 'test.emp@taskflow.com', password: 'newpassword123' }),
      });
      const empNewLoginData = await empNewLoginRes.json();
      assert.strictEqual(empNewLoginRes.status, 200);
      assert.strictEqual(empNewLoginData.success, true);
      console.log('✓ Successfully authenticated with newly updated password');

      // 9. Test role escalation protection: Employee trying to change role to Manager
      console.log('\n9. Testing role escalation prevention for regular user...');
      const roleHackRes = await fetch(`${baseUrl}/users/${empLoginData.user.id || empLoginData.user._id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${empNewLoginData.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'Manager' }),
      });
      const roleHackData = await roleHackRes.json();
      assert.strictEqual(roleHackData.user.role, 'User', 'Role must remain User, cannot escalate to Manager');
      console.log('✓ Role escalation properly prevented: Role remains', roleHackData.user.role);

      // 10. Clean up: Delete test employee and restore manager details
      console.log('\n10. Cleaning up test records...');
      await fetch(`${baseUrl}/users/${createEmpData.user._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${mgrUpdateData.token || mgrToken}` },
      });
      await fetch(`${baseUrl}/auth/profile`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${mgrUpdateData.token || mgrToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Sarfaraj Ahmad',
          department: 'Management',
          username: 'sarfraj',
        }),
      });
      console.log('✓ Cleaned up test employee and restored manager default data');

      // 11. Test Public Registration flow (Creates 'Pending' user and Manager notification)
      console.log('\n11. Testing public user registration creating Pending approval status...');
      const registerRes = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Applicant User',
          email: 'applicant.test@taskflow.com',
          username: 'applicantuser',
          password: 'secretpassword',
          department: 'Internet Work',
        }),
      });
      const registerData = await registerRes.json();
      assert.strictEqual(registerRes.status, 201);
      assert.strictEqual(registerData.approvalStatus, 'Pending');
      console.log('✓ Public registration successfully submitted with Pending status:', registerData.user.name);

      // 12. Test Manager GET /api/users/approvals for Pending count and indicator
      console.log('\n12. Testing Manager retrieval of pending approvals and counts...');
      const approvalsRes = await fetch(`${baseUrl}/users/approvals?status=Pending`, {
        headers: { Authorization: `Bearer ${mgrToken}` },
      });
      const approvalsData = await approvalsRes.json();
      assert.strictEqual(approvalsRes.status, 200);
      assert.ok(approvalsData.counts.pending >= 1, 'Pending approvals count must be at least 1');
      const foundPending = approvalsData.users.find(u => u.email === 'applicant.test@taskflow.com');
      assert.ok(foundPending, 'Newly registered applicant must appear in pending list');
      console.log(`✓ Manager approvals API returned ${approvalsData.counts.pending} pending registrations`);

      // 13. Test Manager approving registration (PUT /api/users/:id/approval)
      console.log('\n13. Testing Manager approval action...');
      const approveRes = await fetch(`${baseUrl}/users/${registerData.user.id || registerData.user._id}/approval`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${mgrToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Approved', department: 'Internet Work' }),
      });
      const approveData = await approveRes.json();
      assert.strictEqual(approveRes.status, 200);
      assert.strictEqual(approveData.user.status, 'Approved');
      console.log('✓ Manager approved applicant registration successfully');

      // 14. Test Manager assigning a new task to the newly registered & approved user
      console.log('\n14. Testing Manager creating & assigning a new task to newly approved user...');
      const createTaskRes = await fetch(`${baseUrl}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mgrToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType: 'internet work',
          description: 'Initial Onboarding Task for Applicant User',
          expectedDate: new Date(Date.now() + 86400000 * 5).toISOString(),
          remark: 'Complete company profile setup and review guidelines',
          status: 'To Do',
          priority: 'High',
          assignedTo: 'Applicant User',
          userId: registerData.user.id || registerData.user._id,
        }),
      });
      const createTaskData = await createTaskRes.json();
      assert.strictEqual(createTaskRes.status, 201);
      assert.strictEqual(createTaskData.success, true);
      assert.ok(createTaskData.task._id, 'Created task must have an ID');
      assert.strictEqual(createTaskData.task.assignedTo, 'Applicant User');
      console.log(`✓ Manager successfully created and assigned task: "${createTaskData.task.description}" (ID: ${createTaskData.task._id})`);

      // 15. Test newly approved user login and retrieval of assigned task
      console.log('\n15. Testing newly approved user login and task visibility...');
      const applicantLoginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail: 'applicant.test@taskflow.com', password: 'secretpassword' }),
      });
      const applicantLoginData = await applicantLoginRes.json();
      assert.strictEqual(applicantLoginRes.status, 200);
      assert.ok(applicantLoginData.token, 'Approved user must receive valid JWT on login');

      const myTasksRes = await fetch(`${baseUrl}/tasks?myTasksOnly=true`, {
        headers: { Authorization: `Bearer ${applicantLoginData.token}` },
      });
      const myTasksData = await myTasksRes.json();
      assert.strictEqual(myTasksRes.status, 200);
      const userTaskFound = myTasksData.tasks.find((t) => t._id.toString() === createTaskData.task._id.toString());
      assert.ok(userTaskFound, 'Newly registered user must see the task assigned to them');
      console.log(`✓ User successfully fetched their assigned task: "${userTaskFound.description}"`);

      // 16. Test User updating task status
      console.log('\n16. Testing User updating assigned task status to In Progress...');
      const statusRes = await fetch(`${baseUrl}/tasks/${createTaskData.task._id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${applicantLoginData.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'In Progress', remark: 'Started working on onboarding checklist' }),
      });
      const statusData = await statusRes.json();
      assert.strictEqual(statusRes.status, 200);
      assert.strictEqual(statusData.task.status, 'In Progress');
      console.log('✓ Task status successfully updated to "In Progress"');

      // 17. Clean up: Delete created task and applicant user
      console.log('\n17. Cleaning up test task and applicant user record...');
      await fetch(`${baseUrl}/tasks/${createTaskData.task._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${mgrToken}` },
      });
      await fetch(`${baseUrl}/users/${registerData.user.id || registerData.user._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${mgrToken}` },
      });
      console.log('✓ Cleaned up test task and applicant test record');

      console.log('\n===============================================================');
      console.log('🎉 ALL PROFILE, REGISTRATION, APPROVALS & TASK ASSIGNMENT TESTS PASSED 100%!');
      console.log('===============================================================\n');
    } catch (err) {
      console.error('\n❌ Test failure:', err);
      process.exitCode = 1;
    } finally {
      server.close();
    }
  });
}

runTests();
