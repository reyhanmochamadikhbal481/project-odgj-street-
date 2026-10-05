const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function testAuth() {
  const base = 'http://127.0.0.1:3000';
  
  console.log('=== Testing /api/health ===');
  const health = await fetch(`${base}/api/health`);
  console.log(await health.json());

  console.log('\n=== Testing /api/auth/login ===');
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@odgj.com', password: 'odgj12345' })
  });
  const loginData = await login.json();
  console.log('Status:', login.status);
  console.log(loginData);
  
  if (loginData.accessToken) {
    const token = loginData.accessToken;
    
    console.log('\n=== Testing /api/auth/me ===');
    const me = await fetch(`${base}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log(await me.json());

    console.log('\n=== Testing /api/menu (public) ===');
    const menu = await fetch(`${base}/api/menu`);
    const menuData = await menu.json();
    console.log(`Menu items: ${menuData.length}`);

    console.log('\n=== Testing /api/orders GET (protected) ===');
    const orders = await fetch(`${base}/api/orders`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log(await orders.json());

    console.log('\n=== Testing /api/auth/refresh ===');
    const refresh = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Cookie': login.headers.get('set-cookie') }
    });
    console.log(await refresh.json());

    console.log('\n=== Testing /api/auth/logout ===');
    const logout = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Cookie': login.headers.get('set-cookie') }
    });
    console.log(await logout.json());
  }
}

testAuth().catch(console.error);