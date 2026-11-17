const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../data/store.json');
const raw = fs.readFileSync(STORE_PATH, 'utf8');
const store = JSON.parse(raw);

const AI_EMAILS = new Set([
  'admin@taskflow.com',
  'rohan.verma@taskflow.com',
  'ananya.iyer@taskflow.com',
  'vikram.malhotra@taskflow.com',
  'neha.gupta@taskflow.com',
  'rajesh.kothari@taskflow.com',
  'kavita.reddy@taskflow.com',
  'sarah.test1788242656501@example.com',
  'manager.1788243837519@company.com',
  'emma.1788243837519@company.com',
]);

const aiUsers = store.users.filter(u => AI_EMAILS.has((u.email || '').toLowerCase().trim()));
const aiUserIds = new Set(aiUsers.map(u => (u._id || '').toString()));
const aiNames = new Set(aiUsers.map(u => (u.name || '').trim().toLowerCase()));

console.log(`Found ${aiUsers.length} AI-created users to remove:`);
aiUsers.forEach(u => console.log(`  - ${u.name} (${u.email}) [ID: ${u._id}]`));

// 1. Filter out AI users from store.users
store.users = store.users.filter(u => !AI_EMAILS.has((u.email || '').toLowerCase().trim()));

// 2. Clear any reportsTo referencing deleted AI users
store.users.forEach(u => {
  if (u.reportsTo && aiUserIds.has(u.reportsTo.toString())) {
    u.reportsTo = null;
    u.reportsToName = '';
  }
  if (u.reportsToName && aiNames.has(u.reportsToName.toLowerCase().trim())) {
    u.reportsTo = null;
    u.reportsToName = '';
  }
});

// Find genuine users to reassign leads/tasks if needed
const userShoaib = store.users.find(u => u.username === 'shoaib' || u.email === 'shoaib@gmail.com');
const userArif = store.users.find(u => u.username === 'arif' || u.email === 'arif@gmail.com');
const userSaifi = store.users.find(u => u.username === 'saifi' || u.email === 'saifi@gmail.com');
const userVivek = store.users.find(u => u.username === 'vvk' || u.email === 'vvk@gmail.com');
const userExam = store.users.find(u => u.username === 'exam' || u.email === 'exam@gmail.com');
const userWasil = store.users.find(u => u.username === 'wasil' || u.email === 'wasil@gmail.com');
const defaultUser = userShoaib || userExam || store.users[0];

// 3. Remove AI tasks or reassign
const beforeTaskCount = (store.tasks || []).length;
store.tasks = (store.tasks || []).filter(t => {
  const isAiTask = 
    (t.user && aiUserIds.has(t.user.toString())) ||
    (t.assignedToId && aiUserIds.has(t.assignedToId.toString())) ||
    (t.assignedTo && aiNames.has(t.assignedTo.toLowerCase().trim())) ||
    (t.assignedByName && aiNames.has(t.assignedByName.toLowerCase().trim()));
  return !isAiTask;
});
console.log(`Cleaned up tasks: ${beforeTaskCount} -> ${store.tasks.length} (removed ${beforeTaskCount - store.tasks.length} AI dummy tasks)`);

// 4. Reassign leads that were assigned to AI users to real team members
let reassignedLeads = 0;
(store.leads || []).forEach(l => {
  const isAssignedToAi = 
    (l.user && aiUserIds.has(l.user.toString())) ||
    (l.assignedToId && aiUserIds.has(l.assignedToId.toString())) ||
    (l.assignedTo && aiNames.has(l.assignedTo.toLowerCase().trim())) ||
    (l.assignedSalesUser && aiNames.has(l.assignedSalesUser.toLowerCase().trim()));

  if (isAssignedToAi) {
    let target = defaultUser;
    const lid = l.leadId || l.lead_id;
    if (['LD-001', 'LD-042', 'LD-020', 'LD-032'].includes(lid)) target = userShoaib || defaultUser;
    else if (['LD-002', 'LD-030', 'LD-012', 'LD-014'].includes(lid)) target = userArif || defaultUser;
    else if (['LD-003', 'LD-028'].includes(lid)) target = userSaifi || defaultUser;
    else if (['LD-026', 'LD-037', 'LD-043'].includes(lid)) target = userVivek || defaultUser;
    else if (['LD-018', 'LD-031'].includes(lid)) target = userWasil || defaultUser;
    else if (['LD-019', 'LD-022'].includes(lid)) target = userExam || defaultUser;

    if (target) {
      l.user = target._id;
      l.assignedTo = target.name;
      l.assignedSalesUser = target.name;
      l.assignedToId = target._id;
      reassignedLeads++;
    }
  }
});
console.log(`Reassigned ${reassignedLeads} leads to real user team members.`);

// 5. Clean complaints
(store.complaints || []).forEach(c => {
  if (c.assignedTo && aiUserIds.has(c.assignedTo.toString())) {
    c.assignedTo = defaultUser ? defaultUser._id : null;
    c.assignedToName = defaultUser ? defaultUser.name : '';
  }
});

// Save updated store.json
fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
console.log(`\nSuccessfully updated store.json!`);
console.log(`Total remaining genuine users: ${store.users.length}`);
store.users.forEach((u, i) => console.log(`  ${i + 1}. ${u.name} (${u.email}) [Role: ${u.role}]`));

