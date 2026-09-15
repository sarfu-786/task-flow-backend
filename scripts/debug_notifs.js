const BASE_URL = 'http://localhost:5000/api';

async function debug() {
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'aaaa', password: 'password' }),
  });
  const data = await loginRes.json();
  console.log('Login user object:', data.user);

  const notifsRes = await fetch(`${BASE_URL}/notifications`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  const notifsData = await notifsRes.json();
  console.log('asdf Notifications count:', notifsData.count);
  console.log('asdf Notifications list:', JSON.stringify(notifsData.notifications, null, 2));
}

debug();
