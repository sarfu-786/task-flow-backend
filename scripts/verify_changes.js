const assert = require('assert');

async function verifyUpdates() {
  console.log('=== Verifying Updates ===\n');
  const baseUrl = 'http://localhost:5000/api';

  // 1. Login as Super Admin
  console.log('1. Logging in as Super Admin...');
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameOrEmail: 'sarfrajahamad068@gmail.com', password: '998466' }),
  });
  const loginJson = await loginRes.json();
  assert.strictEqual(loginRes.status, 200, 'Super admin login failed');
  assert.strictEqual(loginJson.success, true);
  console.log('✓ Super Admin authenticated:', loginJson.user.name);
  const token = loginJson.token;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // 2. Test Task Creation with taskType 'sells' and status 'To Do'
  console.log('\n2. Testing Task Creation with taskType="sells" and status="To Do"...');
  const createTaskRes = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      taskType: 'sells',
      description: 'Test Verification Task for Sells Type',
      expectedDate: new Date(Date.now() + 86400000).toISOString(),
      status: 'To Do',
      remark: 'Test remark for sells task',
      assignedTo: 'Super Admin',
      assignedBy: 'Super Admin',
    }),
  });
  const createTaskJson = await createTaskRes.json();
  assert.strictEqual(createTaskRes.status, 201, `Task creation failed: ${createTaskJson.message}`);
  assert.strictEqual(createTaskJson.success, true);
  assert.strictEqual(createTaskJson.task.taskType, 'sells');
  assert.strictEqual(createTaskJson.task.status, 'To Do');
  console.log('✓ Task created successfully with taskType "sells" and status "To Do":', createTaskJson.task._id);
  const createdTaskId = createTaskJson.task._id;

  // 3. Test Task Stats endpoint includes 'sells'
  console.log('\n3. Testing Task Stats includes "sells" type...');
  const statsRes = await fetch(`${baseUrl}/tasks/stats`, { headers });
  const statsJson = await statsRes.json();
  assert.strictEqual(statsRes.status, 200);
  assert.strictEqual(statsJson.success, true);
  assert.ok(statsJson.stats.byType.sells !== undefined, 'Stats must include sells count');
  assert.ok(statsJson.stats.byType.sells >= 1, 'Stats sells count must be at least 1');
  console.log('✓ Stats byType output:', statsJson.stats.byType);

  // 4. Test Profile Update with Avatar Data URL
  console.log('\n4. Testing Profile Update with avatar...');
  const sampleAvatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const profileRes = await fetch(`${baseUrl}/auth/profile`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      name: loginJson.user.name,
      email: loginJson.user.email,
      username: loginJson.user.username,
      department: 'Sells',
      avatar: sampleAvatar,
    }),
  });
  const profileJson = await profileRes.json();
  assert.strictEqual(profileRes.status, 200, `Profile update failed: ${profileJson.message}`);
  assert.strictEqual(profileJson.success, true);
  assert.strictEqual(profileJson.user.avatar, sampleAvatar);
  assert.strictEqual(profileJson.user.department, 'Sells');
  console.log('✓ Profile updated successfully with avatar and department="Sells"');

  // 5. Clean up test task
  console.log('\n5. Cleaning up test task...');
  const delRes = await fetch(`${baseUrl}/tasks/${createdTaskId}`, {
    method: 'DELETE',
    headers,
  });
  const delJson = await delRes.json();
  assert.strictEqual(delRes.status, 200);
  console.log('✓ Test task deleted cleanly.');

  console.log('\n=========================================');
  console.log('🎉 ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  console.log('=========================================');
}

verifyUpdates().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
