const assert = require('assert');

async function testAllEndpoints() {
  console.log('=== Starting Full Automated API & Functional Test Suite ===\n');
  const baseUrl = 'http://localhost:5000/api';

  // 1. Test Login Validation
  console.log('1. Testing Login Validation (Empty Credentials)...');
  const emptyRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameOrEmail: '', password: '' }),
  });
  const emptyJson = await emptyRes.json();
  assert.strictEqual(emptyRes.status, 400);
  assert.strictEqual(emptyJson.success, false);
  console.log('✓ Proper validation message on empty login:', emptyJson.message);

  // 2. Test Invalid Password
  console.log('\n2. Testing Invalid Password Login...');
  const invalidRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameOrEmail: 'sarfu@gmail.com', password: 'wrongpassword' }),
  });
  const invalidJson = await invalidRes.json();
  assert.strictEqual(invalidRes.status, 401);
  assert.strictEqual(invalidJson.success, false);
  console.log('✓ Proper error message on wrong password:', invalidJson.message);

  // 3. Test Successful Login (Manager - Sarfu)
  console.log('\n3. Testing Successful Login (Manager - Sarfu)...');
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameOrEmail: 'sarfu@gmail.com', password: '998466' }),
  });
  const loginJson = await loginRes.json();
  assert.strictEqual(loginRes.status, 200);
  assert.strictEqual(loginJson.success, true);
  assert.ok(loginJson.token, 'Token must be provided');
  assert.strictEqual(loginJson.user.role, 'Manager');
  console.log(`✓ Logged in as ${loginJson.user.name} (${loginJson.user.role}) - Token Received`);
  const token = loginJson.token;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // 4. Test Manager Dashboard Stats Endpoint
  console.log('\n4. Testing Manager Dashboard Statistics Endpoint (/api/tasks/stats)...');
  const statsRes = await fetch(`${baseUrl}/tasks/stats`, { headers });
  const statsJson = await statsRes.json();
  assert.strictEqual(statsRes.status, 200);
  assert.strictEqual(statsJson.success, true);
  assert.ok(statsJson.stats.total >= 10, 'Expected seeded tasks');
  assert.ok(statsJson.stats.byType['internet work'] !== undefined);
  assert.ok(statsJson.stats.byType['documentation'] !== undefined);
  assert.ok(statsJson.stats.byType['social media'] !== undefined);
  assert.ok(statsJson.stats.byType['backend work'] !== undefined);
  console.log('✓ Manager Dashboard stats returned successfully:', statsJson.stats);

  // 5. Test Get Tasks List
  console.log('\n5. Testing Get Tasks List (/api/tasks)...');
  const listRes = await fetch(`${baseUrl}/tasks`, { headers });
  const listJson = await listRes.json();
  assert.strictEqual(listRes.status, 200);
  assert.strictEqual(listJson.success, true);
  console.log(`✓ Fetched ${listJson.count} tasks`);

  // 6. Test Task Dynamic Search
  console.log('\n6. Testing Dynamic Search (query="UPI")...');
  const searchRes = await fetch(`${baseUrl}/tasks?search=UPI`, { headers });
  const searchJson = await searchRes.json();
  assert.strictEqual(searchRes.status, 200);
  console.log(`✓ Search returned ${searchJson.count} matching tasks`);

  // 7. Test Add New Task (Create)
  console.log('\n7. Testing Add Task (Create)...');
  const newTaskPayload = {
    taskType: 'backend work',
    description: 'Implement distributed rate limiter using Redis token bucket algorithm',
    expectedDate: '2026-09-20',
    remark: 'Max 100 requests per minute per IP address',
    status: 'To Do',
  };
  const createRes = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify(newTaskPayload),
  });
  const createJson = await createRes.json();
  assert.strictEqual(createRes.status, 201);
  assert.strictEqual(createJson.success, true);
  assert.strictEqual(createJson.task.taskType, 'backend work');
  const createdTaskId = createJson.task._id;
  console.log(`✓ Task created successfully with ID: ${createdTaskId}`);

  // 8. Test Edit / Update Task
  console.log('\n8. Testing Edit & Update Task (PUT /api/tasks/:id)...');
  const updatePayload = {
    taskType: 'backend work',
    description: 'Implement distributed rate limiter using Redis token bucket (UPDATED)',
    expectedDate: '2026-09-22',
    remark: 'Updated limit to 200 requests per minute',
    status: 'In Progress',
  };
  const updateRes = await fetch(`${baseUrl}/tasks/${createdTaskId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(updatePayload),
  });
  const updateJson = await updateRes.json();
  assert.strictEqual(updateRes.status, 200);
  assert.strictEqual(updateJson.task.description, updatePayload.description);
  assert.strictEqual(updateJson.task.status, 'In Progress');
  console.log('✓ Task updated successfully:', updateJson.task.description);

  // 9. Test Status Quick Patch
  console.log('\n9. Testing Quick Status Update (PATCH /api/tasks/:id/status)...');
  const statusRes = await fetch(`${baseUrl}/tasks/${createdTaskId}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'Completed' }),
  });
  const statusJson = await statusRes.json();
  assert.strictEqual(statusRes.status, 200);
  assert.strictEqual(statusJson.task.status, 'Completed');
  console.log('✓ Task status patched to Completed successfully');

  // 10. Test Delete Task
  console.log('\n10. Testing Delete Task (DELETE /api/tasks/:id)...');
  const deleteRes = await fetch(`${baseUrl}/tasks/${createdTaskId}`, {
    method: 'DELETE',
    headers,
  });
  const deleteJson = await deleteRes.json();
  assert.strictEqual(deleteRes.status, 200);
  assert.strictEqual(deleteJson.success, true);
  console.log('✓ Task deleted successfully');

  // 11. Test User Management - Get Users List
  console.log('\n11. Testing Get All Users (/api/users)...');
  const usersRes = await fetch(`${baseUrl}/users`, { headers });
  const usersJson = await usersRes.json();
  assert.strictEqual(usersRes.status, 200);
  assert.strictEqual(usersJson.success, true);
  assert.ok(usersJson.count >= 3, 'Expected seeded Indian users');
  console.log(`✓ Fetched ${usersJson.count} users (including Aarav, Priya, Rohan, Ananya, Vikram, Neha)`);

  // 12. Test Add User (Create)
  console.log('\n12. Testing Add User (POST /api/users)...');
  const newUserData = {
    name: 'Siddharth Roy',
    email: 'siddharth.roy@taskflow.com',
    username: 'siddharth',
    role: 'User',
    department: 'Mobile App Development',
    password: 'user123',
  };
  const createUserRes = await fetch(`${baseUrl}/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify(newUserData),
  });
  const createUserJson = await createUserRes.json();
  assert.strictEqual(createUserRes.status, 201);
  assert.strictEqual(createUserJson.success, true);
  assert.strictEqual(createUserJson.user.name, 'Siddharth Roy');
  const createdUserId = createUserJson.user._id;
  console.log(`✓ User added successfully with ID: ${createdUserId}`);

  // 13. Test Edit & Update User (PUT /api/users/:id)
  console.log('\n13. Testing Edit & Update User (PUT /api/users/:id)...');
  const updateUserRes = await fetch(`${baseUrl}/users/${createdUserId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      name: 'Siddharth Roy',
      department: 'Lead iOS Engineer',
      role: 'Manager',
    }),
  });
  const updateUserJson = await updateUserRes.json();
  assert.strictEqual(updateUserRes.status, 200);
  assert.strictEqual(updateUserJson.user.department, 'Lead iOS Engineer');
  assert.strictEqual(updateUserJson.user.role, 'Manager');
  console.log('✓ User updated successfully:', updateUserJson.user.department);

  // 14. Test Delete / Remove User (DELETE /api/users/:id)
  console.log('\n14. Testing Remove User (DELETE /api/users/:id)...');
  const deleteUserRes = await fetch(`${baseUrl}/users/${createdUserId}`, {
    method: 'DELETE',
    headers,
  });
  const deleteUserJson = await deleteUserRes.json();
  assert.strictEqual(deleteUserRes.status, 200);
  assert.strictEqual(deleteUserJson.success, true);
  console.log('✓ User removed successfully');

  console.log('\n======================================================');
  console.log('🎉 ALL 14 TESTS (AUTH, TASK CRUD, USER CRUD) PASSED WITH 100% SUCCESS!');
  console.log('======================================================');
}

testAllEndpoints().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
